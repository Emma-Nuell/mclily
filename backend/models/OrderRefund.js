import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    reference: { type: String, unique: true, required: true },
    mode: { type: String, enum: ['manual', 'bachs'], required: true },
    status: {
      type: String,
      enum: ['requested', 'processing', 'completed', 'failed'],
      default: 'requested',
    },
    amountKobo: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    reason: { type: String, required: true, maxlength: 1000 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    chargeId: String,
    providerId: String,
    transferReference: { type: String, trim: true, maxlength: 200 },
    evidence: { type: String, trim: true, maxlength: 1000 },
    submissionStarted: { type: Boolean, default: false },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseToken: String,
    leaseUntil: Date,
    attempts: { type: Number, default: 0 },
    outcome: String,
    completedAt: Date,
  },
  { timestamps: true }
);
schema.index({ mode: 1, status: 1, nextAttemptAt: 1, leaseUntil: 1 });
schema.index({ status: 1, completedAt: 1 });
schema.index(
  { mode: 1, transferReference: 1 },
  {
    unique: true,
    partialFilterExpression: { transferReference: { $type: 'string' } },
  }
);
export default mongoose.model('OrderRefund', schema);
