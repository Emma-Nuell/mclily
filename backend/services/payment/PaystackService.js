import crypto from 'crypto';
import env from '../../config/env.js';
import { PaymentGatewayInterface } from './PaymentGatewayInterface.js';

export class PaystackService extends PaymentGatewayInterface {
  constructor() {
    super();
    this.name = 'paystack';
    this.baseUrl = 'https://api.paystack.co';
    this.secretKey = env.PAYSTACK_SECRET_KEY || '';
  }

  getHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async initializePayment({ orderNumber, amount, customer, callbackUrl, metadata = {} }) {
    if (!this.secretKey) {
      throw new Error('Paystack secret key is not configured');
    }

    const payload = {
      email: customer.email,
      amount: Math.round(amount * 100), // Convert to Kobo
      reference: orderNumber,
      callback_url: callbackUrl,
      metadata: {
        ...metadata,
        customer_name: customer.name,
        customer_phone: customer.phone,
        order_number: orderNumber,
      },
    };

    const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      throw new Error(data.message || 'Failed to initialize Paystack transaction');
    }

    return {
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
      accessCode: data.data.access_code,
    };
  }

  async verifyPayment(reference) {
    if (!this.secretKey) {
      throw new Error('Paystack secret key is not configured');
    }

    const response = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
      headers: this.getHeaders(),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      throw new Error('Paystack verification is temporarily unavailable.');
    }

    const tx = data.data;
    const isSuccess = tx.status === 'success';

    return {
      isPaid: isSuccess,
      amount: tx.amount ? tx.amount / 100 : 0, // Convert from Kobo to Naira
      reference: tx.reference,
      currency: tx.currency,
      status: tx.status,
      channel: tx.channel,
      paidAt: tx.paid_at ? new Date(tx.paid_at) : null,
      raw: tx,
    };
  }

  verifyWebhookSignature(req) {
    const signature = req.headers['x-paystack-signature'];
    if (!signature || !this.secretKey) {
      return false;
    }

    if (!Buffer.isBuffer(req.rawBody)) return false;
    const rawBody = req.rawBody;
    const hash = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(req) {
    const body = req.body || {};
    const event = body.event;
    const data = body.data || {};

    const isPaid = event === 'charge.success' && data.status === 'success';
    const amount = data.amount ? data.amount / 100 : 0;

    return {
      eventId: data.id ? `${event}:${data.id}` : undefined,
      currency: data.currency,
      eventType: event,
      isPaid,
      reference: data.reference,
      amount,
      channel: data.channel,
      paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
      raw: data,
    };
  }
}

export default PaystackService;
