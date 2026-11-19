import { createHash } from 'node:crypto';
import validator from 'validator';
import EmailOutbox from '../models/EmailOutbox.js';
import Order from '../models/Order.js';
import PaymentCollection from '../models/PaymentCollection.js';
import { sealEmail, openEmail } from '../utils/emailPayload.js';
import { emailRecipients } from './emailService.js';
import { toKobo } from '../utils/creditMoney.js';
import env from '../config/env.js';
export async function enqueueEmail(
  { key, kind, group, to, data, order, user, expiresAt },
  session
) {
  if (!session?.inTransaction())
    throw new Error(
      'Notification writes require the business transaction session.'
    );
  const recipient = String(to || '')
    .trim()
    .toLowerCase();
  if (!validator.isEmail(recipient)) return;
  return EmailOutbox.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        kind,
        group,
        to: recipient,
        order,
        user,
        expiresAt,
        payload: sealEmail(data),
      },
    },
    { upsert: true, returnDocument: 'after', session }
  );
}
export async function queueTechnical(key, message, session, orderNumber) {
  for (const to of emailRecipients('technical'))
    await enqueueEmail(
      {
        key: `technical:${key}:${to}`,
        kind: 'technical_alert',
        group: 'technical',
        to,
        data: { message, orderNumber },
      },
      session
    );
}
const snapshot = (order) => ({
  user: order.user,
  orderNumber: order.orderNumber,
  customer: { name: order.customer.name, phone: order.customer.phone },
  pricing: order.pricing,
  delivery: order.delivery ? { method: order.delivery.method, label: order.delivery.label, description: order.delivery.description, courierStatus: order.delivery.courierStatus, courierName: order.delivery.courierName, courierFee: order.delivery.courierFee } : undefined,
  orderItems: order.orderItems.map((item) => ({
    name: item.name,
    productType: item.productType,
    size: item.size,
    color: item.color,
    quantity: item.quantity,
    yards: item.yards,
    halfYards: item.halfYards,
    fabricColor: item.fabricColor,
    subtotal: item.subtotal,
  })),
  payment: { status: order.payment.status },
  refundSummary: order.refundSummary
    ? { status: order.refundSummary.status, amount: order.refundSummary.amount }
    : undefined,
});
export async function queueOrderCreated(order, accessToken, session) {
  const url = new URL('/checkout/confirmation', env.FRONTEND_URL);
  url.searchParams.set('order', order.orderNumber);
  if (!order.user) url.searchParams.set('access', accessToken);
  if (!order.user) {
    order.notificationAccess = sealEmail({ url: url.toString() });
    await order.save({ session });
  }
  await enqueueEmail(
    {
      key: `order-created:${order._id}`,
      kind: 'order_placed',
      group: 'customer',
      to: order.customer.email,
      order: order._id,
      data: { order: snapshot(order), orderUrl: url.toString() },
    },
    session
  );
  for (const to of emailRecipients('operations'))
    await enqueueEmail(
      {
        key: `order-created:${order._id}:${to}`,
        kind: 'operations_created',
        group: 'operations',
        to,
        order: order._id,
        data: { order: snapshot(order) },
      },
      session
    );
}
export async function queueOrderUpdate(
  order,
  event,
  session,
  eventKey = event
) {
  const key = `order:${order._id}:${eventKey}`;
  let orderUrl;
  if (!order.user) {
    const source = await Order.findById(order._id)
      .select('+notificationAccess')
      .session(session);
    if (source?.notificationAccess)
      orderUrl = openEmail(source.notificationAccess).url;
  }
  await enqueueEmail(
    {
      key: key + ':customer',
      kind: 'customer_' + event,
      group: 'customer',
      to: order.customer.email,
      order: order._id,
      data: { order: snapshot(order), orderUrl },
    },
    session
  );
  for (const to of emailRecipients('operations'))
    await enqueueEmail(
      {
        key: key + ':' + to,
        kind: 'operations_' + event,
        group: 'operations',
        to,
        order: order._id,
        data: { order: snapshot(order) },
      },
      session
    );
  if (event === 'review')
    await queueTechnical(
      key,
      'An order needs payment or stock reconciliation. Open the order resolution controls.',
      session,
      order.orderNumber
    );
}
export async function recordVerifiedCollection(order, verification, session) {
  const current = toKobo(verification.amount),
    previous = order.payment.recordedCollectionKobo || 0;
  if (current <= previous) return;
  const receiptKey = createHash('sha256')
    .update(
      `${order._id}:${verification.chargeId || order.payment.reference}:${current}`
    )
    .digest('hex');
  await PaymentCollection.create(
    [
      {
        key: receiptKey,
        order: order._id,
        amountKobo: current - previous,
        chargeId: verification.chargeId,
        gateway: order.payment.gateway,
      },
    ],
    { session }
  );
  order.payment.recordedCollectionKobo = current;
}
