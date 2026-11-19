import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, required: true },
    phoneKey: { type: String, required: true, unique: true },
    // All ledger arithmetic uses integer kobo. These are balances, not sales revenue.
    balanceKobo: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    unallocatedKobo: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    revision: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);
schema.index({ fullName: 1, _id: 1 });
export default mongoose.model('CreditAccount', schema);
