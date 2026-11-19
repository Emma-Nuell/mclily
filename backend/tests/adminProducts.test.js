import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import InventoryMovement from '../models/InventoryMovement.js';

let admin, customer, retail, fabric, hidden;
const token = user => jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET, { algorithm: 'HS256' });
const get = url => request(app).get(url).set('Authorization', 'Bearer ' + token(admin));
const edit = body => request(app).put('/api/products/' + retail._id).set('Authorization', 'Bearer ' + token(admin)).send(body);
const base = { category: 'Clothing', description: 'Isolated admin test fixture', price: 1000, images: ['test.jpg'] };

describe('Admin product and order contracts for the redesigned UI', () => {
  beforeAll(async () => {
    await connectDatabase(); // Rejects non-test database names.
    for (const model of [Product, User, InventoryMovement, Order]) await model.init();
    admin = await User.create({ fullName: 'UI test admin', email: 'ui-admin@example.com', password: 'test_password', role: 'admin' });
    customer = await User.create({ fullName: 'UI test customer', email: 'ui-customer@example.com', password: 'test_password', role: 'customer' });
  });
  beforeEach(async () => {
    await Product.deleteMany({}); await InventoryMovement.deleteMany({}); await Order.deleteMany({});
    retail = await RetailProduct.create({ ...base, name: 'Shirt [Linen]', slug: 'test-admin-shirt', sizes: [{ size: 'M', color: 'Navy', stock: 5 }, { size: 'L', color: 'Navy', stock: 2 }] });
    fabric = await FabricProduct.create({ ...base, name: 'Test cotton', slug: 'test-admin-cotton', category: 'Fabrics', material: 'Cotton', pricePerYard: 1000, colorVariants: [{ colorName: 'Blue', rollStockHalfYards: 20 }, { colorName: 'Red', rollStockHalfYards: 0 }] });
    hidden = await RetailProduct.create({ ...base, name: 'Hidden fixture', slug: 'test-admin-hidden', isActive: false, sizes: [{ stock: 100 }] });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await User.deleteMany({ _id: { $in: [admin?._id, customer?._id].filter(Boolean) } });
    await mongoose.disconnect();
  });
  it('restricts management visibility to admins while keeping public catalogs and hidden details private', async () => {
    expect((await request(app).get('/api/products/manage')).status).toBe(401);
    expect((await request(app).get('/api/products/manage').set('Authorization', 'Bearer ' + token(customer))).status).toBe(403);
    const publicCatalog = await request(app).get('/api/products?visibility=hidden&catalogManagement=true');
    expect(publicCatalog.body.data.map(p => p._id)).not.toContain(String(hidden._id));
    expect((await request(app).get('/api/products/' + hidden.slug)).status).toBe(404);
    const management = await get('/api/products/manage?visibility=hidden');
    expect(management.body.total).toBe(1);
    expect(management.body.data[0]._id).toBe(String(hidden._id));
  });
  it('supports literal catalog search, pagination and low stock by individual variant', async () => {
    const literal = await get('/api/products/manage?search=%5B');
    expect(literal.status).toBe(200); expect(literal.body.total).toBe(1);
    const low = await get('/api/products/manage?lowStock=true&productType=fabric');
    expect(low.status).toBe(200); expect(low.body.total).toBe(1); expect(low.body.data[0]._id).toBe(String(fabric._id));
    const paged = await get('/api/products/manage?limit=1&page=2');
    expect(paged.body.total).toBe(3); expect(paged.body.pages).toBe(3); expect(paged.body.data).toHaveLength(1);
  });
  it('changes only the selected retail balance, requires a reason and audits the change atomically', async () => {
    const sizes = retail.sizes.toObject(); sizes[0].stock = 8;
    const body = { sizes, expectedUpdatedAt: retail.updatedAt.toISOString() };
    expect((await edit(body)).status).toBe(400);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(5);
    const res = await edit({ ...body, stockReason: 'New stock received' });
    expect(res.status).toBe(200);
    expect(res.body.data.sizes.map(v => v.stock)).toEqual([8, 2]);
    const movement = await InventoryMovement.findOne({ product: retail._id });
    expect(movement.action).toBe('correction'); expect(movement.units).toBe(3);
    expect(movement.reason).toBe('New stock received'); expect(movement.actor).toBe(String(admin._id));
    expect((await edit({ ...body, stockReason: 'Retry' })).status).toBe(409);
  });
  it('rolls back a stock edit if its audit record cannot be written', async () => {
    const sizes = retail.sizes.toObject(); sizes[0].stock = 7;
    vi.spyOn(InventoryMovement, 'create').mockRejectedValueOnce(new Error('Injected audit persistence failure'));
    expect((await edit({ sizes, stockReason: 'Stock recount', expectedUpdatedAt: retail.updatedAt.toISOString() })).status).toBe(500);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(5);
  });
  it('protects active holds and rejects duplicate variant identities', async () => {
    const duplicate = retail.sizes.toObject().map(() => ({ ...retail.sizes[0].toObject(), stock: 3 }));
    expect((await edit({ sizes: duplicate, expectedUpdatedAt: retail.updatedAt.toISOString(), stockReason: 'Recount' })).status).toBe(400);
    await RetailProduct.updateOne({ _id: retail._id }, { $set: { 'sizes.0.reservedStock': 1 } });
    const current = await RetailProduct.findById(retail._id);
    const sizes = current.sizes.toObject(); sizes[0].stock = 8; sizes[0].reservedStock = 0;
    expect((await edit({ sizes, expectedUpdatedAt: current.updatedAt.toISOString(), stockReason: 'Recount' })).status).toBe(409);
    expect((await Product.findById(retail._id)).sizes[0].reservedStock).toBe(1);
  });
  it('updates fabric yards in integer half-units without changing the other roll', async () => {
    const colorVariants = fabric.colorVariants.toObject(); colorVariants[0].rollStockHalfYards = 25;
    const res = await request(app).put('/api/products/' + fabric._id).set('Authorization', 'Bearer ' + token(admin)).send({ colorVariants,
      price: 1200, pricePerYard: 1200, expectedUpdatedAt: fabric.updatedAt.toISOString(), stockReason: 'New half-yard roll stock' });
    expect(res.status).toBe(200); expect(res.body.data.colorVariants.map(v => v.rollStockHalfYards)).toEqual([25, 0]);
    expect(res.body.data.price).toBe(1200); expect(res.body.data.pricePerYard).toBe(1200);
  });
  it('searches orders on the server and keeps the fulfillment filter', async () => {
    await Order.create({ orderNumber: 'TEST-ADMIN-ORDER', customer: { name: 'Fixture [Customer]', email: 'fixture@example.com', phone: '08012345678' },
      shippingAddress: { street: 'Test street', city: 'Lagos', state: 'Lagos', deliveryTier: 'in_store_pickup' },
      orderItems: [{ product: retail._id, productType: 'retail', name: retail.name, quantity: 1, unitPrice: 1000, subtotal: 1000 }],
      pricing: { subtotal: 1000, deliveryFee: 0, baseAmount: 1000, paymentFee: 120, totalAmount: 1120 }, payment: { gateway: 'bachs', reference: 'TEST-ADMIN-PAYMENT' }, fulfillment: { status: 'pending' } });
    const literal = await get('/api/orders?search=%5B'); expect(literal.status).toBe(200); expect(literal.body.total).toBe(1);
    expect((await get('/api/orders?search=Fixture&status=processing')).body.total).toBe(0);
  });
  it('restricts stock history to administrators, including hidden products', async () => {
    const url = '/api/products/' + hidden._id + '/stock-history';
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('Authorization', 'Bearer ' + token(customer))).status).toBe(403);
    const empty = await get(url); expect(empty.status).toBe(200); expect(empty.body.data).toEqual([]);
    expect((await get('/api/products/not-valid/stock-history')).status).toBe(400);
    expect((await get('/api/products/' + new mongoose.Types.ObjectId() + '/stock-history')).status).toBe(404);
  });
  it('pages only the selected product history and exposes administrator names without account secrets', async () => {
    const baseMovement = { product: retail._id, variant: retail.sizes[0]._id, productType: 'retail', action: 'correction', units: 2,
      stockBefore: 3, stockAfter: 5, reservedBefore: 0, reservedAfter: 0, actor: String(admin._id), source: 'HISTORY_TEST' };
    await InventoryMovement.create([
      { ...baseMovement, key: 'history-a', reason: 'First recount', createdAt: new Date('2026-11-01T09:00:00Z') },
      { ...baseMovement, key: 'history-b', reason: 'Second recount', createdAt: new Date('2026-11-02T09:00:00Z') },
      { ...baseMovement, key: 'history-other', product: hidden._id, variant: hidden.sizes[0]._id, reason: 'Different product' },
    ]);
    const first = await get('/api/products/' + retail._id + '/stock-history?limit=1&page=1');
    expect(first.body.total).toBe(2); expect(first.body.pages).toBe(2);
    expect(first.body.data[0]).toMatchObject({ reason: 'Second recount', actorName: admin.fullName, variantLabel: 'M · Navy', stockBefore: 3, stockAfter: 5, unit: 'pieces' });
    expect(first.text).not.toContain(admin.email); expect(first.text).not.toContain('password');
    const second = await get('/api/products/' + retail._id + '/stock-history?limit=1&page=2');
    expect(second.body.data[0].reason).toBe('First recount');
  });
  it('presents fabric stock history in yards while preserving integer storage units', async () => {
    const movement = await InventoryMovement.create({ key: 'history-fabric', product: fabric._id, variant: fabric.colorVariants[0]._id,
      productType: 'fabric', action: 'sell', units: 3, stockBefore: 20, stockAfter: 17, reservedBefore: 0, reservedAfter: 0, source: 'HISTORY_TEST', actor: 'System' });
    const response = await get('/api/products/' + fabric._id + '/stock-history');
    expect(response.body.data[0]).toMatchObject({ units: 1.5, stockBefore: 10, stockAfter: 8.5, unit: 'yd', variantLabel: 'Blue', actorName: 'System' });
    expect((await InventoryMovement.findById(movement._id)).units).toBe(3);
  });
});
