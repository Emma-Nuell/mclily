import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import paymentFactory from '../services/payment/PaymentFactory.js';
import { PaystackService } from '../services/payment/PaystackService.js';
import { BachsService } from '../services/payment/BachsService.js';

describe('Payment Factory & Gateway Abstraction', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('should return PaystackService when requested', () => {
    const gateway = paymentFactory.getGateway('paystack');
    expect(gateway).toBeInstanceOf(PaystackService);
    expect(gateway.name).toBe('paystack');
  });

  it('should return BachsService when requested', () => {
    const gateway = paymentFactory.getGateway('bachs');
    expect(gateway).toBeInstanceOf(BachsService);
    expect(gateway.name).toBe('bachs');
  });

  it('should throw for unsupported gateways', () => {
    expect(() => paymentFactory.getGateway('stripe')).toThrow(/Unsupported payment gateway/);
  });

  it('should verify Paystack webhook signature against rawBody with HMAC-SHA512', () => {
    const paystack = new PaystackService();
    paystack.secretKey = 'test_paystack_secret';

    const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'MCL-123' } }));
    const validSignature = crypto.createHmac('sha512', paystack.secretKey).update(rawBody).digest('hex');

    const validReq = {
      headers: { 'x-paystack-signature': validSignature },
      rawBody,
    };
    expect(paystack.verifyWebhookSignature(validReq)).toBe(true);

    const invalidReq = {
      headers: { 'x-paystack-signature': 'tampered_signature_string' },
      rawBody,
    };
    expect(paystack.verifyWebhookSignature(invalidReq)).toBe(false);
  });

  it('should verify Bachs webhook signature with HMAC-SHA256', () => {
    const bachs = new BachsService();
    bachs.webhookSecret = 'test_bachs_secret';

    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.completed', data: { reference: 'MCL-456' } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const validSignature = crypto.createHmac('sha256', bachs.webhookSecret).update(timestamp + '.').update(rawBody).digest('hex');

    const validReq = {
      headers: { 'x-bachs-signature': validSignature, 'x-bachs-timestamp': timestamp },
      rawBody,
    };
    expect(bachs.verifyWebhookSignature(validReq)).toBe(true);
    expect(bachs.verifyWebhookSignature({ ...validReq, headers: { ...validReq.headers, 'x-bachs-timestamp': '1' } })).toBe(false);
    expect(bachs.verifyWebhookSignature({ ...validReq, rawBody: Buffer.from('{}') })).toBe(false);
    expect(bachs.verifyWebhookSignature({ ...validReq, headers: { 'x-bachs-signature-v2': `t=${timestamp},v1=${'0'.repeat(64)},v1=${validSignature}` } })).toBe(true);

    const invalidReq = {
      headers: { 'x-bachs-signature': 'invalid_signature' },
      rawBody,
    };
    expect(bachs.verifyWebhookSignature(invalidReq)).toBe(false);
  });
  it('uses Bachs decimal-naira checkout pricing and the returned checkout ID', async () => {
    const bachs = new BachsService();
    bachs.secretKey = 'sk_test_fake';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkout_id: 'chk_test', checkout_url: 'https://checkout.bachs.io/c/test' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await bachs.initializePayment({ orderNumber: 'MCL-TEST', amount: 136270, customer: { name: 'Test', email: 'test@example.com' }, callbackUrl: 'https://test.invalid/confirmation' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/checkout-sessions$/);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.pricing).toEqual({ currency: 'NGN', amount: '136270.00' });
    expect(payload.expires_in_minutes).toBe(15);
    expect(result.checkoutId).toBe('chk_test');
  });
  it('verifies actual Bachs charge money rather than trusting the requested session total', async () => {
    const bachs = new BachsService();
    bachs.secretKey = 'sk_test_fake';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkout_id: 'chk_test', reference: 'MCL-TEST',
      payment_status: 'succeeded', amount: '1000.00', currency: 'NGN', charge: { amount: '900.00', currency: 'NGN', status: 'succeeded' } }) }));
    const result = await bachs.verifyPayment('chk_test');
    expect(result.isPaid).toBe(true);
    expect(result.amount).toBe(900);
    expect(result.reference).toBe('MCL-TEST');
  });
});
