import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { yardsToHalfYards } from '../utils/feeCalculator.js';
import { inTransaction } from '../services/transactionService.js';
import { AppError } from '../utils/AppError.js';
import InventoryMovement from '../models/InventoryMovement.js';
import { applyCatalogFilters } from '../services/catalogFilterService.js';

/**
 * @desc   Fetch products with typeahead search, filters, pagination
 * @route  GET /api/products
 * @access Public (Checklist 1.4.1)
 */
export const getProducts = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12));
  const skip = (page - 1) * limit;

  const query = { isActive: true };
  if (req.catalogManagement) {
    delete query.isActive;
    if (req.query.visibility === 'active') query.isActive = true;
    if (req.query.visibility === 'hidden') query.isActive = false;
  }

  // Category filter
  if (req.query.category) {
    query.category = { $regex: new RegExp(`^${req.query.category}$`, 'i') };
  }

  // Product Type filter (retail vs fabric)
  if (req.query.productType) {
    query.productType = req.query.productType;
  }

  // Fabric Material filter (Checklist 1.4.2)
  if (req.query.material) {
    query.material = { $regex: new RegExp(`^${req.query.material}$`, 'i') };
  }


  // Typeahead / Search query
  if (req.query.search) {
    if (typeof req.query.search !== 'string' || req.query.search.length > 200) throw new AppError(400, 'INVALID_SEARCH', 'Search must be at most 200 characters.');
    const searchRegex = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: searchRegex },
      { description: searchRegex },
      { tags: searchRegex },
      { brand: searchRegex },
    ];
  }

  if (req.catalogManagement && req.query.lowStock === 'true') {
    const balance = (stock, reserved) => ({ $max: [0, { $subtract: [{ $ifNull: [stock, 0] }, { $ifNull: [reserved, 0] }] }] });
    const low = (array, stock, reserved, threshold) => ({ $anyElementTrue: [{ $map: { input: { $ifNull: [array, []] }, as: 'v', in: { $lte: [balance(stock, reserved), threshold] } } }] });
    query.$expr = { $cond: [{ $eq: ['$productType', 'fabric'] }, low('$colorVariants', '$$v.rollStockHalfYards', '$$v.reservedHalfYards', 6), low('$sizes', '$$v.stock', '$$v.reservedStock', { $ifNull: ['$lowStockThreshold', 5] })] };
  }

  applyCatalogFilters(query, req.query);

  // Featured flag
  if (req.query.featured === 'true') {
    query.isFeatured = true;
  }

  // Sorting
  let sortOption = { createdAt: -1 };
  if (req.query.sort) {
    switch (req.query.sort) {
      case 'price_low':
        sortOption = { price: 1 };
        break;
      case 'price_high':
        sortOption = { price: -1 };
        break;
      case 'rating':
        sortOption = { rating: -1 };
        break;
      case 'newest':
      default:
        sortOption = { createdAt: -1 };
        break;
    }
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).sort(sortOption).skip(skip).limit(limit),
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    hasMore: skip + products.length < total,
    data: products,
  });
});

/**
 * @desc   Get single product by slug or ID
 * @route  GET /api/products/:slugOrId
 * @access Public
 */
export const getProductByIdOrSlug = asyncHandler(async (req, res) => {
  const { slugOrId } = req.params;

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(slugOrId);
  const query = isObjectId ? { $or: [{ _id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId };
  query.isActive = true;

  const product = await Product.findOne(query);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  // Related products query (same category)
  const related = await Product.find({
    category: product.category,
    _id: { $ne: product._id },
    isActive: true,
  })
    .limit(4)
    .select('name slug price originalPrice images rating reviewsCount productType');

  res.status(200).json({
    success: true,
    data: product,
    related,
  });
});

/**
 * @desc   Create product (Quick Post or standard)
 * @route  POST /api/products
 * @access Admin only
 */
export const createProduct = asyncHandler(async (req, res) => {
  const { productType = 'retail', ...productData } = req.body;

  // Auto-generate slug if not provided
  if (!productData.slug && productData.name) {
    productData.slug = productData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') + `-${Date.now().toString(36)}`;
  }

  let newProduct;

  if (productType === 'fabric') {
    if (!productData.pricePerYard && productData.price) {
      productData.pricePerYard = productData.price;
    }
    // Convert any decimal rollStockYards to integer half-yards (Checklist 1.1.3)
    if (Array.isArray(productData.colorVariants)) {
      productData.colorVariants = productData.colorVariants.map((variant) => ({
        ...variant,
        rollStockHalfYards:
          variant.rollStockHalfYards !== undefined
            ? Math.round(variant.rollStockHalfYards)
            : yardsToHalfYards(variant.rollStockYards || 10),
      }));
    }
    newProduct = await FabricProduct.create(productData);
  } else {
    newProduct = await RetailProduct.create(productData);
  }

  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    data: newProduct,
  });
});

