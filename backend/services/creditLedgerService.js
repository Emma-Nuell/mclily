import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import PhysicalSale from '../models/PhysicalSale.js';
import { AppError } from '../utils/AppError.js';
import {
  creditName,
  creditPhone,
  identityName,
  naira,
  toKobo,
} from '../utils/creditMoney.js';

export const creditIdentityRetry = (error) =>
  error.code === 11000 && Boolean(error.keyPattern?.phoneKey);
export const creditRetryOptions = { retryOnDuplicate: creditIdentityRetry };
const requireTransaction = (session) => {
  if (!session?.inTransaction())
    throw new Error('Customer balance writes require a transaction.');
};
export const accountData = (account) => ({
  _id: account._id,
  fullName: account.fullName,
  phone: account.phone,
  normalizedPhone: account.phoneKey,
  balance: naira(account.balanceKobo),
  revision: account.revision,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});
export const entryData = (entry) => ({
  _id: entry._id,
  type: entry.type,
  delta: naira(entry.deltaKobo),
  amount: naira(Math.abs(entry.deltaKobo)),
  balanceBefore: naira(entry.balanceBeforeKobo),
  balanceAfter: naira(entry.balanceAfterKobo),
  reason: entry.reason,
  recordedByName: entry.recordedByName,
  paymentMethod: entry.paymentMethod,
  saleId: entry.sale,
  receiptNumber: entry.receiptNumber,
  createdAt: entry.createdAt,
});

export async function loadCreditAccount(id, session) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
    throw new AppError(
      400,
      'INVALID_CUSTOMER',
      'Choose a valid customer account.'
    );
  const account = await CreditAccount.findById(id).session(session || null);
  if (!account)
    throw new AppError(
      404,
      'CUSTOMER_NOT_FOUND',
      'Customer account not found.'
    );
  return account;
}

export async function creditAccountFor(
  name,
  phone,
  actor,
  session,
  selectedId
) {
  requireTransaction(session);
  const fullName = creditName(name),
    identity = creditPhone(phone);
  let account = await CreditAccount.findOne({
    phoneKey: identity.phoneKey,
  }).session(session);
  if (selectedId && (!account || String(account._id) !== String(selectedId)))
    throw new AppError(
      409,
      'CUSTOMER_CHANGED',
      'The selected customer and phone number do not match. Choose the customer again.'
    );
  if (
    account &&
    !selectedId &&
    identityName(account.fullName) !== identityName(fullName)
  ) {
    throw new AppError(
      409,
      'CUSTOMER_IDENTITY_MISMATCH',
      'This phone already has a credit account. Select that customer or check their name and phone.'
    );
  }
  if (!account) {
    [account] = await CreditAccount.create(
      [{ fullName, ...identity, createdBy: actor }],
      { session }
    );
  }
  return account;
}

export async function postCreditEntry(
  account,
  deltaKobo,
  details,
  actor,
  session
) {
  if (!session?.inTransaction())
    throw new Error('Customer balance writes require a transaction.');
  const before = account.balanceKobo,
    after = before + deltaKobo;
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    account.unallocatedKobo > after
  )
    throw new AppError(
      409,
      'CREDIT_BALANCE_MISMATCH',
      'The customer balance needs review before this change can be saved.'
    );
  account.balanceKobo = after;
  account.revision += 1;
  await account.save({ session });
  const [entry] = await CreditEntry.create(
    [
      {
        ...details,
        account: account._id,
        sequence: account.revision,
        deltaKobo,
        balanceBeforeKobo: before,
        balanceAfterKobo: after,
        recordedBy: actor._id,
        recordedByName: actor.fullName || 'Administrator',
      },
    ],
    { session }
  );
  return entry;
}

export async function attachCreditSale(sale, actor, session, selectedId) {
  requireTransaction(session);
  if (sale.balanceDue <= 0 || sale.creditAccount) return;
  const account = await creditAccountFor(
    sale.customerName,
    sale.customerPhone,
    actor._id,
    session,
    selectedId
  );
  sale.creditAccount = account._id;
  sale.customerName = account.fullName;
  sale.customerPhone = account.phone;
  await sale.save({ session });
  await postCreditEntry(
    account,
    toKobo(sale.balanceDue),
    {
      key: 'SALE_' + sale._id,
      type: 'credit_sale',
      sale: sale._id,
      receiptNumber: sale.receiptNumber,
      reason: 'Credit purchase',
      allocations: [{ sale: sale._id, amountKobo: toKobo(sale.balanceDue) }],
    },
    actor,
    session
  );
}

