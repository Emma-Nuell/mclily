import { randomUUID } from 'node:crypto';
import Order from '../models/Order.js';
import OrderRefund from '../models/OrderRefund.js';
import OrderAction from '../models/OrderAction.js';
import PaymentEvent from '../models/PaymentEvent.js';
import paymentFactory from './payment/PaymentFactory.js';
import { inTransaction } from './transactionService.js';
import { toKobo, naira } from '../utils/creditMoney.js';
import { AppError } from '../utils/AppError.js';
import env from '../config/env.js';
import { queueOrderUpdate, queueTechnical } from './notificationService.js';

export async function orderAudit(
  order,
  type,
  reason,
  actor,
  session,
  details = {}
) {
  await OrderAction.create(
    [
      {
        order: order._id,
        type,
        reason,
        actor: String(actor._id || 'System'),
        actorName: actor.fullName || 'Payment processor',
        ...details,
      },
    ],
    { session }
  );
  order.support.revision = (order.support.revision || 0) + 1;
}
export function refundData(refund) {
  return {
    _id: refund._id,
    reference: refund.reference,
    mode: refund.mode,
    status: refund.status,
    amount: naira(refund.amountKobo),
    reason: refund.reason,
    transferReference: refund.transferReference,
    evidence: refund.evidence,
    outcome: refund.outcome,
    createdAt: refund.createdAt,
    completedAt: refund.completedAt,
  };
}

// Applying a provider result always rechecks the active refund under the order transaction lock.
export async function applyRefundResult(id, result, leaseToken) {
  return inTransaction(async (session) => {
    const refund = await OrderRefund.findById(id).session(session);
    if (!refund || (leaseToken && refund.leaseToken !== leaseToken))
      throw new AppError(
        409,
        'REFUND_LEASE_LOST',
        'Refund reconciliation will be retried.'
      );
    if (['completed', 'failed'].includes(refund.status)) return;
    const order = await Order.findById(refund.order).session(session);
    if (String(order.refundSummary?.active) !== String(refund._id))
      throw new Error('Refund does not match the active order refund.');
    if (toKobo(order.payment.receivedAmount) !== refund.amountKobo) throw new Error('Order collection changed; refund reconciliation needs review.');
    const amount = toKobo(result.requested_amount);
    if (
      !result.refund_id ||
      result.charge_id !== refund.chargeId ||
      result.reference !== refund.reference ||
      amount !== refund.amountKobo ||
      !['processing', 'success', 'failed'].includes(result.status)
    )
      throw new Error('Refund identity or amount mismatch.');
    if (
      result.status === 'success' &&
      (toKobo(result.refunded_amount) !== refund.amountKobo ||
        !['org', undefined].includes(result.fee_bearer))
    )
      throw new Error('Refund amount needs review.');
    const next = result.status === 'success' ? 'completed' : result.status;
    refund.providerId = result.refund_id;
    refund.nextAttemptAt = new Date(Date.now() + 60000);
    refund.outcome =
      next === 'completed'
        ? 'Provider confirmed funds sent; customer bank timing may vary.'
        : next === 'failed'
          ? 'Provider confirmed no money moved.'
          : 'Provider is processing the refund.';
    if (next !== refund.status) {
      refund.status = next;
      order.refundSummary.status = next;
      if (next === 'completed') {
        refund.completedAt = new Date();
        order.payment.status = 'refunded';
        order.fulfillment.status = 'cancelled';
        order.support.open = false;
      }
      if (next === 'completed' || next === 'failed') {
        order.support.externalRefundReview = false;
        order.support.externalRefundId = undefined;
      }
      await orderAudit(order, 'refund_' + next, refund.outcome, {}, session, {
        refund: refund._id,
      });
      order.fulfillment.timeline.push({
        status: order.fulfillment.status,
        note: refund.outcome,
        updatedBy: 'Payment processor',
      });
      await order.save({ session });
      await queueOrderUpdate(order, 'refund', session, 'refund:' + refund._id + ':' + next);
      if (next === 'failed') await queueTechnical('refund-failed:' + refund._id, 'A provider refund failed. Check the order resolution record before another attempt.', session, order.orderNumber);
    }
    refund.leaseToken = undefined;
    refund.leaseUntil = undefined;
    await refund.save({ session });
  });
}