/**
 * @desc   Update product
 * @route  PUT /api/products/:id
 * @access Admin only
 */
export const updateProduct = asyncHandler(async (req, res) => {
  const updatedProduct = await inTransaction(async session => {
    const product = await Product.findById(req.params.id).session(session);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const updates = { ...req.body }, fabric = product.productType === 'fabric';
    const field = fabric ? 'colorVariants' : 'sizes', stockField = fabric ? 'rollStockHalfYards' : 'stock';
    const before = product[field].map(v => ({ id: String(v._id), stock: v[stockField], reserved: v[fabric ? 'reservedHalfYards' : 'reservedStock'] || 0 }));
    if (updates[field]) {
      if (!Array.isArray(updates[field]) || updates[field].length !== before.length || updates[field].some(v => !before.some(b => b.id === String(v._id))) || new Set(updates[field].map(v => String(v._id))).size !== before.length) {
        throw new AppError(400, 'INVALID_VARIANTS', 'Edit existing sizes or colours individually.');
      }
      if (!updates.expectedUpdatedAt || new Date(updates.expectedUpdatedAt).getTime() !== product.updatedAt.getTime()) throw new AppError(409, 'PRODUCT_CHANGED', 'Stock changed. Refresh this product before editing stock.');
      if (before.some(v => v.reserved > 0)) throw new AppError(409, 'STOCK_RESERVED', 'A checkout is holding this stock. Retry after it finishes or expires.');
      updates[field] = updates[field].map(v => {
        const { reservedStock, reservedHalfYards, ...editable } = v;
        if (!Number.isSafeInteger(editable[stockField]) || editable[stockField] < 0) throw new AppError(400, 'INVALID_STOCK', 'Enter a non-negative stock quantity in the correct units.');
        return { ...editable, ...(fabric ? { reservedHalfYards: 0 } : { reservedStock: 0 }) };
      });
    }
    // Keep the other product discriminator's fields out of this update.
    delete updates[fabric ? 'sizes' : 'colorVariants'];
    const corrections = (updates[field] || []).filter(v => before.find(b => b.id === String(v._id)).stock !== v[stockField]);
    const reason = typeof updates.stockReason === 'string' ? updates.stockReason.trim() : '';
    if (corrections.length && (reason.length < 3 || reason.length > 500)) throw new AppError(400, 'CORRECTION_REASON_REQUIRED', 'Give a short reason for the stock change.');
    const version = product.updatedAt.getTime();
    const editableFields = ['name', 'slug', 'category', 'subCategory', 'brand', 'description', 'price', 'originalPrice', 'images', 'tags', 'isFeatured', 'isActive', 'lowStockThreshold', 'deliveryRequiresQuote', field, 'specifications', 'material', 'pricePerYard'];
    for (const key of editableFields) if (Object.hasOwn(updates, key)) product.set(key, updates[key]);
    if (fabric && updates.price !== undefined && updates.pricePerYard === undefined) product.pricePerYard = updates.price;
    if (fabric && updates.pricePerYard !== undefined) product.price = updates.pricePerYard;
    await product.save({ session });
    for (const variant of corrections) {
      const previous = before.find(v => v.id === String(variant._id));
      await InventoryMovement.create([{ key: `ADMIN_${product._id}:${version}:${variant._id}`, product: product._id, variant: variant._id,
        productType: product.productType, action: 'correction', units: Math.abs(variant[stockField] - previous.stock), reason,
        stockBefore: previous.stock, stockAfter: variant[stockField], reservedBefore: previous.reserved, reservedAfter: 0,
        source: `ADMIN_${product._id}`, actor: String(req.user._id),
      }], { session });
    }
    return product;
  });
  res.status(200).json({ success: true, message: 'Product updated successfully', data: updatedProduct });
});

/**
 * @desc   Delete product (Soft-delete or purge)
 * @route  DELETE /api/products/:id
 * @access Admin only
 */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  // Soft delete by setting isActive: false
  product.isActive = false;
  await product.save();

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully',
  });
});
