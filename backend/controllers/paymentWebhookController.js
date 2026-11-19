import { createHash } from 'node:crypto';
import PaymentEvent from '../models/PaymentEvent.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import { processPaymentEvent } from '../services/paymentEventService.js';

export const handlePaymentWebhook = async (req, res) => {
  const gatewayName = req.params.gateway || paymentFactory.getActiveGatewayName();
  let gateway;
  try { gateway = paymentFactory.getGateway(gatewayName); }
  catch { return res.status(400).json({ success: false, message: 'Invalid gateway' }); }
  if (!gateway.verifyWebhookSignature(req)) return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  const parsed = gateway.parseWebhookEvent(req);
  if (!parsed.isPaid && !parsed.isRefund) return res.json({ received: true });
  if (parsed.isRefund && (!parsed.refundId || !parsed.chargeId)) return res.status(400).json({ received: false, message: 'Refund identifiers required' });
  const payloadHash = createHash('sha256').update(req.rawBody).digest('hex');
  const key = gatewayName + ':' + (parsed.eventId || payloadHash);
  try {
    let event;
    try {
      event = await PaymentEvent.findOneAndUpdate({ key }, { $setOnInsert: {
        key, gateway: gatewayName, kind: parsed.isRefund ? 'refund' : 'payment', payloadHash, payload: req.body, reference: parsed.reference,
        checkoutId: parsed.checkoutId, status: 'pending', nextAttemptAt: new Date(),
      } }, { upsert: true, returnDocument: 'after', writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error.code !== 11000) throw error;
      event = await PaymentEvent.findOne({ key });
    }
    if (!event || event.payloadHash !== payloadHash) return res.status(409).json({ received: false, message: 'Conflicting payment event' });
    // Acknowledge after durable storage; the worker resumes interrupted processing.
    res.json({ received: true });
    setImmediate(() => processPaymentEvent(event._id).catch(() => console.error('Payment event queued for retry.')));
  } catch {
    res.status(503).json({ received: false, message: 'Payment event could not be saved. Please retry.' });
  }
};
