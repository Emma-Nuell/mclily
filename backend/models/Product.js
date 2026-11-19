import mongoose from 'mongoose';
import { halfYardsToYards } from '../utils/feeCalculator.js';

const baseProductOptions = {
  discriminatorKey: 'productType',
  collection: 'products',
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
};

// Base Product Schema (shared fields)
const baseProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Product slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      default: 'McLily',
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price must be non-negative'],
    },
    originalPrice: {
      type: Number,
      min: [0, 'Original price must be non-negative'],
    },
    images: {
      type: [String],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one product image is required',
      },
    },
    tags: [{ type: String, trim: true }],
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lowStockThreshold: {
      type: Number,
      default: 5, // 5 units for retail, 6 half-yards (3 yards) for fabric
    },
    deliveryRequiresQuote: { type: Boolean, default: false },
  },
  baseProductOptions
);

// Search Indexes
baseProductSchema.index({ name: 'text', description: 'text', tags: 'text', category: 'text' });
baseProductSchema.index({ category: 1, price: 1, isActive: 1 });

export const Product = mongoose.model('Product', baseProductSchema);

// ==========================================
// 1. Retail Product Discriminator
// ==========================================
const retailVariantSchema = new mongoose.Schema({
  size: { type: String, trim: true },
  color: { type: String, trim: true },
  stock: {
    type: Number,
    required: true,
    min: [0, 'Stock cannot be negative'],
    default: 0,
    validate: Number.isInteger,
  },
  reservedStock: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  priceOverride: {
    type: Number,
    min: 0,
  },
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });
retailVariantSchema.virtual('availableStock').get(function () { return Math.max(0, this.stock - this.reservedStock); });

export const RetailProduct = Product.discriminator(
  'retail',
  new mongoose.Schema({
    sizes: [retailVariantSchema],
    specifications: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
  })
);

// ==========================================
// 2. Fabric Product Discriminator (Checklist 1.1.3: Integer Half-Yards)
// ==========================================
const fabricColorVariantSchema = new mongoose.Schema(
  {
    colorName: {
      type: String,
      required: [true, 'Fabric color name is required'],
      trim: true,
    },
    swatchColor: {
      type: String, // Hex code or preview swatch image URL
      trim: true,
    },
    rollStockHalfYards: {
      type: Number,
      required: [true, 'Roll stock in half-yards is required'],
      min: [0, 'Stock cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'rollStockHalfYards must be an integer (Checklist 1.1.3)',
      },
      default: 0,
    },
    reservedHalfYards: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    image: {
      type: String,
      trim: true,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

fabricColorVariantSchema.virtual('availableHalfYards').get(function () { return Math.max(0, this.rollStockHalfYards - this.reservedHalfYards); });

// Virtual for decimal yards view
fabricColorVariantSchema.virtual('rollStockYards').get(function () {
  return halfYardsToYards(this.rollStockHalfYards);
});

export const FabricProduct = Product.discriminator(
  'fabric',
  new mongoose.Schema({
    material: {
      type: String,
      required: [true, 'Fabric material is required'],
      enum: [
        'Cotton',
        'Linen',
        'Silk',
        'Wool',
        'Denim',
        'Chiffon',
        'Satin',
        'Ankara',
        'Lace',
        'Polyester',
        'Velvet',
        'Crepe',
        'Other',
      ],
      index: true,
    },
    pricePerYard: {
      type: Number,
      required: [true, 'Price per yard is required'],
      min: [0, 'Price per yard must be non-negative'],
    },
    colorVariants: [fabricColorVariantSchema],
  })
);

export default Product;
