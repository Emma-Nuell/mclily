import crypto from 'node:crypto';
import env from '../../config/env.js';
import { PaymentGatewayInterface } from './PaymentGatewayInterface.js';

export class BachsService extends PaymentGatewayInterface {
  constructor() {
    super();
    this.name = 'bachs';
    this.baseUrl = env.BACHS_ENVIRONMENT === 'production' ? 'https://api.bachs.io/v1' : 'https://sandbox-api.bachs.io/v1';
    this.secretKey = env.BACHS_SECRET_KEY || '';
    this.webhookSecret = env.BACHS_WEBHOOK_SECRET || '';
  }
  getHeaders() { return { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' }; }
  async refundRequest(path, options = {}, allowMissing = false) {
    if (!this.secretKey) throw new Error('Bachs is not configured.');
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers: this.getHeaders(), signal: AbortSignal.timeout(15000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const error = new Error('Bachs could not confirm this refund request.');
      error.definitiveRejection = [400, 401, 403, 422].includes(response.status);
      throw error;
    }
    const body = await response.json(); return body.data || body;
  }
  getRefundPayment(chargeId) { return this.refundRequest('/payments/' + encodeURIComponent(chargeId)); }
  getRefundByCharge(chargeId) { return this.refundRequest('/refunds/by-charge/' + encodeURIComponent(chargeId), {}, true); }
  getRefund(refundId) { return this.refundRequest('/refunds/' + encodeURIComponent(refundId)); }
  createRefund({ chargeId, reference, reason, amount }) {
    return this.refundRequest('/refunds', { method: 'POST', body: JSON.stringify({ charge_id: chargeId, reference, reason,
      amount: Number(amount).toFixed(2), fee_bearer: 'org', idempotency_key: reference }) });
  }
  async initializePayment({ orderNumber, amount, customer, callbackUrl, metadata = {} }) {
    if (!this.secretKey) throw new Error('Bachs is not configured.');
    const response = await fetch(`${this.baseUrl}/checkout-sessions`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { ...this.getHeaders(), 'Idempotency-Key': orderNumber },
      body: JSON.stringify({ reference: orderNumber, pricing: { currency: 'NGN', amount: Number(amount).toFixed(2) },
        customer: { email: customer.email, name: customer.name }, success_url: callbackUrl,
        billing_currency: 'NGN', payment_method_types: ['NGN_BANK_TRANSFER', 'NGN_CARD'],
        cancel_url: `${env.FRONTEND_URL}/checkout`, expires_in_minutes: 15,
        metadata: { ...metadata, order_number: orderNumber } }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error('Bachs checkout could not be initialized.');
    const data = body.data || body;
    if (!data.checkout_id || !data.checkout_url) throw new Error('Bachs returned an incomplete checkout response.');
    return { authorizationUrl: data.checkout_url, reference: orderNumber, checkoutId: data.checkout_id, accessCode: data.checkout_id };
  }
  async verifyPayment(checkoutId) {
    if (!this.secretKey) throw new Error('Bachs is not configured.');
    const response = await fetch(`${this.baseUrl}/checkout-sessions/${encodeURIComponent(checkoutId)}`, {
      method: 'GET', signal: AbortSignal.timeout(15000), headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Bachs verification is temporarily unavailable.');
    const body = await response.json();
    const data = body.data || body;
    const charge = data.charge || {};
    const status = String(data.payment_status || charge.status || data.status || '').toLowerCase();
    return { isPaid: ['paid', 'succeeded', 'accepted', 'overpaid'].includes(status), status,
      // Compare money actually collected, never the requested session amount.
      amount: Number(charge.amount_paid ?? data.amount_paid ?? charge.amount ?? NaN), currency: charge.currency || data.currency,
      reference: data.reference, checkoutId: data.checkout_id || checkoutId, chargeId: charge.charge_id || charge.payment_id || charge.id || data.payment_id,
      channel: charge.payment_method || data.payment_method || 'bachs_checkout',
      paidAt: charge.paid_at || data.paid_at || data.completed_at ? new Date(charge.paid_at || data.paid_at || data.completed_at) : null,
    };
  }
  verifyWebhookSignature(req) {
    if (!this.webhookSecret || !Buffer.isBuffer(req.rawBody)) return false;
    const v2 = req.headers['x-bachs-signature-v2'];
    let timestamp, signatures;
    if (typeof v2 === 'string') {
      const parts = v2.split(',').map(part => part.trim().split('='));
      const timestamps = parts.filter(([name]) => name === 't');
      if (timestamps.length !== 1) return false;
      timestamp = timestamps[0][1];
      signatures = parts.filter(([name]) => name === 'v1').map(([, value]) => value);
    } else {
      timestamp = req.headers['x-bachs-timestamp'];
      signatures = [req.headers['x-bachs-signature']];
    }
    if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    const hash = crypto.createHmac('sha256', this.webhookSecret).update(`${timestamp}.`).update(req.rawBody).digest();
    return signatures.some(signature => typeof signature === 'string' && /^[a-fA-F0-9]{64}$/.test(signature) && crypto.timingSafeEqual(hash, Buffer.from(signature, 'hex')));
  }
  parseWebhookEvent(req) {
    const body = req.body || {}, data = body.data || {};
    const eventType = body.type || body.event;
    return { eventId: body.id || body.event_id, eventType, checkoutId: data.checkout_id,
      reference: data.reference || data.metadata?.order_number,
      isRefund: ['refund.created', 'refund.paid', 'refund.failed'].includes(eventType), refundId: data.refund_id, chargeId: data.charge_id,
      isPaid: eventType === 'collection.succeeded' || eventType === 'checkout.completed',
      amount: Number(data.amount_paid ?? data.amount), currency: data.currency };
  }
}
export default BachsService;
