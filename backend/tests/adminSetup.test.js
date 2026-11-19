import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import connectDatabase from '../config/database.js';
import User from '../models/User.js';
import { configureAdminAccounts } from '../services/adminSetupService.js';

const accounts = [
  { fullName: 'Setup Fixture One', email: 'admin-setup-one@example.com', phone: '08000000001', password: 'isolated_test_password' },
  { fullName: 'Setup Fixture Two', email: 'admin-setup-two@example.com', phone: '08000000002', password: 'isolated_test_password' },
];
const cleanup = () => User.deleteMany({ email: /^admin-setup-/ });
describe('Privileged two-account setup', () => {
  beforeAll(async () => { await connectDatabase(); await User.init(); });
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await mongoose.disconnect(); });
  it('creates full admins with hashed passwords and reruns without duplicate accounts', async () => {
    expect((await configureAdminAccounts(accounts)).map(a => a.action)).toEqual(['created', 'created']);
    for (const account of accounts) {
      const user = await User.findOne({ email: account.email }).select('+password');
      expect(user.role).toBe('admin'); expect(user.isActive).toBe(true);
      expect(user.password).not.toBe(account.password); expect(await user.matchPassword(account.password)).toBe(true);
    }
    expect((await configureAdminAccounts(accounts)).map(a => a.action)).toEqual(['updated', 'updated']);
    expect(await User.countDocuments({ email: /^admin-setup-/ })).toBe(2);
  });
  it('rolls back both accounts when the second phone belongs to a different email', async () => {
    await User.create({ fullName: 'Existing customer', email: 'admin-setup-conflict@example.com', phone: accounts[1].phone, password: 'existing_test_password' });
    await expect(configureAdminAccounts(accounts)).rejects.toThrow(/different existing account/);
    expect(await User.countDocuments({ email: { $in: accounts.map(a => a.email) } })).toBe(0);
    expect((await User.findOne({ email: 'admin-setup-conflict@example.com' })).role).toBe('customer');
  });
  it('rejects duplicate identities and invalid configuration before any account writes', async () => {
    await expect(configureAdminAccounts([accounts[0], accounts[0]])).rejects.toThrow(/different emails/);
    await expect(configureAdminAccounts([{ ...accounts[0], password: '' }, accounts[1]])).rejects.toThrow(/Each account needs/);
    expect(await User.countDocuments({ email: /^admin-setup-/ })).toBe(0);
  });
});
