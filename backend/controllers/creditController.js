import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import PhysicalSale from '../models/PhysicalSale.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import {
  idempotentTransaction,
  requestKey,
} from '../services/idempotencyService.js';
import {
  accountData,
  entryData,
  loadCreditAccount,
  postCreditEntry,
  reduceCredit,
  creditRetryOptions,
} from '../services/creditLedgerService.js';
import {
  creditName,
  creditPhone,
  creditReason,
  creditPaymentMethod,
  toKobo,
} from '../utils/creditMoney.js';

const paging = (req) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(50, Math.max(1, parseInt(req.query.limit) || 20)),
});
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listCreditAccounts = asyncHandler(async (req, res) => {
  const { page, limit } = paging(req),
    query = {};
  if (req.query.status === 'owing') query.balanceKobo = { $gt: 0 };
  if (req.query.status === 'cleared') query.balanceKobo = 0;
  if (req.query.search) {
    if (typeof req.query.search !== 'string' || req.query.search.length > 200)
      throw new AppError(
        400,
        'INVALID_SEARCH',
        'Search must be at most 200 characters.'
      );
    const regex = new RegExp(escaped(req.query.search.trim()), 'i');
    query.$or = [{ fullName: regex }, { phone: regex }, { phoneKey: regex }];
  }
  const [total, accounts, legacyOutstandingCount] = await Promise.all([
    CreditAccount.countDocuments(query),
    CreditAccount.find(query)
      .sort({ fullName: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PhysicalSale.countDocuments({
      balanceDue: { $gt: 0 },
      creditAccount: null,
    }),
  ]);
  res.json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    legacyOutstandingCount,
    data: accounts.map(accountData),
  });
});

export const lookupCreditAccount = asyncHandler(async (req, res) => {
  const identity = creditPhone(req.query.phone);
  const account = await CreditAccount.findOne({ phoneKey: identity.phoneKey });
  res.json({
    success: true,
    data: { account: account ? accountData(account) : null },
  });
});

export const getCreditAccount = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: accountData(await loadCreditAccount(req.params.id)),
  })
);

export const getCreditEntries = asyncHandler(async (req, res) => {
  const account = await loadCreditAccount(req.params.id),
    { page, limit } = paging(req);
  const [total, entries] = await Promise.all([
    CreditEntry.countDocuments({ account: account._id }),
    CreditEntry.find({ account: account._id })
      .sort({ sequence: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);
  res.json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    data: entries.map(entryData),
  });
});

export const createCreditAccount = asyncHandler(async (req, res) => {
  const reference = requestKey(req),
    actor = req.user;
  const payload = {
    fullName: req.body.fullName,
    phone: req.body.phone,
    openingBalance: req.body.openingBalance ?? 0,
    reason: req.body.reason || '',
    actor: String(actor._id),
  };
  const result = await idempotentTransaction(
    'CREDIT_CREATE_' + reference,
    'CREDIT_ACCOUNT_CREATE',
    payload,
    async (session) => {
      const fullName = creditName(payload.fullName),
        identity = creditPhone(payload.phone),
        opening = toKobo(payload.openingBalance);
      if (
        await CreditAccount.exists({ phoneKey: identity.phoneKey }).session(
          session
        )
      )
        throw new AppError(
          409,
          'CUSTOMER_EXISTS',
          'This phone already has a customer account. Open that account instead.'
        );
      const [account] = await CreditAccount.create(
        [{ fullName, ...identity, createdBy: actor._id }],
        { session }
      );
      if (opening) {
        account.unallocatedKobo = opening;
        await postCreditEntry(
          account,
          opening,
          {
            key: 'OPENING_' + account._id,
            type: 'opening_balance',
            reason: payload.reason
              ? creditReason(payload.reason)
              : 'Existing debt brought forward',
          },
          actor,
          session
        );
      }
      return { account: accountData(account) };
    },
    creditRetryOptions
  );
  res
    .status(result.replayed ? 200 : 201)
    .json({ success: true, data: result.data });
});

export const updateCreditBalance = asyncHandler(async (req, res) => {
  const reference = requestKey(req),
    actor = req.user,
    operation = req.params.operation;
  const actions = {
    payment: 'CREDIT_PAYMENT',
    correction: 'CREDIT_CORRECTION',
    'write-off': 'CREDIT_WRITE_OFF',
  };
  if (!actions[operation])
    throw new AppError(404, 'INVALID_OPERATION', 'Unknown customer update.');
  const payload = {
    account: req.params.id,
    operation,
    amount: req.body.amount,
    newBalance: req.body.newBalance,
    reason: req.body.reason,
    paymentMethod: req.body.paymentMethod,
    expectedRevision: req.body.expectedRevision,
    actor: String(actor._id),
  };
  const result = await idempotentTransaction(
    'CREDIT_' + operation + '_' + reference,
    actions[operation],
    payload,
    async (session) => {
      const account = await loadCreditAccount(req.params.id, session);
      if (
        operation !== 'payment' &&
        (!Number.isSafeInteger(payload.expectedRevision) ||
          payload.expectedRevision !== account.revision)
      ) {
        throw new AppError(
          409,
          'CUSTOMER_CHANGED',
          'The customer balance changed. Refresh it before correcting or forgiving debt.'
        );
      }
      let entry;
      const details = { key: 'CREDIT_' + operation + '_' + reference };
      if (operation === 'payment') {
        details.paymentMethod = creditPaymentMethod(payload.paymentMethod);
        details.reason = payload.reason
          ? creditReason(payload.reason)
          : 'Payment received';
        entry = await reduceCredit(
          account,
          toKobo(payload.amount, { positive: true }),
          'payment',
          details,
          actor,
          session
        );
      } else if (operation === 'write-off') {
        details.reason = creditReason(payload.reason);
        entry = await reduceCredit(
          account,
          toKobo(payload.amount, { positive: true }),
          'write_off',
          details,
          actor,
          session
        );
      } else {
        details.reason = creditReason(payload.reason);
        const target = toKobo(payload.newBalance),
          delta = target - account.balanceKobo;
        if (!delta)
          throw new AppError(
            400,
            'BALANCE_UNCHANGED',
            'The customer already owes this amount.'
          );
        if (delta > 0) {
          account.unallocatedKobo += delta;
          entry = await postCreditEntry(
            account,
            delta,
            { ...details, type: 'balance_correction' },
            actor,
            session
          );
        } else
          entry = await reduceCredit(
            account,
            -delta,
            'balance_correction',
            details,
            actor,
            session
          );
      }
      return { account: accountData(account), entry: entryData(entry) };
    }
  );
  res.json({ success: true, data: result.data });
});
