import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    amountKobo: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    chargeId: String,
    gateway: String,
  },
  { timestamps: true }
);
schema.index({ createdAt: 1 });
export default mongoose.model('PaymentCollection', schema);
