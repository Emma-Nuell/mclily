import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import PhysicalSale from '../models/PhysicalSale.js';
import InventoryMovement from '../models/InventoryMovement.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import Order from '../models/Order.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { createOrder } from '../controllers/orderController.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import { processPaymentEvent } from '../services/paymentEventService.js';
import { expireReservations } from '../services/reservationService.js';
import { recordPosSale, recordInstallment } from '../controllers/posController.js';
import { errorHandler } from '../middlewares/errorMiddleware.js';
import { inTransaction } from '../services/transactionService.js';
import { priceItems, moveInventory } from '../services/inventoryService.js';
import env from '../config/env.js';
import { deliveryOptions } from '../services/deliveryService.js';
const previousDelivery = env.DELIVERY_CONFIG_JSON;

const app = express();
app.use(express.json());
const actor = new mongoose.Types.ObjectId();
app.use((req, res, next) => { req.user = { _id: actor, fullName: 'Transaction test admin' }; next(); });
app.post('/sale', recordPosSale);
app.post('/sale/:id/payment', recordInstallment);
app.post('/order', createOrder);
app.use(errorHandler);

let retail, fabric;
const key = () => `test-${crypto.randomUUID()}`;
const item = (product = retail, quantity = 1) => ({ productId: String(product._id), retailVariantId: String(product.sizes[0]._id), quantity });
const sell = (items, overrides = {}, reference = key()) => request(app).post('/sale').send({ items, idempotencyKey: reference, ...overrides });
const checkout = items => request(app).post('/order').send({ customer: { name: 'Test customer', email: 'test@example.com', phone: '08012345678' },
  deliveryPolicyVersion: deliveryOptions().version,
  shippingAddress: { street: 'Test street', city: 'Test city', state: 'Test state', deliveryTier: 'in_store_pickup' }, items });
async function heldOrder(items = [item()]) {
  const res = await checkout(items);
  expect(res.status).toBe(201);
  return Order.findById(res.body.data.orderId);
}
async function paidEvent(order, changes = {}) {
  const verification = { isPaid: true, amount: order.pricing.totalAmount, currency: 'NGN', reference: order.payment.reference, paidAt: new Date(), ...changes };
  paymentFactory.getGateway('paystack').verifyPayment.mockResolvedValue(verification);
  return PaymentEvent.create({ key: key(), gateway: 'paystack', reference: order.payment.reference, payloadHash: key(), payload: {} });
}

