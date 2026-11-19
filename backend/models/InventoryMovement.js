import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  productType: { type: String, enum: ['retail', 'fabric'], required: true },
  action: { type: String, enum: ['reserve', 'release', 'capture', 'sell', 'correction', 'restore'], required: true },
  reason: String,
  units: { type: Number, required: true },
  stockBefore: { type: Number, required: true },
  stockAfter: { type: Number, required: true },
  reservedBefore: { type: Number, required: true },
  reservedAfter: { type: Number, required: true },
  source: { type: String, required: true },
  actor: { type: String, required: true },
}, { timestamps: true });
schema.index({ product: 1, createdAt: -1, _id: -1 });
export default mongoose.model('InventoryMovement', schema);
