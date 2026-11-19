import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productType: {
    type: String,
    enum: ['retail', 'fabric'],
    required: true,
  },
  name: { type: String, required: true },
  image: { type: String },
  unitPrice: { type: Number, required: true },

  // Retail specific fields
  retailVariantId: { type: mongoose.Schema.Types.ObjectId },
  size: { type: String },
  color: { type: String },
  quantity: { type: Number, min: 1 },

  // Fabric specific fields
  fabricVariantId: { type: mongoose.Schema.Types.ObjectId },
  fabricColor: { type: String },
  yards: { type: Number },
  halfYards: { type: Number }, // Integer half-yards

  subtotal: { type: Number, required: true },
});

const allowedStatusTransitions = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [], // Terminal state (Checklist 2.2.3)
  cancelled: [], // Terminal state
};

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      index: true,
      default: () => `MCL-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // Supports guest checkout (Checklist 2.1.3)
      index: true,
    },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true, trim: true },
    },
    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      deliveryTier: {
        type: String,
        enum: ['lagos_mainland', 'lagos_island', 'abuja', 'interstate', 'in_store_pickup', 'external_courier', 'local_delivery'],
        required: true,
      },
      deliveryFee: { type: Number, default: 0 },
    },
    orderItems: {
      type: [orderItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    delivery: {
      method: { type: String, enum: ['pickup', 'local', 'courier'] },
      optionId: String,
      label: String,
      description: String,
      policyVersion: String,
      feeCollectedOnline: Number,
      checkoutAcknowledgedAt: Date,
      courierStatus: { type: String, enum: ['not_required', 'awaiting_confirmation', 'confirmed'] },
      courierName: String,
      courierFee: Number,
      customerAcceptanceNote: String,
      recipientPaymentSupported: Boolean,
      confirmedAt: Date,
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      revision: { type: Number, default: 0 },
    },
    pricing: {
      subtotal: { type: Number, required: true },
      deliveryFee: { type: Number, required: true, default: 0 },
      baseAmount: { type: Number, required: true }, // subtotal + deliveryFee
      paymentFee: { type: Number, required: true }, // 2% + 100 (capped at 5000)
      totalAmount: { type: Number, required: true }, // baseAmount + paymentFee
    },
    inventory: {
      status: { type: String, enum: ['none', 'held', 'released', 'consumed'], default: 'none' },
      expiresAt: { type: Date },
      restored: { type: Map, of: Number, default: {} },
    },
    support: {
      revision: { type: Number, default: 0 },
      open: { type: Boolean, default: false },
      externalRefundReview: { type: Boolean, default: false },
      externalRefundId: String,
    },
    refundSummary: {
      active: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderRefund' },
      status: { type: String, enum: ['requested', 'processing', 'completed', 'failed'] },
      amount: Number,
    },
    guestAccessHash: { type: String, select: false },
    notificationAccess: { type: String, select: false },
    payment: {
      gateway: {
        type: String,
        enum: ['paystack', 'bachs'],
        required: true,
      },
      reference: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded', 'review'],
        default: 'pending',
        index: true,
      },
      checkoutId: { type: String, index: true },
      chargeId: { type: String, index: true },
      checkoutUrl: { type: String },
      currency: { type: String, default: 'NGN' },
      receivedAmount: { type: Number },
      collectionVerifiedAt: Date,
      recordedCollectionKobo: { type: Number, default: 0 },
      reviewReason: { type: String },
      paidAt: { type: Date },
      channel: { type: String }, // card, bank_transfer, ussd
    },
    fulfillment: {
      status: {
        type: String,
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'needs_resolution'],
        default: 'pending',
        index: true,
      },
      timeline: [
        {
          status: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
          note: { type: String },
          updatedBy: { type: String, default: 'System' },
        },
      ],
    },
    whatsappReceiptShared: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

orderSchema.index({ 'inventory.status': 1, 'inventory.expiresAt': 1 });
orderSchema.index({ 'payment.status': 1, 'payment.paidAt': 1 });

// Enforce status transition guardrails (Checklist 2.2.3)
orderSchema.pre('save', function () {
  if (this.isModified('fulfillment.status') && !this.isNew) {
    // Note: status transition checking handled here or in controller
    const prevStatus = this._originalStatus || this.fulfillment.status;
    const allowed = allowedStatusTransitions[prevStatus] || [];
    if (prevStatus !== this.fulfillment.status && !allowed.includes(this.fulfillment.status)) {
      throw new Error(`Invalid status transition from ${prevStatus} to ${this.fulfillment.status}`);
    }
  }
});

export const Order = mongoose.model('Order', orderSchema);
export default Order;
