import { randomUUID } from 'node:crypto';
import PaymentEvent from '../models/PaymentEvent.js';
import Order from '../models/Order.js';
import paymentFactory from './payment/PaymentFactory.js';
import { inTransaction } from './transactionService.js';
import { moveInventory } from './inventoryService.js';
import { releaseOrderHold } from './reservationService.js';
import { AppError } from '../utils/AppError.js';
import telegramBotService from './telegramBotService.js';
import { processRefundEvent } from './refundService.js';
import { queueOrderUpdate, queueTechnical, recordVerifiedCollection } from './notificationService.js';

function orderQuery(event) {
  const references = [];
  if (event.reference) references.push({ 'payment.reference': event.reference });
  if (event.checkoutId) references.push({ 'payment.checkoutId': event.checkoutId });
  return { 'payment.gateway': event.gateway, $or: references };
}
async function completeEvent(id, leaseToken, session, outcome) {
  const result = await PaymentEvent.updateOne({ _id: id, status: 'processing', leaseToken },
    { $set: { status: 'completed', outcome }, $unset: { leaseUntil: '', leaseToken: '' } }, { session });
  if (result.modifiedCount !== 1) throw new AppError(409, 'EVENT_LEASE_LOST', 'Payment processing will be retried.');
}

export async function processPaymentEvent(id) {
  const now = new Date(), leaseToken = randomUUID();
  const event = await PaymentEvent.findOneAndUpdate({ _id: id, $or: [
    { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now } },
    { status: 'processing', leaseUntil: { $lt: now } },
  ] }, { $set: { status: 'processing', leaseToken, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: 'after' });
  if (!event) return;
  try {
    if (event.kind === 'refund') { await processRefundEvent(event); return; }
    if (!event.reference && !event.checkoutId) {
      await inTransaction(async session => {
        await PaymentEvent.updateOne({ _id: id, leaseToken }, { $set: { status: 'review', outcome: 'Unmatched payment: no order identifier' } }, { session });
        await queueTechnical('unmatched:' + event._id, 'A provider event cannot be matched to an order. Inspect the technical review queue.', session);
      });
      return;
    }
    const original = await Order.findOne(orderQuery(event));
    if (!original) throw new Error('Order not yet available');
    const gateway = paymentFactory.getGateway(event.gateway);
    // External verification is outside any retryable Mongo transaction.
    const verification = await gateway.verifyPayment(event.gateway === 'bachs'
      ? original.payment.checkoutId || event.checkoutId : original.payment.reference);
    const collectionMatches = verification.isPaid && verification.currency === 'NGN' && Number.isFinite(verification.amount) && verification.amount > 0
      && Number.isSafeInteger(Math.round(verification.amount * 100)) && verification.reference === original.payment.reference
      && (event.gateway !== 'bachs' || verification.checkoutId === (original.payment.checkoutId || event.checkoutId));
    try {
      await inTransaction(async session => {
        const order = await Order.findById(original._id).session(session);
        if (order.payment.status === 'refunded') {
          await completeEvent(id, leaseToken, session, 'Already finalized'); return;
        }
        const alreadyPaid = order.payment.status === 'paid';
        order.payment.collectionVerifiedAt = collectionMatches ? new Date() : undefined;
        if (collectionMatches) {
          await recordVerifiedCollection(order, verification, session);
          order.payment.receivedAmount = verification.amount; order.payment.currency = verification.currency;
          order.payment.chargeId = verification.chargeId; order.payment.channel = verification.channel;
        }
        if (alreadyPaid) {
          const exact = verification.isPaid && verification.currency === 'NGN' && Number.isFinite(verification.amount)
            && Math.round(verification.amount * 100) === Math.round(order.pricing.totalAmount * 100) && verification.reference === order.payment.reference
            && (event.gateway !== 'bachs' || verification.checkoutId === order.payment.checkoutId);
          if (exact) {
            order.payment.receivedAmount = verification.amount; order.payment.currency = verification.currency;
            if (verification.chargeId) order.payment.chargeId = verification.chargeId;
            if (verification.channel) order.payment.channel = verification.channel;
            order.support.revision = (order.support.revision || 0) + 1;
            await order.save({ session });
          } else {
            order.support.open = true; order.support.revision = (order.support.revision || 0) + 1;
            order.payment.status = 'review'; order.payment.reviewReason = 'Previously paid order no longer matches provider verification. Technical review required.';
            await order.save({ session });
            await queueOrderUpdate(order, 'review', session, 'paid-review:' + verification.status + ':' + verification.amount);
          }
          await completeEvent(id, leaseToken, session, exact ? 'Verified payment details refreshed' : 'Existing paid order requires provider review'); return;
        }
        if (order.inventory.status === 'held' && order.inventory.expiresAt <= new Date()) await releaseOrderHold(order, session);
        if (!verification.isPaid) {
          // Pending/underpaid/non-success notifications cannot cancel a valid in-flight transfer.
          if (['failed', 'cancelled', 'canceled'].includes(verification.status)) {
            await releaseOrderHold(order, session);
            order.payment.status = 'failed';
          } else throw new AppError(503, 'PAYMENT_NOT_SETTLED', 'Provider confirmation is pending.');
          await order.save({ session });
          await completeEvent(id, leaseToken, session, 'Not confirmed paid'); return;
        }
        const exact = Number.isFinite(verification.amount) && Math.round(verification.amount * 100) === Math.round(order.pricing.totalAmount * 100)
          && verification.currency === 'NGN' && verification.reference === order.payment.reference
          && (event.gateway !== 'bachs' || verification.checkoutId === (order.payment.checkoutId || event.checkoutId));
        order.payment.receivedAmount = Number.isFinite(verification.amount) ? verification.amount : undefined;
        order.support.revision = (order.support.revision || 0) + 1;
        if (!exact) {
          order.payment.status = 'review'; order.payment.reviewReason = 'Payment amount, currency or reference mismatch';
          order.fulfillment.status = 'needs_resolution';
          await order.save({ session }); await queueOrderUpdate(order, 'review', session, 'mismatch:' + verification.amount); await completeEvent(id, leaseToken, session, 'Payment mismatch requires review'); return;
        }
        order.payment.currency = verification.currency; order.payment.chargeId = verification.chargeId; order.payment.channel = verification.channel;
        if (order.fulfillment.status === 'cancelled') {
          await releaseOrderHold(order, session);
          order.payment.status = 'paid'; order.payment.paidAt = verification.paidAt || new Date();
          order.payment.reviewReason = 'Payment received for a cancelled order'; order.fulfillment.status = 'needs_resolution';
          await order.save({ session }); await queueOrderUpdate(order, 'review', session, 'cancelled-payment'); await completeEvent(id, leaseToken, session, 'Paid: cancelled order requires resolution'); return;
        }
        if ([...order.inventory.restored.values()].some(value => value > 0)) throw new AppError(409, 'OUT_OF_STOCK', 'Order stock was already restored; manual resolution is required.');
        if (order.inventory.status !== 'consumed') await moveInventory(order.orderItems, order.inventory.status === 'held' ? 'capture' : 'sell', session, { source: `ORDER_${order._id}` });
        order.inventory.status = 'consumed'; order.payment.status = 'paid'; order.payment.paidAt = verification.paidAt || new Date();
        order.payment.reviewReason = undefined; order.payment.channel = verification.channel;
        order.fulfillment.status = 'processing';
        order.fulfillment.timeline.push({ status: 'processing', note: 'Payment verified and inventory committed.', updatedBy: 'Payment processor' });
        await order.save({ session });
        await queueOrderUpdate(order, 'paid', session);
        await telegramBotService.sendOrderNotification(order, { session });
        await completeEvent(id, leaseToken, session, 'Paid and inventory committed');
        return order.toObject();
      });
    } catch (error) {
      if (!['OUT_OF_STOCK', 'STOCK_CHANGED'].includes(error.code)) throw error;
      // The failed stock transaction rolled back EVERY item. Preserve the real payment separately.
      await inTransaction(async session => {
        const order = await Order.findById(original._id).session(session);
        if (!['paid', 'refunded'].includes(order.payment.status)) {
          await releaseOrderHold(order, session);
          order.payment.status = 'paid'; order.payment.paidAt = verification.paidAt || new Date();
          order.payment.receivedAmount = verification.amount; order.payment.reviewReason = 'Stock unavailable after payment';
          if (collectionMatches) await recordVerifiedCollection(order, verification, session);
          order.payment.collectionVerifiedAt = collectionMatches ? new Date() : undefined;
          order.payment.currency = verification.currency; order.payment.chargeId = verification.chargeId; order.payment.channel = verification.channel;
          order.support.revision = (order.support.revision || 0) + 1;
          order.fulfillment.status = 'needs_resolution';
          order.fulfillment.timeline.push({ status: 'needs_resolution', note: 'Payment received; exact stock unavailable. Admin resolution required.', updatedBy: 'Payment processor' });
          await order.save({ session });
          await queueOrderUpdate(order, 'review', session, 'stock-after-payment');
        }
        await completeEvent(id, leaseToken, session, 'Paid: stock requires resolution');
      });
    }
  } catch {
    await inTransaction(async session => {
    await PaymentEvent.updateOne({ _id: id, leaseToken }, { $set: { status: 'failed',
      nextAttemptAt: new Date(Date.now() + Math.min(3600000, 5000 * 2 ** Math.min(event.attempts, 9))),
      outcome: 'Verification or transaction failed; retry scheduled' }, $unset: { leaseUntil: '', leaseToken: '' } }, { session });
      if (event.attempts >= 3) await queueTechnical('verification:' + event._id, 'A payment event repeatedly failed verification or processing. Inspect it before fulfilling or refunding.', session);
    });
  }
}

export async function processPendingPayments() {
  const now = new Date();
  const events = await PaymentEvent.find({ $or: [
    { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now } },
    { status: 'processing', leaseUntil: { $lt: now } },
  ] }).select('_id').limit(50).lean();
  for (const event of events) await processPaymentEvent(event._id);
}
