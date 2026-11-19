import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    actor: { type: String, required: true },
    actorName: { type: String, required: true },
    refund: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderRefund' },
    details: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);
schema.index({ order: 1, createdAt: -1, _id: -1 });
export default mongoose.model('OrderAction', schema);
