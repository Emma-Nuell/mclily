import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import OrderRefund from '../models/OrderRefund.js';
import OrderAction from '../models/OrderAction.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import InventoryMovement from '../models/InventoryMovement.js';
import PaymentEvent from '../models/PaymentEvent.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import {
  processRefund,
  processRefundEvent,
} from '../services/refundService.js';
import telegramBotService from '../services/telegramBotService.js';

let admin, customer, retail, fabric, order, gateway;
const key = () => crypto.randomUUID();
const auth = (user) =>
  'Bearer ' +
  jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
  });
const change = async (
  action,
  payload = {},
  nonce = key(),
  id = String(order._id)
) => {
  const current = await Order.findById(id);
  return request(app)
    .post(`/api/orders/${id}/resolution/${action}`)
    .set('Authorization', auth(admin))
    .send({
      reason: 'Isolated QA reason',
      expectedRevision: current.support.revision,
      idempotencyKey: nonce,
      ...payload,
    });
};
async function refundRequest(mode = 'manual') {
  const response = await change('refund-request', {
    mode,
    providerChecked: true,
  });
  expect(response.status).toBe(200);
  return OrderRefund.findOne({ order: order._id }).sort({ createdAt: -1 });
}
async function start(mode = 'manual') {
  const refund = await refundRequest(mode);
  expect(
    (await change('refund-start', { refundId: String(refund._id) })).status
  ).toBe(200);
  return refund;
}
function providerResult(refund, overrides = {}) {
  return {
    refund_id: 'rfnd_test',
    charge_id: refund.chargeId,
    reference: refund.reference,
    requested_amount: '3262.00',
    refunded_amount: '3262.00',
    fee_bearer: 'org',
    status: 'success',
    ...overrides,
  };
}