// Existing receipts contribute ONLY their remaining balance. Prior payments stay on the original receipt.
export async function adoptLegacyCreditSale(sale, actor, session) {
  requireTransaction(session);
  if (sale.creditAccount)
    return loadCreditAccount(String(sale.creditAccount), session);
  if (sale.balanceDue <= 0)
    throw new AppError(
      409,
      'NO_BALANCE',
      'This receipt has no outstanding balance.'
    );
  const account = await creditAccountFor(
    sale.customerName,
    sale.customerPhone,
    actor._id,
    session
  );
  sale.creditAccount = account._id;
  await sale.save({ session });
  await postCreditEntry(
    account,
    toKobo(sale.balanceDue),
    {
      key: 'LEGACY_' + sale._id,
      type: 'legacy_balance',
      sale: sale._id,
      receiptNumber: sale.receiptNumber,
      reason: 'Outstanding balance brought forward from an earlier receipt',
    },
    actor,
    session
  );
  return account;
}

async function reduceReceipt(sale, amount, kind, details, actor, session) {
  const balance = toKobo(sale.balanceDue);
  if (amount > balance)
    throw new AppError(
      409,
      'PAYMENT_EXCEEDS_BALANCE',
      'This amount exceeds the remaining receipt balance.'
    );
  sale.balanceDue = naira(balance - amount);
  if (kind === 'payment') {
    sale.amountPaid = naira(toKobo(sale.amountPaid) + amount);
    sale.installmentHistory.push({
      amount: naira(amount),
      paymentMethod: details.paymentMethod,
      date: new Date(),
      note: details.reason || 'Customer account payment',
      receivedBy: actor.fullName || 'Administrator',
    });
  } else {
    const field = kind === 'write_off' ? 'amountForgiven' : 'amountAdjusted';
    sale[field] = naira(toKobo(sale[field] || 0) + amount);
    sale.creditAdjustments.push({
      type: kind,
      amount: naira(amount),
      reason: details.reason,
      recordedBy: actor._id,
      recordedByName: actor.fullName || 'Administrator',
    });
  }
  sale.paymentType =
    sale.balanceDue === 0 &&
    toKobo(sale.amountPaid) === toKobo(sale.totalAmount)
      ? 'full'
      : 'credit_installment';
  await sale.save({ session });
}

// General payments settle opening/correction debt first, then oldest unpaid receipts.
// Receipt-specific payments remain supported by the existing POS installment route.
export async function reduceCredit(
  account,
  amountKobo,
  kind,
  details,
  actor,
  session,
  targetSale
) {
  requireTransaction(session);
  if (
    !Number.isSafeInteger(amountKobo) ||
    amountKobo <= 0 ||
    amountKobo > account.balanceKobo
  )
    throw new AppError(
      409,
      'PAYMENT_EXCEEDS_BALANCE',
      'This amount exceeds the current customer balance. Refresh the account.'
    );
  let remaining = amountKobo;
  const allocations = [];
  if (targetSale) {
    if (String(targetSale.creditAccount) !== String(account._id))
      throw new AppError(
        409,
        'CUSTOMER_CHANGED',
        'The receipt does not belong to this customer account.'
      );
    await reduceReceipt(targetSale, remaining, kind, details, actor, session);
    allocations.push({ sale: targetSale._id, amountKobo: remaining });
    remaining = 0;
  } else {
    const unallocated = Math.min(account.unallocatedKobo, remaining);
    account.unallocatedKobo -= unallocated;
    remaining -= unallocated;
    if (unallocated) allocations.push({ amountKobo: unallocated });
    if (remaining > 0) {
      const receipts = await PhysicalSale.find({
        creditAccount: account._id,
        balanceDue: { $gt: 0 },
      })
        .sort({ createdAt: 1, _id: 1 })
        .session(session);
      for (const receipt of receipts) {
        if (!remaining) break;
        const applied = Math.min(remaining, toKobo(receipt.balanceDue));
        await reduceReceipt(receipt, applied, kind, details, actor, session);
        allocations.push({ sale: receipt._id, amountKobo: applied });
        remaining -= applied;
      }
    }
  }
  if (remaining)
    throw new AppError(
      409,
      'CREDIT_BALANCE_MISMATCH',
      'The customer balance and receipts need review before this change can be saved.'
    );
  return postCreditEntry(
    account,
    -amountKobo,
    { ...details, type: kind, allocations },
    actor,
    session
  );
}