export async function processRefund(id) {
  const token = randomUUID(),
    now = new Date();
  const refund = await OrderRefund.findOneAndUpdate(
    {
      _id: id,
      mode: 'bachs',
      status: 'processing',
      nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 120000) },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' }
  );
  if (!refund) return;
  try {
    const gateway = paymentFactory.getGateway('bachs');
    let result = refund.providerId
      ? await gateway.getRefund(refund.providerId)
      : await gateway.getRefundByCharge(refund.chargeId);
    if (!result) {
      // An uncertain submission is reconciled, never blindly resubmitted or switched to manual.
      if (refund.submissionStarted)
        throw new Error(
          'Submission outcome unknown; provider reconciliation required.'
        );
      const order = await Order.findById(refund.order);
      const payment = await gateway.getRefundPayment(refund.chargeId);
      if (
        payment.reference !== order.payment.reference ||
        payment.currency !== 'NGN' ||
        toKobo(payment.amount_paid) !== refund.amountKobo ||
        payment.payment_method !== 'NGN_CARD' ||
        payment.is_refundable !== true ||
        !['succeeded', 'accepted'].includes(payment.status)
      )
        throw new Error('Provider payment eligibility requires review.');
      if (!env.BACHS_REFUNDS_ENABLED)
        throw new Error('Gateway refund initiation is disabled.');
      const claimed = await OrderRefund.updateOne(
        { _id: id, leaseToken: token, submissionStarted: false },
        { $set: { submissionStarted: true } }
      );
      if (claimed.modifiedCount !== 1)
        throw new Error('Refund submission ownership changed.');
      try {
        result = await gateway.createRefund({
          chargeId: refund.chargeId,
          reference: refund.reference,
          reason: refund.reason,
          amount: naira(refund.amountKobo),
        });
      } catch (error) {
        if (error.definitiveRejection) {
          const concurrent = await gateway.getRefundByCharge(refund.chargeId);
          if (concurrent) {
            await applyRefundResult(id, concurrent, token);
            return;
          }
          await applyRefundResult(
            id,
            {
              refund_id: refund.reference,
              charge_id: refund.chargeId,
              reference: refund.reference,
              requested_amount: naira(refund.amountKobo),
              status: 'failed',
            },
            token
          );
          return;
        }
        throw error;
      }
    }
    await applyRefundResult(id, result, token);
  } catch {
    await OrderRefund.updateOne(
      { _id: id, leaseToken: token, status: 'processing' },
      {
        $set: {
          outcome:
            'Awaiting provider confirmation. Do not send another refund. Technical review may be needed.',
          nextAttemptAt: new Date(Date.now() + 60000),
        },
        $unset: { leaseToken: '', leaseUntil: '' },
      }
    );
  }
}

export async function processPendingRefunds() {
  const jobs = await OrderRefund.find({
    mode: 'bachs',
    status: 'processing',
    nextAttemptAt: { $lte: new Date() },
  })
    .select('_id')
    .limit(30)
    .lean();
  for (const job of jobs) await processRefund(job._id);
}

export async function processRefundEvent(event) {
  const payload = event.payload?.data || {};
  const gateway = paymentFactory.getGateway('bachs');
  const result = await gateway.getRefund(payload.refund_id);
  if (
    result.refund_id !== payload.refund_id ||
    (payload.charge_id && result.charge_id !== payload.charge_id)
  )
    throw new Error(
      'Refund event identifiers do not match provider verification.'
    );
  const refund = await OrderRefund.findOne({
    mode: 'bachs',
    reference: result.reference,
    chargeId: result.charge_id,
  });
  if (!refund) {
    // External/dashboard refunds cannot be silently dropped or used to create unverified local records.
    const order = await Order.findOne({
      'payment.gateway': 'bachs',
      'payment.chargeId': result.charge_id,
    });
    if (order)
      await inTransaction(async (session) => {
        const current = await Order.findById(order._id).session(session);
        current.support.open = true;
        current.support.externalRefundReview = true;
        current.support.externalRefundId = result.refund_id;
        await orderAudit(
          current,
          'external_refund_review',
          'A provider refund made outside McLily requires reconciliation. Do not send another refund.',
          {},
          session
        );
        await current.save({ session });
        await queueTechnical('external-refund:' + result.refund_id, 'A refund made outside McLily needs reconciliation. Check the order resolution controls.', session, current.orderNumber);
      });
    await PaymentEvent.updateOne(
      { _id: event._id, leaseToken: event.leaseToken },
      {
        $set: {
          status: 'review',
          outcome:
            'External or unmatched refund requires technical reconciliation.',
        },
        $unset: { leaseToken: '', leaseUntil: '' },
      }
    );
    return;
  }
  await applyRefundResult(refund._id, result);
  await PaymentEvent.updateOne(
    { _id: event._id, leaseToken: event.leaseToken },
    {
      $set: {
        status: 'completed',
        outcome: 'Refund reconciled with provider.',
      },
      $unset: { leaseToken: '', leaseUntil: '' },
    }
  );
}