describe('Real replica-set transaction integrity', () => {
  beforeAll(async () => {
    env.DELIVERY_CONFIG_JSON = JSON.stringify({ pickup: { enabled: true, address: 'Isolated test pickup address', hours: '' }, externalCourierEnabled: true, zones: [] });
    const uri = process.env.MONGODB_URI;
    // Never silently write to the application database when running integration tests.
    if (process.env.NODE_ENV !== 'test' || !uri || !/\/(mcl_test_[a-z0-9_]+)(\?|$)/i.test(uri)) {
      throw new Error('Use NODE_ENV=test and an isolated mcl_test_* database on a replica set.');
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('A replica set is required for these tests.');
    for (const model of [Product, PhysicalSale, InventoryMovement, IdempotencyLog, Order, PaymentEvent, CreditAccount, CreditEntry]) await model.init();
  });
  afterAll(async () => { vi.restoreAllMocks(); await mongoose.disconnect(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const model of [Product, PhysicalSale, InventoryMovement, IdempotencyLog, Order, PaymentEvent, CreditAccount, CreditEntry]) await model.deleteMany({});
    process.env.ACTIVE_PAYMENT_GATEWAY = 'paystack';
    vi.spyOn(paymentFactory.getGateway('paystack'), 'initializePayment').mockImplementation(async ({ orderNumber }) => ({ reference: orderNumber, authorizationUrl: 'https://test.invalid/pay', accessCode: key() }));
    vi.spyOn(paymentFactory.getGateway('paystack'), 'verifyPayment');
    retail = await RetailProduct.create({ name: 'Test shirt', slug: key(), category: 'Men', description: 'Test fixture',
      price: 1000, images: ['test.jpg'], sizes: [{ size: 'M', color: 'Blue', stock: 2 }, { size: 'L', color: 'Blue', stock: 0 }] });
    fabric = await FabricProduct.create({ name: 'Test cotton', slug: key(), category: 'Fabrics', description: 'Test fixture',
      price: 600, pricePerYard: 600, material: 'Cotton', images: ['test.jpg'], colorVariants: [{ colorName: 'Red', rollStockHalfYards: 6 }] });
  });

  it('rolls back every product and audit entry if the second item has insufficient stock', async () => {
    const res = await sell([item(), { ...item(), retailVariantId: String(retail.sizes[1]._id) }]);
    expect(res.status).toBe(409);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(2);
    expect(await PhysicalSale.countDocuments()).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect(await IdempotencyLog.countDocuments()).toBe(0);
  });
  it('rolls back stock when receipt persistence fails after the stock change', async () => {
    vi.spyOn(PhysicalSale, 'create').mockRejectedValueOnce(new Error('Injected receipt failure'));
    expect((await sell([item()])).status).toBe(500);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(2);
    expect(await InventoryMovement.countDocuments()).toBe(0);
  });
  it('allows only one of two simultaneous buyers to buy the final unit', async () => {
    await RetailProduct.updateOne({ _id: retail._id }, { $set: { 'sizes.0.stock': 1 } });
    const responses = await Promise.all([sell([item()]), sell([item()])]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(0);
    expect(await PhysicalSale.countDocuments()).toBe(1);
  });
  it('replays concurrent duplicate requests without another sale or deduction and rejects changed payloads', async () => {
    const reference = key();
    const responses = await Promise.all([sell([item()], {}, reference), sell([item()], {}, reference)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data._id).toBe(responses[1].body.data._id);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(1);
    expect((await sell([item(retail, 2)], {}, reference)).status).toBe(409);
    expect(await PhysicalSale.countDocuments()).toBe(1);
  });
  it('does not take stock from a different size and rejects ambiguous selections', async () => {
    expect((await sell([{ ...item(), retailVariantId: String(retail.sizes[1]._id) }])).status).toBe(409);
    expect((await sell([{ productId: String(retail._id), quantity: 1 }])).status).toBe(400);
  });
  it('preserves an explicit zero credit deposit, charges no POS fee and deducts half-yard units', async () => {
    const res = await sell([{ productId: String(fabric._id), fabricVariantId: String(fabric.colorVariants[0]._id), yards: 1.5 }],
      { paymentType: 'credit_installment', customerName: 'Test Customer', customerPhone: '08012345678', amountPaid: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(900);
    expect(res.body.data.amountPaid).toBe(0);
    expect(res.body.data.balanceDue).toBe(900);
    expect(res.body.data.installmentHistory).toEqual([]);
    expect((await Product.findById(fabric._id)).colorVariants[0].rollStockHalfYards).toBe(3);
  });
  it('caps concurrent installments at the balance and replays a successful installment', async () => {
    const sale = (await sell([item()], { paymentType: 'credit_installment', customerName: 'Test Customer', customerPhone: '08012345678', amountPaid: 0 })).body.data;
    const refA = key(), refB = key();
    const pay = reference => request(app).post(`/sale/${sale._id}/payment`).send({ amount: 600, idempotencyKey: reference });
    const responses = await Promise.all([pay(refA), pay(refB)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const successfulKey = responses[0].status === 200 ? refA : refB;
    expect((await pay(successfulKey)).status).toBe(200);
    const updated = await PhysicalSale.findById(sale._id);
    expect(updated.balanceDue).toBe(400);
    expect(updated.installmentHistory).toHaveLength(1);
  });
  it('protects reserved units from POS and releases them without changing physical stock', async () => {
    await inTransaction(async session => {
      const items = await priceItems([item(retail, 2)], session);
      await moveInventory(items, 'reserve', session, { source: 'test-hold' });
    });
    expect((await sell([item()])).status).toBe(409);
    await inTransaction(async session => {
      const items = await priceItems([item(retail, 2)], session);
      await moveInventory(items, 'release', session, { source: 'test-hold' });
    });
    const product = await Product.findById(retail._id);
    expect(product.sizes[0].stock).toBe(2);
    expect(product.sizes[0].reservedStock).toBe(0);
  });
  it('persists the cashier payment method and includes it in payment retry identity', async () => {
    const created = await sell([item()], { paymentType: 'credit_installment', paymentMethod: 'cash', customerName: 'Test customer', customerPhone: '08012345678', amountPaid: 0 });
    expect(created.status).toBe(201); expect(created.body.data.paymentMethod).toBe('cash');
    const reference = key(), url = '/sale/' + created.body.data._id + '/payment';
    const paid = await request(app).post(url).send({ amount: 400, paymentMethod: 'transfer', idempotencyKey: reference });
    expect(paid.status).toBe(200); expect(paid.body.data.installmentHistory[0].paymentMethod).toBe('transfer');
    const changed = await request(app).post(url).send({ amount: 400, paymentMethod: 'pos_terminal', idempotencyKey: reference });
    expect(changed.status).toBe(409);
    expect((await PhysicalSale.findById(created.body.data._id)).balanceDue).toBe(600);
  });
  it('rolls back checkout holds on any item failure and rejects half-yard online orders', async () => {
    expect((await checkout([item(), { ...item(), retailVariantId: String(retail.sizes[1]._id) }])).status).toBe(409);
    expect((await Product.findById(retail._id)).sizes[0].reservedStock).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
    expect((await checkout([{ productId: String(fabric._id), fabricVariantId: String(fabric.colorVariants[0]._id), yards: 0.5 }])).status).toBe(400);
  });
  it('releases stock after provider initialization failure and keeps a recoverable order record', async () => {
    paymentFactory.getGateway('paystack').initializePayment.mockRejectedValueOnce(new Error('Provider timeout'));
    expect((await checkout([item()])).status).toBe(503);
    expect((await Product.findById(retail._id)).sizes[0].reservedStock).toBe(0);
    expect((await Order.findOne()).inventory.status).toBe('released');
  });
  it('holds a wrong payment amount/currency for review without consuming inventory', async () => {
    const order = await heldOrder();
    const event = await paidEvent(order, { amount: order.pricing.totalAmount - 1, currency: 'USD' });
    await processPaymentEvent(event._id);
    const updated = await Order.findById(order._id);
    expect(updated.payment.status).toBe('review');
    expect(updated.fulfillment.status).toBe('needs_resolution');
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(2);
    expect((await PaymentEvent.findById(event._id)).status).toBe('completed');
  });
  it('expires a reservation without treating the payment as failed, then reacquires exact stock on late payment', async () => {
    const order = await heldOrder();
    await Order.updateOne({ _id: order._id }, { $set: { 'inventory.expiresAt': new Date(Date.now() - 1) } });
    await expireReservations();
    expect((await Order.findById(order._id)).payment.status).toBe('pending');
    const event = await paidEvent(order);
    await processPaymentEvent(event._id);
    expect((await Order.findById(order._id)).inventory.status).toBe('consumed');
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(1);
  });
  it('records a real late payment needing resolution without partially taking other stock', async () => {
    const order = await heldOrder([item(retail, 2), { productId: String(fabric._id), fabricVariantId: String(fabric.colorVariants[0]._id), yards: 1 }]);
    await Order.updateOne({ _id: order._id }, { $set: { 'inventory.expiresAt': new Date(Date.now() - 1) } });
    await expireReservations();
    expect((await sell([item(retail, 2)])).status).toBe(201);
    const event = await paidEvent(order);
    await processPaymentEvent(event._id);
    const updated = await Order.findById(order._id);
    expect(updated.payment.status).toBe('paid');
    expect(updated.fulfillment.status).toBe('needs_resolution');
    expect((await Product.findById(fabric._id)).colorVariants[0].rollStockHalfYards).toBe(6);
    expect((await PaymentEvent.findById(event._id)).status).toBe('completed');
  });
  it('commits a paid order once when different event IDs arrive concurrently', async () => {
    const order = await heldOrder();
    const eventA = await paidEvent(order), eventB = await paidEvent(order);
    await Promise.all([processPaymentEvent(eventA._id), processPaymentEvent(eventB._id)]);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(1);
    expect((await Product.findById(retail._id)).sizes[0].reservedStock).toBe(0);
    expect(await InventoryMovement.countDocuments({ action: 'capture' })).toBe(1);
    expect(await PaymentEvent.countDocuments({ status: 'completed' })).toBe(2);
  });
  it('durably retries transient provider failures without changing order payment or stock', async () => {
    const order = await heldOrder();
    const event = await paidEvent(order);
    paymentFactory.getGateway('paystack').verifyPayment.mockRejectedValueOnce(new Error('Provider offline'));
    await processPaymentEvent(event._id);
    expect((await PaymentEvent.findById(event._id)).status).toBe('failed');
    expect((await Order.findById(order._id)).payment.status).toBe('pending');
    await PaymentEvent.updateOne({ _id: event._id }, { $set: { nextAttemptAt: new Date(0) } });
    await processPaymentEvent(event._id);
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
  });
  afterAll(() => { env.DELIVERY_CONFIG_JSON = previousDelivery; });
});
