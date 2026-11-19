import Order from '../models/Order.js';
import OrderRefund from '../models/OrderRefund.js';
import OrderAction from '../models/OrderAction.js';
import PaymentEvent from '../models/PaymentEvent.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import {
  idempotentTransaction,
  requestKey,
} from '../services/idempotencyService.js';
import { orderAudit, refundData } from '../services/refundService.js';
import { moveInventory } from '../services/inventoryService.js';
import { releaseOrderHold } from '../services/reservationService.js';
import { processPaymentEvent } from '../services/paymentEventService.js';
import { toKobo, naira } from '../utils/creditMoney.js';
import { yardsToHalfYards } from '../utils/feeCalculator.js';
import env from '../config/env.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import { queueOrderUpdate } from '../services/notificationService.js';

async function loadOrder(id, session) {
  if (!/^[a-f0-9]{24}$/i.test(id))
    throw new AppError(400, 'INVALID_ORDER', 'Choose a valid order.');
  const order = await Order.findById(id).session(session || null);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return order;
}
function reason(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length < 3 ||
    value.trim().length > 1000
  )
    throw new AppError(
      400,
      'REASON_REQUIRED',
      'Enter a reason or note between 3 and 1,000 characters.'
    );
  return value.trim();
}
const revision = (order) => order.support?.revision || 0;
const paidAmountMatches = (order) =>
  order.payment.currency === 'NGN' &&
  Number.isFinite(order.payment.receivedAmount) &&
  toKobo(order.payment.receivedAmount) === toKobo(order.pricing.totalAmount);
const refundableCollection = (order) =>
  (order.payment.status === 'paid' && paidAmountMatches(order)) ||
  (order.payment.status === 'review' &&
    order.payment.collectionVerifiedAt &&
    order.payment.currency === 'NGN' &&
    Number.isFinite(order.payment.receivedAmount) &&
    order.payment.receivedAmount > 0);
export const getOrderResolution = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  const page = Math.max(1, parseInt(req.query.page) || 1),
    limit = 10;
  const [total, actions, refunds] = await Promise.all([
    OrderAction.countDocuments({ order: order._id }),
    OrderAction.find({ order: order._id })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    OrderRefund.find({ order: order._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20),
  ]);
  res.json({
    success: true,
    data: {
      order,
      revision: revision(order),
      refunds: refunds.map(refundData),
      actions: actions.map(({ actor, ...entry }) => entry),
      pages: Math.ceil(total / limit) || 1,
      page,
      total,
      gatewayRefundsEnabled: env.BACHS_REFUNDS_ENABLED,
    },
  });
});

