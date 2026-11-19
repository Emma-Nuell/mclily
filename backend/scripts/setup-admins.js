import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { AdminSetupError, configureAdminAccounts } from '../services/adminSetupService.js';

// Account data/passwords come from stdin; never embed them in source or seed data.
// This command touches users only and never seeds products, orders or receipts.
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(backendRoot, '.env');
try {
  if (!process.argv.includes('--apply')) throw new AdminSetupError('Use --apply to create/update the two explicitly supplied administrator accounts.');
  const configured = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
  const uri = process.env.MONGODB_URI || configured.MONGODB_URI;
  if (!uri) throw new AdminSetupError('MONGODB_URI must be configured explicitly.');
  const parsed = new URL(uri);
  if (!parsed.pathname || parsed.pathname === '/') throw new AdminSetupError('Name the intended database explicitly in MONGODB_URI before running setup.');
  // Disable terminal echo before accepting account data, including passwords.
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  console.log('Waiting for private account configuration on stdin (input hidden).');
  const input = createInterface({ input: process.stdin, terminal: false });
  let line;
  try {
    line = await new Promise((resolve, reject) => {
      input.once('line', resolve);
      input.once('close', () => reject(new AdminSetupError('No account configuration received.')));
    });
  } finally {
    input.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
    process.stdin.pause();
  }
  let data;
  try { data = JSON.parse(line); } catch { throw new AdminSetupError('Invalid account configuration JSON.'); }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw new AdminSetupError('Administrator setup requires the configured MongoDB replica set.');
  const results = await configureAdminAccounts(data.accounts);
  console.log(JSON.stringify({ database: mongoose.connection.name, accounts: results, passwordVerification: 'passed', adminCount: await User.countDocuments({ role: { $in: ['admin', 'superadmin'] } }) }));
} catch (error) {
  console.error(error instanceof AdminSetupError ? error.message : `Administrator setup failed (${error.name}; code ${error.code || 'unavailable'}). Connection strings and passwords are omitted.`);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