describe('Order issues, refund reconciliation and inspected stock on a real replica set', () => {
  beforeAll(async () => {
    await connectDatabase();
    for (const model of [
      User,
      Order,
      OrderRefund,
      OrderAction,
      Product,
      InventoryMovement,
      PaymentEvent,
      IdempotencyLog,
    ])
      await model.init();
    admin = await User.create({
      fullName: 'Resolution test admin',
      email: 'resolution-admin@example.com',
      password: 'isolated_password',
      role: 'admin',
    });
    customer = await User.create({
      fullName: 'Resolution customer',
      email: 'resolution-customer@example.com',
      password: 'isolated_password',
    });
  });
  afterAll(async () => {
    await User.deleteMany({
      _id: { $in: [admin?._id, customer?._id].filter(Boolean) },
    });
    await mongoose.disconnect();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    for (const model of [
      Order,
      OrderRefund,
      OrderAction,
      Product,
      InventoryMovement,
      PaymentEvent,
      IdempotencyLog,
    ])
      await model.deleteMany({});
    env.BACHS_REFUNDS_ENABLED = true;
    retail = await RetailProduct.create({
      name: 'Resolution shirt',
      slug: key(),
      category: 'Clothing',
      description: 'Isolated fixture',
      price: 1000,
      images: ['test.jpg'],
      sizes: [
        { size: 'M', stock: 3 },
        { size: 'L', stock: 10 },
      ],
    });
    fabric = await FabricProduct.create({
      name: 'Resolution cotton',
      slug: key(),
      category: 'Fabrics',
      description: 'Isolated fixture',
      price: 600,
      images: ['test.jpg'],
      pricePerYard: 600,
      material: 'Cotton',
      colorVariants: [{ colorName: 'Blue', rollStockHalfYards: 20 }],
    });
    order = await Order.create({
      customer: {
        name: 'Order customer',
        email: 'order@example.com',
        phone: '08012345678',
      },
      shippingAddress: {
        street: 'Test street',
        city: 'Test city',
        state: 'Test state',
        deliveryTier: 'in_store_pickup',
      },
      orderItems: [
        {
          product: retail._id,
          productType: 'retail',
          name: retail.name,
          retailVariantId: retail.sizes[0]._id,
          quantity: 2,
          unitPrice: 1000,
          subtotal: 2000,
        },
        {
          product: fabric._id,
          productType: 'fabric',
          name: fabric.name,
          fabricVariantId: fabric.colorVariants[0]._id,
          yards: 1.5,
          halfYards: 3,
          unitPrice: 600,
          subtotal: 900,
        },
      ],
      pricing: {
        subtotal: 2900,
        deliveryFee: 200,
        baseAmount: 3100,
        paymentFee: 162,
        totalAmount: 3262,
      },
      payment: {
        gateway: 'bachs',
        reference: 'PAY-' + key(),
        checkoutId: 'chk_' + key(),
        chargeId: 'ch_' + key(),
        status: 'paid',
        receivedAmount: 3262,
        currency: 'NGN',
        channel: 'NGN_CARD',
      },
      inventory: { status: 'consumed' },
      fulfillment: { status: 'processing' },
    });
    gateway = paymentFactory.getGateway('bachs');
    vi.spyOn(gateway, 'getRefundByCharge').mockResolvedValue(null);
    vi.spyOn(gateway, 'getRefund').mockRejectedValue(
      new Error('Unconfigured test result')
    );
    vi.spyOn(gateway, 'getRefundPayment').mockResolvedValue({
      reference: order.payment.reference,
      currency: 'NGN',
      amount_paid: '3262.00',
      payment_method: 'NGN_CARD',
      is_refundable: true,
      status: 'succeeded',
    });
    vi.spyOn(gateway, 'createRefund').mockRejectedValue(
      new Error('No simulated provider result configured')
    );
    vi.spyOn(gateway, 'verifyPayment').mockResolvedValue({
      isPaid: true,
      amount: 3262,
      currency: 'NGN',
      reference: order.payment.reference,
      checkoutId: order.payment.checkoutId,
      chargeId: order.payment.chargeId,
      channel: 'NGN_CARD',
    });
    vi.spyOn(telegramBotService, 'sendOrderNotification').mockResolvedValue();
  });
  it('keeps private issue and refund history restricted to administrators', async () => {
    const url = `/api/orders/${order._id}/resolution`;
    expect((await request(app).get(url)).status).toBe(401);
    expect(
      (await request(app).get(url).set('Authorization', auth(customer))).status
    ).toBe(403);
    expect(
      (await change('issue', { reason: 'Private bank investigation note' }))
        .status
    ).toBe(200);
    const page = await request(app).get(url).set('Authorization', auth(admin));
    expect(page.body.data.actions[0].reason).toContain('Private bank');
    expect(page.body.data.actions[0].actorName).toBe(admin.fullName);
    expect(page.text).not.toContain(admin.email);
    order.user = customer._id;
    await Order.updateOne({ _id: order._id }, { user: customer._id });
    const publicOrder = await request(app)
      .get('/api/orders/' + order._id)
      .set('Authorization', auth(customer));
    expect(publicOrder.status).toBe(200);
    expect(publicOrder.text).not.toContain('Private bank');
    expect(publicOrder.body.data.support).toBeUndefined();
  });
  it('records reasoned issues, blocks dispatch, closes them and rejects stale revisions', async () => {
    expect((await change('issue', { reason: '' })).status).toBe(400);
    expect((await change('issue')).status).toBe(200);
    expect(
      (
        await request(app)
          .put(`/api/orders/${order._id}/status`)
          .set('Authorization', auth(admin))
          .send({ status: 'shipped' })
      ).status
    ).toBe(409);
    expect((await change('note', { expectedRevision: 0 })).status).toBe(409);
    expect((await change('resolve')).status).toBe(200);
    expect((await Order.findById(order._id)).support.open).toBe(false);
    expect(await OrderAction.countDocuments()).toBe(2);
  });
  it('recovers exact stock once and safely replays a successful response', async () => {
    await Order.updateOne(
      { _id: order._id },
      {
        'inventory.status': 'released',
        'fulfillment.status': 'needs_resolution',
      }
    );
    const nonce = key();
    const payload = {
      reason: 'All exact stock now available',
      expectedRevision: 0,
    };
    expect((await change('resolve', payload, nonce)).status).toBe(200);
    expect((await change('resolve', payload, nonce)).status).toBe(200);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(1);
    expect(
      (await Product.findById(fabric._id)).colorVariants[0].rollStockHalfYards
    ).toBe(17);
    expect((await Order.findById(order._id)).fulfillment.status).toBe(
      'processing'
    );
    expect(await InventoryMovement.countDocuments()).toBe(2);
  });
  it('rolls back all recovery stock if any exact item is unavailable', async () => {
    await Order.updateOne(
      { _id: order._id },
      {
        'inventory.status': 'released',
        'fulfillment.status': 'needs_resolution',
      }
    );
    await FabricProduct.updateOne(
      { _id: fabric._id },
      { 'colorVariants.0.rollStockHalfYards': 0 }
    );
    expect((await change('resolve')).status).toBe(409);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(3);
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect(await OrderAction.countDocuments()).toBe(0);
  });
  it('rejects preparation/refunds for unresolved or mismatched payments', async () => {
    await Order.updateOne(
      { _id: order._id },
      { 'payment.status': 'review', 'fulfillment.status': 'needs_resolution' }
    );
    expect((await change('resolve')).status).toBe(409);
    expect(
      (
        await change('refund-request', {
          mode: 'manual',
          providerChecked: true,
        })
      ).status
    ).toBe(409);
    await Order.updateOne(
      { _id: order._id },
      { 'payment.status': 'paid', 'payment.receivedAmount': 1000 }
    );
    expect((await change('resolve')).status).toBe(409);
  });
  it('records the full collected refund including service/delivery without automatically restoring goods', async () => {
    const refund = await refundRequest();
    expect(refund.amountKobo).toBe(326200);
    expect(refund.status).toBe('requested');
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(3);
    expect(gateway.createRefund).not.toHaveBeenCalled();
  });
  it('creates one refund for concurrent duplicate requests and blocks different active requests', async () => {
    const nonce = key();
    const payload = {
      mode: 'manual',
      providerChecked: true,
      expectedRevision: 0,
    };
    const responses = await Promise.all([
      change('refund-request', payload, nonce),
      change('refund-request', payload, nonce),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await OrderRefund.countDocuments()).toBe(1);
    expect((await change('refund-request', payload)).status).toBe(409);
  });
  it('needs evidence and explicit confirmation before completing a manual refund', async () => {
    const refund = await start();
    expect(
      (await change('refund-complete', { refundId: String(refund._id) })).status
    ).toBe(400);
    expect(
      (
        await change('refund-complete', {
          refundId: String(refund._id),
          sentConfirmed: true,
          transferReference: 'BANK-QA-001',
          evidence: 'Bank receipt checked in the account statement',
        })
      ).status
    ).toBe(200);
    const current = await Order.findById(order._id);
    expect(current.payment.status).toBe('refunded');
    expect(current.fulfillment.status).toBe('cancelled');
    expect(current.support.open).toBe(false);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(3);
    expect(
      (
        await change('refund-request', {
          mode: 'manual',
          providerChecked: true,
        })
      ).status
    ).toBe(409);
  });
  it('keeps an uncertain manual transfer processing until no-money-moved is explicitly confirmed', async () => {
    const refund = await start();
    expect(
      (await change('refund-fail', { refundId: String(refund._id) })).status
    ).toBe(400);
    expect(
      (
        await change('refund-fail', {
          refundId: String(refund._id),
          noMoneyMoved: true,
        })
      ).status
    ).toBe(200);
    expect((await OrderRefund.findById(refund._id)).status).toBe('failed');
    expect((await refundRequest()).status).toBe('requested');
  });
  it('requires inspection, restores only selected variant/half-yards and prevents repeated over-restocking', async () => {
    await Order.updateOne(
      { _id: order._id },
      { 'fulfillment.status': 'cancelled' }
    );
    const items = [
      { itemId: String(order.orderItems[0]._id), quantity: 1 },
      { itemId: String(order.orderItems[1]._id), yards: 0.5 },
    ];
    expect((await change('restock', { items })).status).toBe(409);
    const nonce = key(),
      payload = { items, inspected: true, expectedRevision: 0 };
    expect((await change('restock', payload, nonce)).status).toBe(200);
    expect((await change('restock', payload, nonce)).status).toBe(200);
    expect(
      (await Product.findById(retail._id)).sizes.map((item) => item.stock)
    ).toEqual([4, 10]);
    expect(
      (await Product.findById(fabric._id)).colorVariants[0].rollStockHalfYards
    ).toBe(21);
    expect(
      (
        await change('restock', {
          inspected: true,
          items: [{ itemId: String(order.orderItems[0]._id), quantity: 2 }],
        })
      ).status
    ).toBe(409);
    expect(await InventoryMovement.countDocuments({ action: 'restore' })).toBe(
      2
    );
  });
  it('rolls back restored stock and its quantity cap if audit persistence fails', async () => {
    await Order.updateOne(
      { _id: order._id },
      { 'fulfillment.status': 'cancelled' }
    );
    vi.spyOn(OrderAction, 'create').mockRejectedValueOnce(
      new Error('Injected audit failure')
    );
    expect(
      (
        await change('restock', {
          inspected: true,
          items: [{ itemId: String(order.orderItems[0]._id), quantity: 1 }],
        })
      ).status
    ).toBe(500);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(3);
    expect((await Order.findById(order._id)).inventory.restored.size).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
  });
  it('queues a Bachs card refund and waits for a verified provider outcome', async () => {
    const refund = await start('bachs');
    gateway.createRefund.mockResolvedValue(
      providerResult(refund, { status: 'processing', refunded_amount: null })
    );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('processing');
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
    gateway.getRefund.mockResolvedValue(providerResult(refund));
    await OrderRefund.updateOne(
      { _id: refund._id },
      { nextAttemptAt: new Date(0) }
    );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('completed');
    expect((await Order.findById(order._id)).payment.status).toBe('refunded');
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  });
  it('never automatically refunds NGN transfers or ineligible provider payments', async () => {
    const refund = await start('bachs');
    gateway.getRefundPayment.mockResolvedValue({
      reference: order.payment.reference,
      currency: 'NGN',
      amount_paid: '3262.00',
      payment_method: 'NGN_BANK_TRANSFER',
      is_refundable: false,
      status: 'succeeded',
    });
    await processRefund(refund._id);
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect((await OrderRefund.findById(refund._id)).status).toBe('processing');
    expect(
      (
        await change('refund-complete', {
          refundId: String(refund._id),
          sentConfirmed: true,
          transferReference: 'wrong',
          evidence: 'wrong',
        })
      ).status
    ).toBe(409);
  });
  it('reconciles a lost provider response without a second outgoing refund', async () => {
    const refund = await start('bachs');
    gateway.createRefund.mockRejectedValue(
      new Error('Lost response after provider accepted')
    );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).submissionStarted).toBe(
      true
    );
    await OrderRefund.updateOne(
      { _id: refund._id },
      { nextAttemptAt: new Date(0) }
    );
    await processRefund(refund._id);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    gateway.getRefundByCharge.mockResolvedValue(providerResult(refund));
    await OrderRefund.updateOne(
      { _id: refund._id },
      { nextAttemptAt: new Date(0) }
    );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('completed');
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  });
  it('does not accept a provider result with another charge or a short customer refund', async () => {
    const refund = await start('bachs');
    gateway.getRefundByCharge.mockResolvedValue(
      providerResult(refund, { charge_id: 'ch_someone_else' })
    );
    await processRefund(refund._id);
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
    gateway.getRefundByCharge.mockResolvedValue(
      providerResult(refund, { refunded_amount: '3000.00' })
    );
    await OrderRefund.updateOne(
      { _id: refund._id },
      { nextAttemptAt: new Date(0) }
    );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('processing');
  });
  it('verifies provider refund events remotely and applies duplicate/out-of-order results once', async () => {
    const refund = await start('bachs');
    gateway.getRefund.mockResolvedValue(providerResult(refund));
    const event = await PaymentEvent.create({
      key: key(),
      kind: 'refund',
      gateway: 'bachs',
      payloadHash: key(),
      payload: { data: { refund_id: 'rfnd_test' } },
      status: 'processing',
      leaseToken: key(),
    });
    await processRefundEvent(event);
    await processRefundEvent(event);
    expect((await PaymentEvent.findById(event._id)).status).toBe('completed');
    expect(await OrderAction.countDocuments({ type: 'refund_completed' })).toBe(
      1
    );
    gateway.getRefund.mockResolvedValue(
      providerResult(refund, { status: 'processing', refunded_amount: null })
    );
    await processRefundEvent(event);
    expect((await OrderRefund.findById(refund._id)).status).toBe('completed');
  });
  it('refreshes provider identity for existing paid orders without consuming their stock again', async () => {
    await Order.updateOne(
      { _id: order._id },
      { $unset: { 'payment.chargeId': 1, 'payment.receivedAmount': 1 } }
    );
    expect((await change('recheck-payment')).status).toBe(200);
    const current = await Order.findById(order._id);
    expect(current.payment.chargeId).toBe(order.payment.chargeId);
    expect(current.payment.receivedAmount).toBe(3262);
    expect(await InventoryMovement.countDocuments()).toBe(0);
  });
  it('leaves gateway refunds unavailable until explicitly configured', async () => {
    env.BACHS_REFUNDS_ENABLED = false;
    expect(
      (await change('refund-request', { mode: 'bachs', providerChecked: true }))
        .status
    ).toBe(409);
    expect(await OrderRefund.countDocuments()).toBe(0);
  });
  it('durably accepts a correctly signed refund webhook and rejects a forged one', async () => {
    const refund = await start('bachs');
    gateway.getRefund.mockResolvedValue(providerResult(refund));
    gateway.webhookSecret = 'test_refund_webhook_secret';
    const payload = {
      id: 'evt_' + key(),
      type: 'refund.paid',
      data: {
        refund_id: 'rfnd_test',
        charge_id: refund.chargeId,
        reference: refund.reference,
      },
    };
    const raw = JSON.stringify(payload),
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', gateway.webhookSecret)
      .update(timestamp + '.' + raw)
      .digest('hex');
    expect(
      (
        await request(app)
          .post('/api/payments/webhook/bachs')
          .set('Content-Type', 'application/json')
          .set('x-bachs-timestamp', timestamp)
          .set('x-bachs-signature', '0'.repeat(64))
          .send(raw)
      ).status
    ).toBe(400);
    expect(await PaymentEvent.countDocuments()).toBe(0);
    const send = () =>
      request(app)
        .post('/api/payments/webhook/bachs')
        .set('Content-Type', 'application/json')
        .set('x-bachs-timestamp', timestamp)
        .set('x-bachs-signature', signature)
        .send(raw);
    expect((await send()).status).toBe(200);
    await vi.waitFor(async () =>
      expect((await Order.findById(order._id)).payment.status).toBe('refunded')
    );
    expect((await send()).status).toBe(200);
    expect(await PaymentEvent.countDocuments()).toBe(1);
  });
  it('imports a verified dashboard refund without sending more money and preserves replay', async () => {
    const remote = {
      refund_id: 'rfnd_external',
      charge_id: order.payment.chargeId,
      reference: 'dashboard_' + key(),
      requested_amount: '3262.00',
      refunded_amount: '3262.00',
      fee_bearer: 'org',
      status: 'success',
    };
    gateway.getRefund.mockResolvedValue(remote);
    const event = await PaymentEvent.create({
      key: key(),
      kind: 'refund',
      gateway: 'bachs',
      payloadHash: key(),
      payload: { data: { refund_id: remote.refund_id } },
      status: 'processing',
      leaseToken: key(),
    });
    await processRefundEvent(event);
    expect((await Order.findById(order._id)).support.externalRefundReview).toBe(
      true
    );
    expect(
      (
        await change('refund-request', {
          mode: 'manual',
          providerChecked: true,
        })
      ).status
    ).toBe(409);
    const nonce = key(),
      revision = (await Order.findById(order._id)).support.revision;
    expect(
      (
        await change(
          'reconcile-provider-refund',
          { expectedRevision: revision },
          nonce
        )
      ).status
    ).toBe(200);
    const refund = await OrderRefund.findOne();
    await processRefund(refund._id);
    expect((await Order.findById(order._id)).payment.status).toBe('refunded');
    expect(
      (
        await change(
          'reconcile-provider-refund',
          { expectedRevision: revision },
          nonce
        )
      ).status
    ).toBe(200);
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(await OrderRefund.countDocuments()).toBe(1);
  });
  it('records definitive provider rejection as failed while keeping unknown responses pending', async () => {
    const refund = await start('bachs');
    const error = new Error('Definitive provider rejection');
    error.definitiveRejection = true;
    gateway.createRefund.mockRejectedValue(error);
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('failed');
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
  });
  it('rechecks a previously paid mismatch without re-consuming already committed stock', async () => {
    gateway.verifyPayment.mockResolvedValueOnce({
      isPaid: true,
      amount: 3000,
      currency: 'NGN',
      reference: order.payment.reference,
      checkoutId: order.payment.checkoutId,
    });
    expect((await change('recheck-payment')).status).toBe(200);
    expect((await Order.findById(order._id)).payment.status).toBe('review');
    expect((await change('recheck-payment')).status).toBe(200);
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
    expect(await InventoryMovement.countDocuments()).toBe(0);
  });
  it('rolls back a refund request and order block if its audit cannot be saved', async () => {
    vi.spyOn(OrderAction, 'create').mockRejectedValueOnce(
      new Error('Injected issue history failure')
    );
    expect(
      (
        await change('refund-request', {
          mode: 'manual',
          providerChecked: true,
        })
      ).status
    ).toBe(500);
    expect(await OrderRefund.countDocuments()).toBe(0);
    expect(
      (await Order.findById(order._id)).refundSummary?.active
    ).toBeUndefined();
    expect((await Order.findById(order._id)).support.open).toBe(false);
  });
  it('prevents two administrators from restoring the same sold quantity', async () => {
    await Order.updateOne(
      { _id: order._id },
      { 'fulfillment.status': 'cancelled' }
    );
    const payload = {
      expectedRevision: 0,
      inspected: true,
      items: [{ itemId: String(order.orderItems[0]._id), quantity: 2 }],
    };
    const results = await Promise.all([
      change('restock', payload),
      change('restock', payload),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect((await Product.findById(retail._id)).sizes[0].stock).toBe(5);
    expect(await InventoryMovement.countDocuments({ action: 'restore' })).toBe(
      1
    );
  });
  it('releases real outstanding holds for a refund without increasing physical stock', async () => {
    await Order.updateOne({ _id: order._id }, { 'inventory.status': 'held' });
    await RetailProduct.updateOne(
      { _id: retail._id },
      { 'sizes.0.reservedStock': 2 }
    );
    await FabricProduct.updateOne(
      { _id: fabric._id },
      { 'colorVariants.0.reservedHalfYards': 3 }
    );
    await refundRequest();
    const shirt = await Product.findById(retail._id),
      cotton = await Product.findById(fabric._id);
    expect(shirt.sizes[0].reservedStock).toBe(0);
    expect(shirt.sizes[0].stock).toBe(3);
    expect(cotton.colorVariants[0].reservedHalfYards).toBe(0);
    expect(cotton.colorVariants[0].rollStockHalfYards).toBe(20);
    expect((await Order.findById(order._id)).inventory.status).toBe('released');
  });
  it('does not reuse the same manual bank transfer as proof for a second order', async () => {
    const first = await start();
    const evidence = {
      sentConfirmed: true,
      transferReference: 'BANK-ONE-TRANSFER',
      evidence: 'Bank statement checked',
    };
    expect(
      (
        await change('refund-complete', {
          refundId: String(first._id),
          ...evidence,
        })
      ).status
    ).toBe(200);
    const second = order.toObject();
    delete second._id;
    delete second.orderNumber;
    delete second.__v;
    second.payment.reference = 'PAY-' + key();
    second.payment.checkoutId = 'chk_' + key();
    second.payment.chargeId = 'ch_' + key();
    order = await Order.create(second);
    const next = await start();
    expect(
      (
        await change('refund-complete', {
          refundId: String(next._id),
          ...evidence,
        })
      ).status
    ).toBe(409);
    expect((await Order.findById(order._id)).payment.status).toBe('paid');
    expect((await OrderRefund.findById(next._id)).status).toBe('processing');
  });
  it('checks for a competing provider refund before treating a rejected submission as safe to retry', async () => {
    const refund = await start('bachs');
    const error = new Error('Provider rejected this submission');
    error.definitiveRejection = true;
    gateway.createRefund.mockRejectedValue(error);
    gateway.getRefundByCharge
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        providerResult(refund, { reference: 'different_dashboard_reference' })
      );
    await processRefund(refund._id);
    expect((await OrderRefund.findById(refund._id)).status).toBe('processing');
    expect(
      (
        await change('refund-request', {
          mode: 'manual',
          providerChecked: true,
        })
      ).status
    ).toBe(409);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  });
  it('allows refunding a verified overpayment in full while preventing fulfilment', async () => {
    gateway.verifyPayment.mockResolvedValue({
      isPaid: true,
      amount: 3500,
      currency: 'NGN',
      reference: order.payment.reference,
      checkoutId: order.payment.checkoutId,
      chargeId: order.payment.chargeId,
      channel: 'NGN_CARD',
    });
    expect((await change('recheck-payment')).status).toBe(200);
    const current = await Order.findById(order._id);
    expect(current.payment.status).toBe('review');
    expect(current.payment.receivedAmount).toBe(3500);
    expect(current.payment.collectionVerifiedAt).toBeTruthy();
    expect(
      (
        await request(app)
          .put(`/api/orders/${order._id}/status`)
          .set('Authorization', auth(admin))
          .send({ status: 'shipped' })
      ).status
    ).toBe(409);
    const refund = await refundRequest();
    expect(refund.amountKobo).toBe(350000);
    expect(
      (await change('refund-start', { refundId: String(refund._id) })).status
    ).toBe(200);
    expect(
      (
        await change('refund-complete', {
          refundId: String(refund._id),
          sentConfirmed: true,
          transferReference: 'QA-VERIFIED-OVERPAYMENT',
          evidence: 'Verified collected amount returned in full',
        })
      ).status
    ).toBe(200);
    expect((await Order.findById(order._id)).payment.status).toBe('refunded');
  });
});
