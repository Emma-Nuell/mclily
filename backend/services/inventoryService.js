import mongoose from 'mongoose';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import InventoryMovement from '../models/InventoryMovement.js';
import { AppError } from '../utils/AppError.js';
import { yardsToHalfYards } from '../utils/feeCalculator.js';

function validId(value) { return typeof value === 'string' && mongoose.isObjectIdOrHexString(value); }

export async function priceItems(items, session, { minimumYards = 1, deliveryMethod } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new AppError(400, 'INVALID_ITEMS', 'Choose between 1 and 100 items.');
  }
  const priced = [];
  // Deliberately sequential: parallel operations on a transaction session are unsupported.
  for (const input of items) {
    if (!validId(input.productId)) throw new AppError(400, 'INVALID_PRODUCT', 'Invalid product identifier.');
    const product = await Product.findOne({ _id: input.productId, isActive: true }).session(session);
    if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'A selected product is unavailable.');
    if (deliveryMethod && deliveryMethod !== 'pickup' && product.deliveryRequiresQuote) throw new AppError(409, 'DELIVERY_QUOTE_REQUIRED', 'This bag includes an item that needs a delivery quote. Contact McLily on WhatsApp before paying, or choose store collection if available.');
    if (product.productType === 'retail') {
      let variants;
      if (input.retailVariantId) {
        if (!validId(input.retailVariantId)) throw new AppError(400, 'INVALID_VARIANT', 'Invalid variant identifier.');
        variants = product.sizes.filter(v => String(v._id) === input.retailVariantId);
      } else {
        variants = product.sizes.filter(v => (input.size === undefined || v.size === input.size) &&
          (input.color === undefined || v.color === input.color));
      }
      if (variants.length !== 1) throw new AppError(400, 'CHOOSE_VARIANT', 'Choose an exact size and colour.');
      if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10000) {
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be a positive whole number.');
      }
      const variant = variants[0];
      const unitPrice = variant.priceOverride ?? product.price;
      priced.push({ product: product._id, productType: 'retail', retailVariantId: variant._id,
        name: product.name, image: product.images[0], size: variant.size, color: variant.color,
        unitPrice, quantity: input.quantity, subtotal: unitPrice * input.quantity });
    } else {
      if (!validId(input.fabricVariantId)) throw new AppError(400, 'INVALID_VARIANT', 'Choose a fabric colour.');
      const variant = product.colorVariants.id(input.fabricVariantId);
      if (!variant) throw new AppError(400, 'INVALID_VARIANT', 'The fabric colour is unavailable.');
      const yards = Number(input.yards);
      if (!Number.isFinite(yards) || yards < minimumYards || yards > 10000) {
        throw new AppError(400, 'INVALID_YARDS', `Choose at least ${minimumYards} yard(s).`);
      }
      let halfYards;
      try { halfYards = yardsToHalfYards(yards); }
      catch { throw new AppError(400, 'INVALID_YARDS', 'Choose yards in half-yard increments.'); }
      priced.push({ product: product._id, productType: 'fabric', fabricVariantId: variant._id,
        name: product.name, image: variant.image || product.images[0], fabricColor: variant.colorName,
        unitPrice: product.pricePerYard, yards, halfYards, subtotal: product.pricePerYard * yards });
    }
  }
  if (priced.some(item => !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isSafeInteger(Math.round(item.subtotal * 100)))) {
    throw new AppError(409, 'INVALID_PRICE', 'A product price needs correction before it can be sold.');
  }
  return priced;
}

export async function moveInventory(items, action, session, { source, actor = 'System', reason }) {
  if (!session?.inTransaction() || !['reserve', 'release', 'capture', 'sell', 'restore'].includes(action) || !source) {
    throw new Error('Inventory changes require a transaction, source and valid action.');
  }
  for (const [index, item] of items.entries()) {
    const fabric = item.productType === 'fabric';
    const array = fabric ? 'colorVariants' : 'sizes';
    const stockField = fabric ? 'rollStockHalfYards' : 'stock';
    const reservedField = fabric ? 'reservedHalfYards' : 'reservedStock';
    const units = fabric ? item.halfYards : item.quantity;
    const product = await Product.findById(item.product).session(session);
    let variantId = fabric ? item.fabricVariantId : item.retailVariantId;
    if (!variantId && !fabric && product) {
      const matches = product.sizes.filter(v => (item.size === undefined || v.size === item.size) && (item.color === undefined || v.color === item.color));
      if (matches.length === 1) variantId = matches[0]._id;
    }
    const variant = product?.[array].id(variantId);
    if (!variant || !Number.isSafeInteger(units) || units <= 0) {
      throw new AppError(409, 'OUT_OF_STOCK', 'The selected stock is no longer available.');
    }
    const stock = variant[stockField];
    const reserved = variant[reservedField] || 0;
    const enough = action === 'restore' ? true : action === 'release' ? reserved >= units : action === 'capture'
      ? reserved >= units && stock >= units : product.isActive && stock - reserved >= units;
    if (!enough) throw new AppError(409, 'OUT_OF_STOCK', 'The selected quantity is no longer available.');
    const stockDelta = action === 'restore' ? units : ['sell', 'capture'].includes(action) ? -units : 0;
    if (!Number.isSafeInteger(stock + stockDelta)) throw new AppError(409, 'INVALID_STOCK', 'This stock balance needs review.');
    const reservedDelta = action === 'reserve' ? units : ['capture', 'release'].includes(action) ? -units : 0;
    // One $elemMatch ties variant identity AND both balances to the same member.
    const model = fabric ? FabricProduct : RetailProduct;
    const updated = await model.findOneAndUpdate({ _id: product._id, [array]: { $elemMatch: {
      _id: variant._id, [stockField]: stock,
      [reservedField]: reserved === 0 ? { $in: [0, null] } : reserved,
    } } }, { $inc: { [`${array}.$.${stockField}`]: stockDelta, [`${array}.$.${reservedField}`]: reservedDelta } }, { session, returnDocument: 'after' });
    if (!updated) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed. Please retry the sale.');
    await InventoryMovement.create([{ key: `${source}:${action}:${index}`, product: product._id,
      variant: variant._id, productType: item.productType, action, units, source, actor, reason,
      stockBefore: stock, stockAfter: stock + stockDelta, reservedBefore: reserved, reservedAfter: reserved + reservedDelta }], { session });
  }
}
