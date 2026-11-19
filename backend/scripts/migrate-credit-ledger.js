import mongoose from 'mongoose';
import connectDatabase from '../config/database.js';
import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import PhysicalSale from '../models/PhysicalSale.js';
import User from '../models/User.js';
import { creditPhone, identityName } from '../utils/creditMoney.js';
import { adoptLegacyCreditSale } from '../services/creditLedgerService.js';
import { inTransaction } from '../services/transactionService.js';

// Inspection is the default. Never infer customer identity from missing or ambiguous contact data.
try {
  await connectDatabase();
  const receipts = await PhysicalSale.find({
    creditAccount: null,
    balanceDue: { $gt: 0 },
  }).sort({ createdAt: 1, _id: 1 });
  const names = new Map(),
    problems = [];
  for (const receipt of receipts) {
    try {
      const { phoneKey } = creditPhone(receipt.customerPhone),
        name = identityName(receipt.customerName);
      const existing = await CreditAccount.findOne({ phoneKey });
      const otherName =
        names.get(phoneKey) || (existing && identityName(existing.fullName));
      if (otherName && otherName !== name)
        throw new Error(
          'The same phone has conflicting customer names. Resolve identity before import.'
        );
      names.set(phoneKey, name);
    } catch (error) {
      problems.push({ receipt: receipt.receiptNumber, message: error.message });
    }
  }
  console.log(
    JSON.stringify(
      {
        outstandingReceipts: receipts.length,
        customerPhones: names.size,
        problems,
      },
      null,
      2
    )
  );
  if (problems.length)
    throw new Error(
      'No migration performed. Resolve the listed receipt identities first.'
    );
  if (process.argv.includes('--apply') && receipts.length) {
    const email = process.env.CREDIT_MIGRATION_ADMIN_EMAIL;
    const actor =
      email &&
      (await User.findOne({
        email: email.toLowerCase().trim(),
        role: 'admin',
        isActive: true,
      }));
    if (!actor)
      throw new Error(
        'Set CREDIT_MIGRATION_ADMIN_EMAIL to an existing active administrator.'
      );
    await CreditAccount.createIndexes();
    await CreditEntry.createIndexes();
    let imported = 0;
    for (const old of receipts) {
      await inTransaction(async (session) => {
        const receipt = await PhysicalSale.findById(old._id).session(session);
        if (!receipt || receipt.creditAccount || receipt.balanceDue <= 0)
          return;
        await adoptLegacyCreditSale(receipt, actor, session);
      });
      imported++;
    }
    console.log('Imported remaining balances from receipts:', imported);
  } else
    console.log(
      receipts.length
        ? 'Inspection only. Use --apply to import the current outstanding balances.'
        : 'No outstanding legacy receipts to import.'
    );
} catch (error) {
  console.error('Credit migration stopped:', error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
