import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  gateway: { type: String, enum: ['bachs', 'paystack'], required: true },
  kind: { type: String, enum: ['payment', 'refund'], default: 'payment' },
  payloadHash: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  reference: String,
  checkoutId: String,
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'review'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseToken: String,
  outcome: String,
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
export default mongoose.model('PaymentEvent', schema);
