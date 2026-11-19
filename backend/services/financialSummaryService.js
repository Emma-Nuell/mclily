import PaymentCollection from '../models/PaymentCollection.js';
import PhysicalSale from '../models/PhysicalSale.js';
import CreditEntry from '../models/CreditEntry.js';
import CreditAccount from '../models/CreditAccount.js';
import OrderRefund from '../models/OrderRefund.js';
import Order from '../models/Order.js';
import NotificationState from '../models/NotificationState.js';
import { inTransaction } from './transactionService.js';
import { enqueueEmail } from './notificationService.js';
import { emailConfiguration, emailRecipients } from './emailService.js';
import env from '../config/env.js';
const fortnight = 14 * 86400000;
async function aggregate(model, pipeline, session) {
  const rows = await model.aggregate(pipeline).session(session);
  return rows[0] || {};
}
export async function buildFinancialSummary(start, end, session) {
  const dates = { $gte: start, $lt: end };
  const online = await aggregate(
    PaymentCollection,
    [
      { $match: { createdAt: dates } },
      { $group: { _id: null, amount: { $sum: '$amountKobo' } } },
    ],
    session
  );
  const pos = await aggregate(
    PhysicalSale,
    [
      { $match: { createdAt: dates } },
      {
        $group: {
          _id: null,
          sales: { $sum: '$totalAmount' },
          received: { $sum: '$initialAmountPaid' },
          count: { $sum: 1 },
          missing: {
            $sum: {
              $cond: [
                { $eq: [{ $type: '$initialAmountPaid' }, 'missing'] },
                1,
                0,
              ],
            },
          },
        },
      },
    ],
    session
  );
  const payments = await aggregate(
    CreditEntry,
    [
      { $match: { createdAt: dates } },
      {
        $group: {
          _id: null,
          payments: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'payment'] },
                { $multiply: ['$deltaKobo', -1] },
                0,
              ],
            },
          },
          forgiven: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'write_off'] },
                { $multiply: ['$deltaKobo', -1] },
                0,
              ],
            },
          },
          openings: {
            $sum: {
              $cond: [{ $eq: ['$type', 'opening_balance'] }, '$deltaKobo', 0],
            },
          },
          corrections: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'balance_correction'] },
                '$deltaKobo',
                0,
              ],
            },
          },
        },
      },
    ],
    session
  );
  const refunds = await aggregate(
    OrderRefund,
    [
      { $match: { status: 'completed', completedAt: dates } },
      { $group: { _id: null, amount: { $sum: '$amountKobo' } } },
    ],
    session
  );
  const owing = await aggregate(
    CreditAccount,
    [{ $group: { _id: null, amount: { $sum: '$balanceKobo' } } }],
    session
  );
  const review = await Order.countDocuments({
    $or: [
      { 'payment.status': 'review' },
      { 'fulfillment.status': 'needs_resolution' },
      { 'support.externalRefundReview': true },
    ],
  }).session(session);
  const missingOnline = await Order.countDocuments({
    'payment.status': { $in: ['paid', 'refunded'] },
    'payment.recordedCollectionKobo': { $in: [0, null] },
  }).session(session);
  const onlineCash = (online.amount || 0) / 100,
    initialCash = Math.round((pos.received || 0) * 100) / 100,
    repayments = (payments.payments || 0) / 100,
    refundCash = (refunds.amount || 0) / 100;
  const receivedKobo =
    (online.amount || 0) +
    Math.round(initialCash * 100) +
    (payments.payments || 0);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    metrics: {
      'Recorded online collections': onlineCash,
      'In-store sales value (includes credit)':
        Math.round((pos.sales || 0) * 100) / 100,
      'In-store receipts': String(pos.count || 0),
      'Initial in-store payments': initialCash,
      'Customer debt repayments': repayments,
      'Total recorded money received': receivedKobo / 100,
      'Recorded completed refunds': refundCash,
      'Recorded cash less refunds':
        (receivedKobo - (refunds.amount || 0)) / 100,
      'Opening debt added (not sales)': (payments.openings || 0) / 100,
      'Debt forgiven (not cash)': (payments.forgiven || 0) / 100,
      'Net debt corrections (not cash)': (payments.corrections || 0) / 100,
      'Current customer debt': (owing.amount || 0) / 100,
      'Current orders needing review': String(review),
    },
    notes: [
      `Current balances were prepared at ${new Date().toISOString()}. They are point-in-time figures, not historic closing balances.`,
      'Repayments include opening-debt payments and receipt payments once. Opening debt, forgiveness and corrections are not money received.',
      'Provider fees, product costs and settlement balances are not included. This is not profit. Refunds reflect recorded provider/manual completion.',
      ...(pos.missing || missingOnline
        ? [
            `Data review: ${pos.missing || 0} older in-store receipts lack initial-payment figures; ${missingOnline} online orders lack immutable collection receipts. These amounts are excluded rather than estimated.`,
          ]
        : []),
    ],
  };
}
export async function scheduleFinancialSummary(now = new Date()) {
  const config = emailConfiguration();
  if (!config.enabled || !config.configured) return;
  await inTransaction(async (session) => {
    let state =
      await NotificationState.findById('financial-summary').session(session);
    if (!state) {
      await NotificationState.create(
        [
          {
            _id: 'financial-summary',
            nextRunAt: env.FINANCIAL_SUMMARY_FIRST_AT
              ? new Date(env.FINANCIAL_SUMMARY_FIRST_AT)
              : new Date(now.getTime() + fortnight),
          },
        ],
        { session }
      );
      return;
    }
    if (state.nextRunAt > now) return;
    // On a long outage, send one latest completed fortnight, rather than a flood of stale summaries.
    let end = state.nextRunAt;
    while (end.getTime() + fortnight <= now.getTime())
      end = new Date(end.getTime() + fortnight);
    const start = new Date(end.getTime() - fortnight),
      data = await buildFinancialSummary(start, end, session);
    for (const to of emailRecipients('financial'))
      await enqueueEmail(
        {
          key: `financial:${end.toISOString()}:${to}`,
          kind: 'financial_summary',
          group: 'financial',
          to,
          data,
        },
        session
      );
    state.nextRunAt = new Date(end.getTime() + fortnight);
    await state.save({ session });
  });
}
