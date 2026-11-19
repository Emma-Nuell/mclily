import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import Product, { RetailProduct } from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import OrderAction from '../models/OrderAction.js';
import InventoryMovement from '../models/InventoryMovement.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import EmailOutbox from '../models/EmailOutbox.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import {
  deliveryOptions,
  selectDelivery,
} from '../services/deliveryService.js';
import { renderEmail } from '../services/emailTemplates.js';

const config = {
  pickup: {
    enabled: true,
    address: 'Isolated test store, Example Street',
    hours: 'By arrangement',
  },
  externalCourierEnabled: true,
  zones: [
    {
      id: 'test_town',
      name: 'Test town',
      fee: 1200,
      states: ['Test State'],
      cities: ['Test City'],
      enabled: true,
    },
  ],
};
const original = { ...env };
let product, admin;
const models = [
  Product,
  User,
  Order,
  OrderAction,
  InventoryMovement,
  IdempotencyLog,
  EmailOutbox,
];
const address = {
  street: 'Test street',
  city: 'Test City',
  state: 'Test State',
  deliveryTier: 'external_courier',
};
const auth = () =>
  'Bearer ' + jwt.sign({ id: admin._id, role: admin.role }, env.JWT_SECRET);
const payload = (changes = {}) => ({
  customer: {
    name: 'Delivery QA',
    email: 'delivery@example.com',
    phone: '08000000000',
  },
  shippingAddress: address,
  deliveryPolicyVersion: deliveryOptions().version,
  courierDeliveryAccepted: true,
  items: [
    {
      productId: String(product._id),
      retailVariantId: String(product.sizes[0]._id),
      quantity: 1,
    },
  ],
  ...changes,
});
const checkout = (changes) =>
  request(app).post('/api/orders').send(payload(changes));
const confirmation = (changes) => ({
  idempotencyKey: crypto.randomUUID(),
  courierName: 'Example courier',
  fee: 1800,
  recipientPaymentSupported: true,
  customerAccepted: true,
  note: 'Customer accepted by WhatsApp',
  revision: 0,
  ...changes,
});
const confirm = (order, data = confirmation(), token = auth()) =>
  request(app)
    .post(`/api/orders/${order._id}/delivery/confirm`)
    .set('Authorization', token)
    .send(data);
