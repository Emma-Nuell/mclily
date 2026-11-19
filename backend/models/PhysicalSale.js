import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const physicalSaleItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  retailVariantId: { type: mongoose.Schema.Types.ObjectId },
  fabricVariantId: { type: mongoose.Schema.Types.ObjectId },
  size: String,
  color: String,
  productType: {
    type: String,
    enum: ['retail', 'fabric'],
    required: true,
  },
  name: { type: String, required: true },
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  halfYards: { type: Number },
  subtotal: { type: Number, required: true },
});

const physicalSaleSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      unique: true,
      index: true,
      default: () =>
        `POS-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`,
    },
    customerName: {
      type: String,
      trim: true,
      default: 'Walk-in Customer',
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    creditAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditAccount',
      index: true,
    },
    amountForgiven: { type: Number, default: 0, min: 0 },
    amountAdjusted: { type: Number, default: 0, min: 0 },
    creditAdjustments: [
      {
        type: { type: String, enum: ['balance_correction', 'write_off'] },
        amount: { type: Number, min: 0 },
        reason: String,
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        recordedByName: String,
        date: { type: Date, default: Date.now },
      },
    ],
    items: [physicalSaleItemSchema],
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentType: {
      type: String,
      enum: ['full', 'credit_installment'],
      default: 'full',
      index: true,
    },
    paymentMethod: { type: String, enum: ['cash', 'transfer', 'pos_terminal'] },
    initialAmountPaid: { type: Number, min: 0 },
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
      min: 0,
    },
    installmentHistory: [
      {
        amount: { type: Number, required: true },
        paymentMethod: {
          type: String,
          enum: ['cash', 'transfer', 'pos_terminal'],
        },
        date: { type: Date, default: Date.now },
        note: { type: String },
        receivedBy: { type: String },
      },
    ],
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

physicalSaleSchema.index({
  creditAccount: 1,
  balanceDue: 1,
  createdAt: 1,
  _id: 1,
});

physicalSaleSchema.index({ createdAt: 1 });
export const PhysicalSale = mongoose.model('PhysicalSale', physicalSaleSchema);
export default PhysicalSale;
