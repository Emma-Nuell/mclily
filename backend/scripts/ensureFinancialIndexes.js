import mongoose from 'mongoose';
import connectDatabase from '../config/database.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import InventoryMovement from '../models/InventoryMovement.js';
import PaymentEvent from '../models/PaymentEvent.js';
import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import OrderRefund from '../models/OrderRefund.js';
import OrderAction from '../models/OrderAction.js';
import EmailOutbox from '../models/EmailOutbox.js';
import NotificationState from '../models/NotificationState.js';
import PaymentCollection from '../models/PaymentCollection.js';
import User from '../models/User.js';
import { telegramModels } from '../models/Telegram.js';
import PhysicalSale from '../models/PhysicalSale.js';
import Order from '../models/Order.js';

// Inspect first; use --apply only during an explicitly scheduled deployment migration.
try {
  await connectDatabase({ initializeIndexes: process.argv.includes('--apply') });
  const collection = IdempotencyLog.collection;
  const indexes = await collection.indexes().catch(error => {
    if (error.code === 26) return [];
    throw error;
  });
  const expiring = indexes.filter(index => index.key.createdAt === 1 && index.expireAfterSeconds !== undefined);
  console.log('Legacy expiring financial deduplication indexes:', expiring.map(index => index.name));
  if (process.argv.includes('--apply')) {
    for (const index of expiring) await collection.dropIndex(index.name);
    for (const model of [IdempotencyLog, InventoryMovement, PaymentEvent, CreditAccount, CreditEntry, OrderRefund, OrderAction, EmailOutbox, NotificationState, PaymentCollection, User, PhysicalSale, Order, ...telegramModels]) await model.createIndexes();
    console.log('Financial indexes prepared. No financial records were deleted.');
  } else console.log('Inspection only. No indexes changed. Re-run with --apply during the deployment migration.');
} catch (error) {
  console.error('Financial index migration failed:', error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
