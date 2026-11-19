import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import mongoose from 'mongoose';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import Order from '../models/Order.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import PaymentEvent from '../models/PaymentEvent.js';
import InventoryMovement from '../models/InventoryMovement.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import env from '../config/env.js';
import { vi } from 'vitest';
import { deliveryOptions } from '../services/deliveryService.js';
const previousDelivery = env.DELIVERY_CONFIG_JSON;

describe('Milestone 5: End-to-End Checkout, Webhook Idempotency & Stock Integrity', () => {
  let retailItem;
  let fabricItem;

  beforeAll(async () => {
    env.DELIVERY_CONFIG_JSON = JSON.stringify({
      pickup: { enabled: false, address: '', hours: '' },
      externalCourierEnabled: true,
      zones: [
        {
          id: 'lagos_island',
          name: 'Test island',
          fee: 3500,
          states: ['Lagos'],
          cities: [],
          enabled: true,
        },
      ],
    });
    process.env.ACTIVE_PAYMENT_GATEWAY = 'paystack';
    await connectDatabase();
    for (const model of [
      Order,
      Product,
      IdempotencyLog,
      PaymentEvent,
      InventoryMovement,
    ])
      await model.init();

    // Mock payment gateway network calls so sandbox/dummy keys don't fail live API
    const activeGateway = paymentFactory.getGateway('paystack');
    vi.spyOn(activeGateway, 'initializePayment').mockImplementation(
      async ({ orderNumber, amount }) => ({
        authorizationUrl: `https://checkout.paystack.com/${orderNumber}`,
        reference: orderNumber,
        accessCode: `mock_code_${orderNumber}`,
      })
    );

    vi.spyOn(activeGateway, 'verifyPayment').mockImplementation(
      async (reference) => ({
        isPaid: true,
        reference,
        amount: 136270,
        currency: 'NGN',
        paidAt: new Date(),
        channel: 'card',
      })
    );

    // Create a fresh test retail product with 10 units
    retailItem = await RetailProduct.create({
      name: 'E2E Designer Trench Coat',
      slug: `e2e-trench-${Date.now()}`,
      category: 'Clothing',
      price: 50000,
      description: 'Luxury water-repellent double-breasted trench coat.',
      images: ['https://example.com/trench.jpg'],
      sizes: [{ size: 'M', stock: 10 }],
    });

    // Create a fresh test fabric roll with 40 half-yards (20 yards)
    fabricItem = await FabricProduct.create({
      name: 'E2E Egyptian Cotton Lawn',
      slug: `e2e-egyptian-cotton-${Date.now()}`,
      category: 'Fabrics',
      price: 12000,
      pricePerYard: 12000,
      material: 'Cotton',
      description: 'Fine high-thread count Egyptian cotton lawn.',
      images: ['https://example.com/cotton.jpg'],
      colorVariants: [
        {
          colorName: 'Crisp White',
          rollStockHalfYards: 40, // 20 yards
          image: 'https://example.com/cotton.jpg',
        },
      ],
    });
  });

  afterAll(async () => {
    env.DELIVERY_CONFIG_JSON = previousDelivery;
    if (retailItem) await Product.findByIdAndDelete(retailItem._id);
    if (fabricItem) await Product.findByIdAndDelete(fabricItem._id);
    await Order.deleteMany({ 'customer.email': 'e2e.customer@example.com' });
    await IdempotencyLog.deleteMany({ key: { $regex: /^PAYSTACK_/ } });
    await mongoose.connection.close();
  });

  it('should execute full end-to-end checkout with atomic stock deduction and webhook idempotency', async () => {
    // 1. Create order via /api/orders
    const orderPayload = {
      deliveryPolicyVersion: deliveryOptions().version,
      customer: {
        name: 'Chioma Okeke',
        email: 'e2e.customer@example.com',
        phone: '08033221100',
      },
      shippingAddress: {
        street: '22 Ozumba Mbadiwe Ave, Victoria Island',
        city: 'Lagos',
        state: 'Lagos',
        deliveryTier: 'lagos_island', // ₦3,500
      },
      items: [
        {
          productId: retailItem._id.toString(),
          name: retailItem.name,
          quantity: 2,
          size: 'M',
        },
        {
          productId: fabricItem._id.toString(),
          name: fabricItem.name,
          productType: 'fabric',
          yards: 2.5,
          fabricVariantId: fabricItem.colorVariants[0]._id.toString(),
        },
      ],
    };

    const createOrderRes = await request(app)
      .post('/api/orders')
      .send(orderPayload);
    if (createOrderRes.status !== 201) {
      console.log('Create order error body:', createOrderRes.body);
    }

    expect(createOrderRes.status).toBe(201);
    expect(createOrderRes.body.success).toBe(true);

    const orderData = createOrderRes.body.data;
    expect(orderData.orderNumber).toBeDefined();

    // Check pricing formula:
    // Retail: 2 x 50,000 = 100,000
    // Fabric: 2.5 x 12,000 = 30,000
    // Subtotal = 130,000
    // Delivery = 3,500
    // Base Amount = 133,500
    // Fee = 2% x 133,500 + 100 = 2,770
    // Total Amount = 133,500 + 2,770 = 136,270
    expect(orderData.breakdown.subtotal).toBe(130000);
    expect(orderData.breakdown.deliveryFee).toBe(3500);
    expect(orderData.breakdown.paymentFee).toBe(2770);
    expect(orderData.breakdown.totalAmount).toBe(136270);
    expect(orderData.totalAmount).toBe(136270);
    expect(
      (await RetailProduct.findById(retailItem._id)).sizes[0].reservedStock
    ).toBe(2);
    expect(
      (await request(app).get('/api/orders/' + orderData.orderNumber)).status
    ).toBe(404);
    const access = new URL(orderData.confirmationUrl).searchParams.get(
      'access'
    );
    const privateView = await request(app)
      .get('/api/orders/' + orderData.orderNumber)
      .set('X-Order-Access', access);
    expect(privateView.status).toBe(200);
    expect(privateView.body.data.guestAccessHash).toBeUndefined();

    const paymentRef = orderData.reference;
    expect(paymentRef).toBeDefined();

    // 2. Simulate Paystack charge.success webhook with raw HMAC-SHA512 signature
    const webhookPayload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 9918234,
        reference: paymentRef,
        amount: 13627000,
        currency: 'NGN',
        status: 'success',
        channel: 'card',
        paid_at: new Date().toISOString(),
      },
    });

    const secretKey = env.PAYSTACK_SECRET_KEY || 'sk_test_mock_secret_key';
    const validSignature = crypto
      .createHmac('sha512', secretKey)
      .update(webhookPayload)
      .digest('hex');

    // Fire webhook #1
    const webhookRes1 = await request(app)
      .post('/api/payments/webhook/paystack')
      .set('x-paystack-signature', validSignature)
      .set('Content-Type', 'application/json')
      .send(webhookPayload);

    expect(webhookRes1.status).toBe(200);
    expect(webhookRes1.body.received).toBe(true);

    // Wait a brief moment for async stock deduction
    await vi.waitFor(
      async () =>
        expect((await Order.findById(orderData.orderId)).payment.status).toBe(
          'paid'
        ),
      { timeout: 5000 }
    );

    // 3. Verify stock was atomically decremented
    const updatedRetail = await RetailProduct.findById(retailItem._id);
    const updatedFabric = await FabricProduct.findById(fabricItem._id);

    // 10 units - 2 units = 8 units
    expect(updatedRetail.sizes[0].stock).toBe(8);
    expect(updatedRetail.sizes[0].reservedStock).toBe(0);

    // 40 half-yards (20 yds) - 5 half-yards (2.5 yds) = 35 half-yards (17.5 yds) (Checklist 1.1.3)
    expect(updatedFabric.colorVariants[0].rollStockHalfYards).toBe(35);

    // 4. Verify order is now paid & processing
    const updatedOrder = await Order.findById(orderData.orderId);
    expect(updatedOrder.payment.status).toBe('paid');
    expect(updatedOrder.fulfillment.status).toBe('processing');

    // 5. WEBHOOK REPLAY ATTACK TEST (Checklist 1.2.2 & 4.2)
    // Send the exact same webhook payload a second time
    const webhookRes2 = await request(app)
      .post('/api/payments/webhook/paystack')
      .set('x-paystack-signature', validSignature)
      .set('Content-Type', 'application/json')
      .send(webhookPayload);

    expect(webhookRes2.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));

    // Verify stock was NOT decremented again!
    const recheckedRetail = await RetailProduct.findById(retailItem._id);
    const recheckedFabric = await FabricProduct.findById(fabricItem._id);

    expect(recheckedRetail.sizes[0].stock).toBe(8); // Still 8! Never 6!
    expect(recheckedFabric.colorVariants[0].rollStockHalfYards).toBe(35); // Still 35!
  });
});
