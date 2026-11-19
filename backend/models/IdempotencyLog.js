import mongoose from 'mongoose';

const idempotencyLogSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    action: {
      type: String,
      required: true,
      enum: ['PAYMENT_WEBHOOK', 'POS_SALE', 'POS_INSTALLMENT', 'ORDER_CHECKOUT', 'CREDIT_ACCOUNT_CREATE', 'CREDIT_PAYMENT', 'CREDIT_CORRECTION', 'CREDIT_WRITE_OFF', 'ORDER_RESOLUTION', 'ORDER_DELIVERY', 'EMAIL_ACTION'],
    },
    status: {
      type: String,
      enum: ['PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'PROCESSING',
    },
    responseData: {
      type: mongoose.Schema.Types.Mixed,
    },
    requestHash: { type: String },
    createdAt: {
      type: Date,
      default: Date.now,
      // Financial deduplication records must outlive retry windows.
    },
  },
  { timestamps: true }
);

export const IdempotencyLog = mongoose.model('IdempotencyLog', idempotencyLogSchema);
export default IdempotencyLog;
