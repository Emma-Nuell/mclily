import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import env from '../config/env.js';
import connectDatabase from '../config/database.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import User from '../models/User.js';
import { applyCatalogFilters } from '../services/catalogFilterService.js';

let sequence = 0;
const item = (overrides) =>
  RetailProduct.create({
    name: 'Filter item',
    slug: 'filter-item-' + sequence++,
    description: 'Isolated filter fixture',
    category: 'Clothing',
    price: 1000,
    images: ['/images/fixture.jpg'],
    sizes: [{ size: 'M', stock: 2 }],
    ...overrides,
  });
describe('Public catalog price, stock and actual discount filters', () => {
  beforeAll(async () => {
    await connectDatabase();
    await Product.init();
    await User.init();
  });
  beforeEach(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
  });
  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await mongoose.disconnect();
  });
  it('accepts a zero budget and filters prices inclusively before pagination', async () => {
    await item({ price: 0 });
    await item({ price: 1000 });
    await item({ price: 2000 });
    const zero = await request(app).get('/api/products?minPrice=0&maxPrice=0');
    expect(zero.body.total).toBe(1);
    expect(zero.body.data[0].price).toBe(0);
    const result = await request(app).get(
      '/api/products?minPrice=1000&maxPrice=2000&limit=1&sort=price_high'
    );
    expect(result.body.total).toBe(2);
    expect(result.body.pages).toBe(2);
    expect(result.body.data[0].price).toBe(2000);
  });
  it('requires unreserved stock on an exact retail variant and hides inactive items', async () => {
    await item({
      name: 'Held',
      sizes: [{ size: 'M', stock: 3, reservedStock: 3 }],
    });
    await item({ name: 'Empty', sizes: [{ size: 'M', stock: 0 }] });
    await item({ name: 'Hidden', isActive: false });
    await item({
      name: 'Available',
      sizes: [
        { size: 'M', stock: 1, reservedStock: 1 },
        { size: 'L', stock: 1 },
      ],
    });
    const result = await request(app).get('/api/products?inStock=true');
    expect(result.body.data.map((product) => product.name)).toEqual([
      'Available',
    ]);
  });
  it('uses a one-yard available fabric balance for online stock filters', async () => {
    for (const [slug, rollStockHalfYards, reservedHalfYards] of [
      ['half', 1, 0],
      ['held', 2, 1],
      ['yard', 2, 0],
    ])
      await FabricProduct.create({
        name: slug,
        slug,
        description: 'Fabric fixture',
        category: 'Fabric',
        material: 'Linen',
        price: 1000,
        pricePerYard: 1000,
        images: ['/images/fixture.jpg'],
        colorVariants: [
          { colorName: 'Blue', rollStockHalfYards, reservedHalfYards },
        ],
      });
    const result = await request(app).get(
      '/api/products?productType=fabric&inStock=true'
    );
    expect(result.body.data.map((product) => product.slug)).toEqual(['yard']);
  });
  it('combines discount, availability and budget using recorded prices only', async () => {
    await item({ name: 'Sale', originalPrice: 1500 });
    await item({ name: 'Not a sale', originalPrice: 1000 });
    await item({ name: 'Higher current price', originalPrice: 900 });
    await item({
      name: 'Held sale',
      originalPrice: 1500,
      sizes: [{ size: 'M', stock: 1, reservedStock: 1 }],
    });
    await item({ name: 'Expensive sale', price: 3000, originalPrice: 4000 });
    const result = await request(app).get(
      '/api/products?onSale=true&inStock=true&maxPrice=2000'
    );
    expect(result.body.data.map((product) => product.name)).toEqual(['Sale']);
  });
  it('rejects malformed/range-inverted filters without changing inventory', async () => {
    await item();
    for (const query of [
      { minPrice: '-1' },
      { maxPrice: 'Infinity' },
      { minPrice: '10', maxPrice: '1' },
      { maxPrice: '1.001' },
      { inStock: 'yes' },
      { onSale: { $ne: 'false' } },
    ])
      expect(
        (await request(app).get('/api/products').query(query)).status
      ).toBe(400);
    expect((await Product.findOne()).sizes[0].stock).toBe(2);
  });
  it('combines optional admin stock expressions rather than discarding them', async () => {
    const user = await User.create({
      fullName: 'Filter admin',
      email: 'filters@example.com',
      password: 'qa_filter_password',
      role: 'admin',
    });
    await item({ name: 'Low' });
    await item({ name: 'Plenty', sizes: [{ size: 'M', stock: 10 }] });
    await item({ name: 'Zero', sizes: [{ size: 'M', stock: 0 }] });
    const response = await request(app)
      .get('/api/products/manage?lowStock=true&inStock=true')
      .set(
        'Authorization',
        'Bearer ' + jwt.sign({ id: user._id }, env.JWT_SECRET)
      );
    expect(response.status).toBe(200);
    expect(response.body.data.map((product) => product.name)).toEqual(['Low']);
    expect(
      applyCatalogFilters({ $expr: { $eq: [1, 1] } }, { onSale: 'true' }).$expr
        .$and
    ).toHaveLength(2);
  });
});