async function paidOrder() {
  const res = await checkout();
  expect(res.status).toBe(201);
  await Order.updateOne(
    { _id: res.body.data.orderId },
    {
      $set: {
        'payment.status': 'paid',
        'inventory.status': 'consumed',
        'fulfillment.status': 'processing',
      },
    }
  );
  return Order.findById(res.body.data.orderId);
}
describe('Configured delivery and recipient-paid courier integrity', () => {
  beforeAll(async () => {
    await connectDatabase();
    for (const model of models) await model.init();
  });
  beforeEach(async () => {
    Object.assign(env, original, {
      DELIVERY_CONFIG_JSON: JSON.stringify(config),
      TELEGRAM_ENABLED: false,
    });
    for (const model of models) await model.deleteMany({});
    admin = await User.create({
      fullName: 'Delivery QA admin',
      email: 'delivery-admin@example.com',
      password: 'isolated_delivery_password',
      role: 'admin',
    });
    product = await RetailProduct.create({
      name: 'Delivery QA shirt',
      slug: crypto.randomUUID(),
      category: 'Men',
      description: 'Isolated test product',
      price: 1000,
      images: ['https://example.com/test.jpg'],
      sizes: [{ size: 'M', stock: 4 }],
    });
    vi.spyOn(
      paymentFactory.getGateway(),
      'initializePayment'
    ).mockImplementation(async ({ orderNumber }) => ({
      reference: orderNumber,
      authorizationUrl: 'https://payment.example/test',
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(env, original);
  });
  afterAll(async () => {
    for (const model of models) await model.deleteMany({});
    await mongoose.disconnect();
  });
  it('exposes only enabled configured options and fails closed for invalid settings', async () => {
    const settings = structuredClone(config);
    settings.zones[0].enabled = false;
    settings.pickup.enabled = false;
    env.DELIVERY_CONFIG_JSON = JSON.stringify(settings);
    const res = await request(app).get('/api/delivery/options');
    expect(res.body.data.options.map((v) => v.id)).toEqual([
      'external_courier',
    ]);
    expect(res.headers['cache-control']).toBe('no-store');
    env.DELIVERY_CONFIG_JSON = '{invalid';
    expect((await request(app).get('/api/delivery/options')).status).toBe(503);
  });
  it('requires fresh policy acknowledgement and ignores forged client delivery prices', async () => {
    expect((await checkout({ deliveryPolicyVersion: 'stale' })).status).toBe(
      409
    );
    expect((await checkout({ courierDeliveryAccepted: false })).status).toBe(
      400
    );
    const res = await checkout({
      shippingAddress: { ...address, deliveryFee: -1000 },
      deliveryFee: 0,
      totalAmount: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.breakdown).toMatchObject({
      subtotal: 1000,
      deliveryFee: 0,
      paymentFee: 120,
      totalAmount: 1120,
    });
    const order = await Order.findById(res.body.data.orderId);
    expect(order.delivery.courierStatus).toBe('awaiting_confirmation');
    expect(order.delivery.checkoutAcknowledgedAt).toBeInstanceOf(Date);
  });
  it('calculates fixed-zone charges on the server and rejects addresses outside the configured area', async () => {
    expect(
      (
        await checkout({
          shippingAddress: {
            ...address,
            deliveryTier: 'test_town',
            city: 'Other city',
          },
        })
      ).status
    ).toBe(400);
    const res = await checkout({
      shippingAddress: {
        ...address,
        deliveryTier: 'test_town',
        deliveryFee: 1,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.breakdown).toMatchObject({
      deliveryFee: 1200,
      paymentFee: 144,
      totalAmount: 2344,
    });
  });
  it('uses the actual configured pickup address and supports collection without a delivery address', async () => {
    const res = await checkout({
      shippingAddress: {
        deliveryTier: 'in_store_pickup',
        street: 'Forged address',
      },
    });
    expect(res.status).toBe(201);
    const order = await Order.findById(res.body.data.orderId);
    expect(order.shippingAddress.street).toBe(config.pickup.address);
    expect(order.delivery.method).toBe('pickup');
    const changed = structuredClone(config);
    changed.pickup.address = '';
    env.DELIVERY_CONFIG_JSON = JSON.stringify(changed);
    expect(() => deliveryOptions()).toThrow();
  });
  it('rejects disabled old sample zones without holding stock or opening payment', async () => {
    expect(
      (
        await checkout({
          shippingAddress: { ...address, deliveryTier: 'interstate' },
        })
      ).status
    ).toBe(400);
    expect(await Order.countDocuments()).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect(
      paymentFactory.getGateway().initializePayment
    ).not.toHaveBeenCalled();
  });
  it('blocks bulky delivery before payment and stock writes even when the client omits its quote flag', async () => {
    await RetailProduct.updateOne(
      { _id: product._id },
      { $set: { deliveryRequiresQuote: true } }
    );
    const result = await checkout();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('DELIVERY_QUOTE_REQUIRED');
    expect(await Order.countDocuments()).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect(
      paymentFactory.getGateway().initializePayment
    ).not.toHaveBeenCalled();
    expect(
      (await checkout({ shippingAddress: { deliveryTier: 'in_store_pickup' } }))
        .status
    ).toBe(201);
  });
  it('requires admin access, recipient-paid support and actual customer acceptance to record a courier', async () => {
    const order = await paidOrder();
    expect(
      (await confirm(order, confirmation(), 'Bearer invalid')).status
    ).toBe(401);
    expect(
      (await confirm(order, confirmation({ customerAccepted: false }))).status
    ).toBe(400);
    expect(
      (await confirm(order, confirmation({ recipientPaymentSupported: false })))
        .status
    ).toBe(400);
    expect((await confirm(order, confirmation({ fee: -1 }))).status).toBe(400);
    expect(await OrderAction.countDocuments()).toBe(0);
  });
  it('guards dispatch until courier confirmation and preserves the original online amount', async () => {
    const order = await paidOrder();
    const change = () =>
      request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', auth())
        .send({ status: 'shipped' });
    expect((await change()).body.code).toBe('COURIER_NOT_CONFIRMED');
    const res = await confirm(order);
    expect(res.status).toBe(200);
    const updated = await Order.findById(order._id);
    expect(updated.pricing.totalAmount).toBe(1120);
    expect(updated.pricing.deliveryFee).toBe(0);
    expect(updated.delivery.courierFee).toBe(1800);
    expect((await change()).status).toBe(200);
  });
  it('deduplicates a lost-response courier retry and guards changed details and stale revisions', async () => {
    const order = await paidOrder(),
      input = confirmation();
    expect((await confirm(order, input)).status).toBe(200);
    const retried = await confirm(order, input);
    expect(retried.body.replayed).toBe(true);
    expect((await confirm(order, { ...input, fee: 999 })).body.code).toBe(
      'IDEMPOTENCY_CONFLICT'
    );
    expect((await confirm(order, confirmation())).body.code).toBe(
      'DELIVERY_CHANGED'
    );
    expect(await OrderAction.countDocuments()).toBe(1);
  });
  it('rolls back courier confirmation and deduplication when the audit write fails', async () => {
    const order = await paidOrder();
    vi.spyOn(OrderAction, 'create').mockRejectedValueOnce(
      new Error('Injected delivery audit failure')
    );
    expect((await confirm(order)).status).toBe(500);
    expect((await Order.findById(order._id)).delivery.courierStatus).toBe(
      'awaiting_confirmation'
    );
    expect(
      await IdempotencyLog.countDocuments({ action: 'ORDER_DELIVERY' })
    ).toBe(0);
  });
  it('renders the separate courier amount honestly in customer and operations emails', async () => {
    const order = await paidOrder();
    await confirm(order);
    const current = await Order.findById(order._id);
    const data = { order: current.toObject() };
    for (const kind of ['customer_courier', 'operations_courier']) {
      const result = renderEmail(kind, data);
      expect(result.text).toContain('Example courier');
      expect(result.text).toContain('1,800');
      expect(result.text).toContain('Online payment total');
      expect(result.text).toContain('1,120');
    }
  });
  it('does not offer any checkout method when all approved delivery methods are disabled', () => {
    env.DELIVERY_CONFIG_JSON = JSON.stringify({
      pickup: { enabled: false, address: '', hours: '' },
      externalCourierEnabled: false,
      zones: [],
    });
    expect(deliveryOptions().options).toHaveLength(0);
    expect(() =>
      selectDelivery(address, deliveryOptions().version, true)
    ).toThrow();
  });
});
