import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

// Never call a payment provider, mailer or bot from this callback: the driver may retry it.
export async function inTransaction(work) {
  if (mongoose.connection.readyState !== 1) {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The store is temporarily unavailable. Please retry.');
  }
  try {
    return await mongoose.connection.transaction(work, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
  } catch (error) {
    if (error.code === 20 || error.codeName === 'IllegalOperation') {
      throw new AppError(503, 'TRANSACTIONS_REQUIRED', 'Sales require a MongoDB replica set. No sale was recorded.');
    }
    throw error;
  }
}
