import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    group: {
      type: String,
      enum: ['customer', 'operations', 'technical', 'financial'],
      required: true,
    },
    to: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    payload: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: [
        'pending',
        'sending',
        'sent',
        'failed',
        'uncertain',
        'expired',
        'cancelled',
      ],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    expiresAt: Date,
    leaseToken: String,
    leaseUntil: Date,
    sentAt: Date,
    messageId: String,
    lastError: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ status: 1, nextAttemptAt: 1 });
schema.index({ group: 1, createdAt: -1, _id: -1 });
export default mongoose.model('EmailOutbox', schema);
