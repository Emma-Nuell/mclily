import Product from '../models/Product.js';
import InventoryMovement from '../models/InventoryMovement.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';

export const getStockHistory = asyncHandler(async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Choose a valid product.');
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 8));
  const query = { product: product._id };
  const [total, movements] = await Promise.all([
    InventoryMovement.countDocuments(query),
    InventoryMovement.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const actorIds = [...new Set(movements.map(entry => entry.actor).filter(actor => /^[a-f0-9]{24}$/i.test(actor)))];
  const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select('fullName').lean() : [];
  const names = new Map(actors.map(actor => [String(actor._id), actor.fullName]));
  const fabric = product.productType === 'fabric', scale = fabric ? 2 : 1;
  const data = movements.map(entry => {
    const variant = (fabric ? product.colorVariants : product.sizes).id(entry.variant);
    return { _id: entry._id, action: entry.action,
      variantLabel: variant ? (fabric ? variant.colorName : [variant.size, variant.color].filter(Boolean).join(' · ') || 'Standard') : 'Previous option',
      units: entry.units / scale, unit: fabric ? 'yd' : 'pieces',
      stockBefore: entry.stockBefore / scale, stockAfter: entry.stockAfter / scale, heldAfter: entry.reservedAfter / scale,
      reason: entry.reason, actorName: names.get(entry.actor) || (entry.actor === 'System' ? 'System' : 'Administrator'), createdAt: entry.createdAt };
  });
  res.json({ success: true, total, page, pages: Math.ceil(total / limit) || 1, data });
});
