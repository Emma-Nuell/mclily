import mongoose from 'mongoose';
import User from '../models/User.js';

export class AdminSetupError extends Error {}

export async function configureAdminAccounts(input) {
  if (!Array.isArray(input) || input.length !== 2) throw new AdminSetupError('Provide exactly the two administrator accounts.');
  const accounts = input.map(account => {
    if (!account || typeof account.fullName !== 'string' || !account.fullName.trim() ||
      typeof account.email !== 'string' || !/^\S+@\S+\.\S+$/.test(account.email.trim()) ||
      typeof account.phone !== 'string' || !/^\d{10,15}$/.test(account.phone.trim()) ||
      typeof account.password !== 'string' || account.password.length < 6) {
      throw new AdminSetupError('Each account needs a name, valid email, phone and password of at least six characters.');
    }
    return { fullName: account.fullName.trim(), email: account.email.trim().toLowerCase(), phone: account.phone.trim(), password: account.password };
  });
  if (new Set(accounts.map(a => a.email)).size !== 2 || new Set(accounts.map(a => a.phone)).size !== 2) {
    throw new AdminSetupError('The administrators must have different emails and phone numbers.');
  }
  if (mongoose.connection.readyState !== 1) throw new AdminSetupError('Connect to the configured database first.');

  // The business database may be new; only prepare the users collection.
  await User.createCollection();
  const results = await mongoose.connection.transaction(async session => {
    const saved = [];
    for (const account of accounts) {
      const matches = await User.find({ $or: [{ email: account.email }, { phone: account.phone }] }).select('+password').session(session);
      if (matches.length > 1 || (matches.length === 1 && matches[0].email !== account.email)) {
        throw new AdminSetupError('An email or phone matches a different existing account. No account changes were committed.');
      }
      const existing = matches[0];
      const user = existing || new User();
      Object.assign(user, account, { role: 'admin', isActive: true });
      // Use save so the existing bcrypt password-hashing hook runs.
      await user.save({ session });
      saved.push({ fullName: user.fullName, email: user.email, role: user.role, action: existing ? 'updated' : 'created' });
    }
    return saved;
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });

  for (const account of accounts) {
    const user = await User.findOne({ email: account.email }).select('+password');
    if (!user || user.role !== 'admin' || !user.isActive || user.phone !== account.phone || user.password === account.password || !(await user.matchPassword(account.password))) {
      throw new AdminSetupError('Account write completed but verification failed. Check the database before retrying.');
    }
  }
  return results;
}
