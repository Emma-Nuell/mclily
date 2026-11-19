import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditAccount',
      required: true,
    },
    sequence: { type: Number, required: true, validate: Number.isSafeInteger },
    type: {
      type: String,
      required: true,
      enum: [
        'opening_balance',
        'credit_sale',
        'legacy_balance',
        'payment',
        'balance_correction',
        'write_off',
      ],
    },
    deltaKobo: { type: Number, required: true, validate: Number.isSafeInteger },
    balanceBeforeKobo: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    balanceAfterKobo: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    reason: { type: String, trim: true, maxlength: 500 },
    paymentMethod: { type: String, enum: ['cash', 'transfer', 'pos_terminal'] },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'PhysicalSale' },
    receiptNumber: String,
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recordedByName: { type: String, required: true },
    allocations: [
      {
        sale: { type: mongoose.Schema.Types.ObjectId, ref: 'PhysicalSale' },
        amountKobo: { type: Number, min: 0, validate: Number.isSafeInteger },
      },
    ],
  },
  { timestamps: true }
);
schema.index({ account: 1, sequence: -1 }, { unique: true });
schema.index({ createdAt: 1, type: 1 });
export default mongoose.model('CreditEntry', schema);