export const resolveOrderAction = asyncHandler(async (req, res) => {
  const key = requestKey(req),
    action = req.params.action;
  const payload = {
    ...req.body,
    idempotencyKey: undefined,
    order: req.params.id,
    action,
    actor: String(req.user._id),
  };
  let external;
  if (action === 'reconcile-provider-refund') {
    const original = await loadOrder(req.params.id);
    const previous = await IdempotencyLog.findOne({
      key: 'ORDER_ACTION_' + key,
    });
    if (!previous) {
      if (!original.support.externalRefundId || !original.payment.chargeId)
        throw new AppError(
          409,
          'NO_EXTERNAL_REFUND',
          'No identified external refund is awaiting reconciliation.'
        );
      const gateway = paymentFactory.getGateway('bachs');
      try {
        external = {
          refund: await gateway.getRefund(original.support.externalRefundId),
          payment: await gateway.getRefundPayment(original.payment.chargeId),
        };
      } catch {
        throw new AppError(
          503,
          'PROVIDER_UNAVAILABLE',
          'The provider could not confirm the refund. Keep it under review and try again.'
        );
      }
    }
  }
  const result = await idempotentTransaction(
    'ORDER_ACTION_' + key,
    'ORDER_RESOLUTION',
    payload,
    async (session) => {
      const order = await loadOrder(req.params.id, session);
      if (
        !Number.isSafeInteger(req.body.expectedRevision) ||
        req.body.expectedRevision !== revision(order)
      )
        throw new AppError(
          409,
          'ORDER_CHANGED',
          'This order changed. Refresh its details before continuing.'
        );
      const note = reason(req.body.reason);
      let refund, event;
      if (action === 'issue' || action === 'note') {
        if (action === 'issue') order.support.open = true;
      } else if (action === 'resolve') {
        if (order.support.externalRefundReview)
          throw new AppError(
            409,
            'EXTERNAL_REFUND_REVIEW',
            'An external refund must be reconciled before this issue can be closed.'
          );
        if (order.fulfillment.status === 'needs_resolution') {
          if (order.payment.status !== 'paid' || !paidAmountMatches(order))
            throw new AppError(
              409,
              'PAYMENT_REVIEW_REQUIRED',
              'A matching verified payment is required. Recheck the payment first.'
            );
          if (
            ['requested', 'processing', 'completed'].includes(
              order.refundSummary?.status
            )
          )
            throw new AppError(
              409,
              'REFUND_ACTIVE',
              'This order already has an active or completed refund.'
            );
          if ([...order.inventory.restored.values()].some((value) => value > 0))
            throw new AppError(
              409,
              'STOCK_ALREADY_RESTORED',
              'Some goods were already restored to stock. Review this order before resuming.'
            );
          if (order.inventory.status !== 'consumed')
            await moveInventory(
              order.orderItems,
              order.inventory.status === 'held' ? 'capture' : 'sell',
              session,
              { source: 'RECOVER_' + order._id, actor: String(req.user._id) }
            );
          order.inventory.status = 'consumed';
          order.fulfillment.status = 'processing';
          order.payment.reviewReason = undefined;
        } else if (
          order.payment.status === 'review' ||
          ['requested', 'processing'].includes(order.refundSummary?.status)
        )
          throw new AppError(
            409,
            'ISSUE_UNRESOLVED',
            'Payment or refund confirmation is still outstanding.'
          );
        order.support.open = false;
      } else if (action === 'restock') {
        if (
          req.body.inspected !== true ||
          order.inventory.status !== 'consumed' ||
          !['cancelled', 'delivered'].includes(order.fulfillment.status)
        )
          throw new AppError(
            409,
            'INSPECTION_REQUIRED',
            'Only inspected goods from cancelled or delivered orders can be restored to stock.'
          );
        if (
          !Array.isArray(req.body.items) ||
          !req.body.items.length ||
          req.body.items.length > order.orderItems.length
        )
          throw new AppError(
            400,
            'INVALID_ITEMS',
            'Choose the items actually received and inspected.'
          );
        const seen = new Set(),
          items = [];
        for (const input of req.body.items) {
          const item = order.orderItems.id(input.itemId);
          if (!item || seen.has(input.itemId))
            throw new AppError(
              400,
              'INVALID_ITEMS',
              'Choose each order item once.'
            );
          seen.add(input.itemId);
          const fabric = item.productType === 'fabric';
          let units;
          try {
            units = fabric
              ? yardsToHalfYards(Number(input.yards))
              : input.quantity;
          } catch {
            throw new AppError(
              400,
              'INVALID_QUANTITY',
              'Use half-yard increments for fabric.'
            );
          }
          const restored = order.inventory.restored.get(String(item._id)) || 0;
          if (
            !Number.isSafeInteger(units) ||
            units <= 0 ||
            restored + units > (fabric ? item.halfYards : item.quantity)
          )
            throw new AppError(
              409,
              'RESTOCK_EXCEEDS_SALE',
              'You cannot restore more than the quantity sold on this order.'
            );
          order.inventory.restored.set(String(item._id), restored + units);
          items.push({
            ...item.toObject(),
            ...(fabric
              ? { halfYards: units, yards: units / 2 }
              : { quantity: units }),
          });
        }
        await moveInventory(items, 'restore', session, {
          source: 'RESTORE_' + key,
          actor: String(req.user._id),
          reason: note,
        });
      } else if (action === 'reconcile-provider-refund') {
        if (
          order.payment.gateway !== 'bachs' ||
          !order.support.externalRefundReview ||
          !external
        )
          throw new AppError(
            409,
            'NO_EXTERNAL_REFUND',
            'Refresh the current provider refund details.'
          );
        const remote = external.refund,
          payment = external.payment;
        if (
          ['requested', 'processing', 'completed'].includes(
            order.refundSummary?.status
          )
        )
          throw new AppError(
            409,
            'REFUND_EXISTS',
            'Resolve the existing local refund before importing another.'
          );
        if (
          remote.refund_id !== order.support.externalRefundId ||
          remote.charge_id !== order.payment.chargeId ||
          !remote.reference ||
          payment.reference !== order.payment.reference ||
          payment.currency !== 'NGN' ||
          toKobo(payment.amount_paid) !== toKobo(order.pricing.totalAmount) ||
          toKobo(remote.requested_amount) !== toKobo(payment.amount_paid)
        )
          throw new AppError(
            409,
            'REFUND_REVIEW_REQUIRED',
            'Provider identity or amount does not match this full refund. Technical review is required.'
          );
        [refund] = await OrderRefund.create(
          [
            {
              order: order._id,
              reference: remote.reference,
              mode: 'bachs',
              status: 'processing',
              amountKobo: toKobo(payment.amount_paid),
              reason: note,
              chargeId: order.payment.chargeId,
              providerId: remote.refund_id,
              submissionStarted: true,
              createdBy: req.user._id,
            },
          ],
          { session }
        );
        order.refundSummary = {
          active: refund._id,
          status: 'processing',
          amount: naira(refund.amountKobo),
        };
        await releaseOrderHold(order, session);
      } else if (action === 'refund-request') {
        if (order.support.externalRefundReview)
          throw new AppError(
            409,
            'EXTERNAL_REFUND_REVIEW',
            'Reconcile the existing provider refund before recording another.'
          );
        if (!refundableCollection(order))
          throw new AppError(
            409,
            'PAYMENT_REVIEW_REQUIRED',
            'A verified NGN collection tied to this order is required before refunding. Recheck payment first.'
          );
        if (
          ['requested', 'processing', 'completed'].includes(
            order.refundSummary?.status
          )
        )
          throw new AppError(
            409,
            'REFUND_EXISTS',
            'This order already has an active or completed refund.'
          );
        if (!['manual', 'bachs'].includes(req.body.mode))
          throw new AppError(
            400,
            'INVALID_REFUND_MODE',
            'Choose how this refund will be handled.'
          );
        if (
          req.body.mode === 'bachs' &&
          (!env.BACHS_REFUNDS_ENABLED ||
            order.payment.gateway !== 'bachs' ||
            order.payment.channel !== 'NGN_CARD' ||
            !order.payment.chargeId)
        )
          throw new AppError(
            409,
            'GATEWAY_REFUND_UNAVAILABLE',
            'Gateway refunds are not configured for this payment.'
          );
        if (req.body.providerChecked !== true)
          throw new AppError(
            400,
            'REFUND_CHECK_REQUIRED',
            'Check that the provider has not already refunded this payment.'
          );
        await releaseOrderHold(order, session);
        [refund] = await OrderRefund.create(
          [
            {
              order: order._id,
              reference: 'MCL-RF-' + key,
              mode: req.body.mode,
              amountKobo: toKobo(order.payment.receivedAmount),
              reason: note,
              chargeId: order.payment.chargeId,
              createdBy: req.user._id,
            },
          ],
          { session }
        );
        order.refundSummary = {
          active: refund._id,
          status: 'requested',
          amount: naira(refund.amountKobo),
        };
        order.support.open = true;
      } else if (
        ['refund-start', 'refund-complete', 'refund-fail'].includes(action)
      ) {
        refund = await OrderRefund.findById(
          order.refundSummary?.active
        ).session(session);
        if (!refund || String(refund._id) !== String(req.body.refundId))
          throw new AppError(
            409,
            'REFUND_CHANGED',
            'Refresh and choose the current refund.'
          );
        if (action === 'refund-start') {
          if (toKobo(order.payment.receivedAmount) !== refund.amountKobo)
            throw new AppError(
              409,
              'REFUND_AMOUNT_CHANGED',
              'The collected amount changed. Review the payment before sending money.'
            );
          if (refund.status !== 'requested')
            throw new AppError(
              409,
              'REFUND_CHANGED',
              'This refund has already started or finished.'
            );
          if (refund.mode === 'bachs' && !env.BACHS_REFUNDS_ENABLED)
            throw new AppError(
              409,
              'GATEWAY_REFUND_UNAVAILABLE',
              'Gateway refund initiation is disabled.'
            );
          refund.status = 'processing';
          refund.nextAttemptAt = new Date();
        } else {
          if (toKobo(order.payment.receivedAmount) !== refund.amountKobo)
            throw new AppError(
              409,
              'REFUND_AMOUNT_CHANGED',
              'The collected amount changed. Review the payment before confirming this refund.'
            );
          if (refund.mode !== 'manual' || refund.status !== 'processing')
            throw new AppError(
              409,
              'REFUND_NOT_MANUAL',
              'Only a processing manual refund can be confirmed here. Gateway results are verified by the server.'
            );
          if (action === 'refund-complete') {
            if (
              req.body.sentConfirmed !== true ||
              typeof req.body.transferReference !== 'string' ||
              !req.body.transferReference.trim() ||
              req.body.transferReference.length > 200 ||
              typeof req.body.evidence !== 'string' ||
              req.body.evidence.trim().length < 3 ||
              req.body.evidence.length > 1000
            )
              throw new AppError(
                400,
                'REFUND_EVIDENCE_REQUIRED',
                'Confirm the transfer and enter its reference and evidence details.'
              );
            refund.transferReference = req.body.transferReference
              .trim()
              .toUpperCase();
            refund.evidence = req.body.evidence.trim();
            refund.status = 'completed';
            refund.completedAt = new Date();
            order.payment.status = 'refunded';
            order.fulfillment.status = 'cancelled';
            order.support.open = false;
          } else {
            if (req.body.noMoneyMoved !== true)
              throw new AppError(
                400,
                'REFUND_CHECK_REQUIRED',
                'Confirm that no money moved. An uncertain transfer must stay processing.'
              );
            refund.status = 'failed';
          }
        }
        refund.outcome = note;
        await refund.save({ session });
        order.refundSummary.status = refund.status;
      } else if (action === 'recheck-payment') {
        [event] = await PaymentEvent.create(
          [
            {
              key: 'ADMIN_RECHECK_' + key,
              gateway: order.payment.gateway,
              reference: order.payment.reference,
              checkoutId: order.payment.checkoutId,
              payloadHash: 'admin:' + key,
              payload: { source: 'admin' },
            },
          ],
          { session }
        );
      } else throw new AppError(404, 'INVALID_ACTION', 'Unknown order action.');
      await orderAudit(
        order,
        action.replaceAll('-', '_'),
        note,
        req.user,
        session,
        { ...(refund ? { refund: refund._id } : {}) }
      );
      order.fulfillment.timeline.push({
        status: order.fulfillment.status,
        note:
          action === 'restock'
            ? 'Inspected stock restored.'
            : action.startsWith('refund')
              ? 'Refund record updated: ' + order.refundSummary.status
              : action === 'resolve'
                ? 'Order issue resolved.'
                : 'Order checked by administrator.',
        updatedBy: req.user.fullName,
      });
      await order.save({ session });
      if (action === 'resolve' && order.fulfillment.status === 'processing') await queueOrderUpdate(order, 'preparing', session, 'preparing:' + key);
      if (action.startsWith('refund-')) await queueOrderUpdate(order, 'refund', session, 'refund-action:' + key);
      return {
        orderId: order._id,
        revision: revision(order),
        ...(event ? { eventId: event._id } : {}),
      };
    }
  );
  if (result.data.eventId) await processPaymentEvent(result.data.eventId);
  res.json({ success: true, data: result.data });
});
