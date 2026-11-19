import PaymentCollection from '../models/PaymentCollection.js';
import PhysicalSale from '../models/PhysicalSale.js';
import CreditEntry from '../models/CreditEntry.js';
import CreditAccount from '../models/CreditAccount.js';
import OrderRefund from '../models/OrderRefund.js';
import Order from '../models/Order.js';
import { AppError } from '../utils/AppError.js';

const dayMs = 86400000;
export const REPORT_TIME_ZONE = 'Africa/Lagos';
export function lagosDate(now = new Date()) {
  return new Date(now.getTime() + 3600000).toISOString().slice(0, 10);
}
function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  );
}
export function reportPeriod(query = {}, now = new Date()) {
  const from = query.from ?? lagosDate(now),
    to = query.to ?? from;
  if (
    Object.keys(query).some((key) => !['from', 'to'].includes(key)) ||
    !validDate(from) ||
    !validDate(to)
  )
    throw new AppError(
      400,
      'INVALID_REPORT_DATES',
      'Choose valid From and To dates.'
    );
  const start = new Date(from + 'T00:00:00+01:00'),
    end = new Date(new Date(to + 'T00:00:00+01:00').getTime() + dayMs);
  const days = (end - start) / dayMs;
  if (days < 1 || days > 366 || to > lagosDate(now))
    throw new AppError(
      400,
      'INVALID_REPORT_RANGE',
      'Choose up to 366 days, ending today or earlier.'
    );
  return { from, to, start, end, days };
}
const asKobo = (field) => ({
  $toLong: { $round: [{ $multiply: [{ $ifNull: [field, 0] }, 100] }, 0] },
});
const dateGroup = (field) => ({
  $dateToString: {
    date: field,
    format: '%Y-%m-%d',
    timezone: REPORT_TIME_ZONE,
  },
});
function integer(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number))
    throw new AppError(
      503,
      'REPORT_AMOUNT_UNAVAILABLE',
      'A stored report amount needs technical review.'
    );
  return number;
}
const emptyDay = (date) => ({
  date,
  onlineSalesKobo: 0,
  posSalesKobo: 0,
  onlineOrders: 0,
  posReceipts: 0,
  onlineCollectionsKobo: 0,
  initialPosPaymentsKobo: 0,
  debtRepaymentsKobo: 0,
  refundsKobo: 0,
  creditAddedKobo: 0,
  openingDebtKobo: 0,
  forgivenKobo: 0,
  correctionsKobo: 0,
  receivedKobo: 0,
  cashAfterRefundsKobo: 0,
  salesKobo: 0,
  missingPosInitial: 0,
});

export async function buildSalesReport(period, session) {
  const dates = { $gte: period.start, $lt: period.end };
  const daily = Array.from({ length: period.days }, (_, index) =>
    emptyDay(
      new Date(period.start.getTime() + index * dayMs + 3600000)
        .toISOString()
        .slice(0, 10)
    )
  );
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const merge = (rows) => {
    for (const row of rows) {
      const target = byDate.get(row._id);
      if (target)
        for (const [key, value] of Object.entries(row))
          if (key !== '_id') target[key] = integer(value);
    }
  };
  // Sequential operations share one read snapshot, including totals and chart buckets.
  merge(
    await PaymentCollection.aggregate([
      { $match: { createdAt: dates } },
      {
        $group: {
          _id: dateGroup('$createdAt'),
          onlineCollectionsKobo: { $sum: '$amountKobo' },
        },
      },
    ]).session(session)
  );
  merge(
    await PhysicalSale.aggregate([
      { $match: { createdAt: dates } },
      {
        $group: {
          _id: dateGroup('$createdAt'),
          posSalesKobo: { $sum: asKobo('$totalAmount') },
          posReceipts: { $sum: 1 },
          initialPosPaymentsKobo: { $sum: asKobo('$initialAmountPaid') },
          missingPosInitial: {
            $sum: {
              $cond: [
                { $in: [{ $type: '$initialAmountPaid' }, ['missing', 'null']] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).session(session)
  );
  const sumEntry = (type) => ({
    $sum: { $cond: [{ $eq: ['$type', type] }, '$deltaKobo', 0] },
  });
  merge(
    await CreditEntry.aggregate([
      { $match: { createdAt: dates } },
      {
        $group: {
          _id: dateGroup('$createdAt'),
          debtRepaymentsKobo: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'payment'] },
                { $multiply: ['$deltaKobo', -1] },
                0,
              ],
            },
          },
          creditAddedKobo: sumEntry('credit_sale'),
          openingDebtKobo: sumEntry('opening_balance'),
          correctionsKobo: sumEntry('balance_correction'),
          forgivenKobo: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'write_off'] },
                { $multiply: ['$deltaKobo', -1] },
                0,
              ],
            },
          },
        },
      },
    ]).session(session)
  );
  merge(
    await OrderRefund.aggregate([
      { $match: { status: 'completed', completedAt: dates } },
      {
        $group: {
          _id: dateGroup('$completedAt'),
          refundsKobo: { $sum: '$amountKobo' },
        },
      },
    ]).session(session)
  );
  merge(
    await Order.aggregate([
      {
        $match: {
          'payment.paidAt': dates,
          'payment.status': { $in: ['paid', 'refunded'] },
          'inventory.status': 'consumed',
        },
      },
      {
        $group: {
          _id: dateGroup('$payment.paidAt'),
          onlineSalesKobo: { $sum: asKobo('$pricing.subtotal') },
          onlineOrders: { $sum: 1 },
        },
      },
    ]).session(session)
  );
  const totals = emptyDay(undefined);
  delete totals.date;
  for (const day of daily) {
    day.receivedKobo = integer(
      day.onlineCollectionsKobo +
        day.initialPosPaymentsKobo +
        day.debtRepaymentsKobo
    );
    day.cashAfterRefundsKobo = integer(day.receivedKobo - day.refundsKobo);
    day.salesKobo = integer(day.onlineSalesKobo + day.posSalesKobo);
    for (const key of Object.keys(totals))
      totals[key] = integer(totals[key] + day[key]);
  }
  const [debt = {}] = await CreditAccount.aggregate([
    {
      $group: {
        _id: null,
        balance: { $sum: '$balanceKobo' },
        customers: { $sum: { $cond: [{ $gt: ['$balanceKobo', 0] }, 1, 0] } },
      },
    },
  ]).session(session);
  const needsReview = await Order.countDocuments({
    $or: [
      { 'payment.status': 'review' },
      { 'fulfillment.status': 'needs_resolution' },
      { 'support.externalRefundReview': true },
    ],
  }).session(session);
  const missingOnlineCollections = await Order.countDocuments({
    'payment.paidAt': dates,
    'payment.status': { $in: ['paid', 'refunded'] },
    'payment.recordedCollectionKobo': { $in: [0, null] },
  }).session(session);
  const undatedPaidOrders = await Order.countDocuments({
    'payment.status': { $in: ['paid', 'refunded'] },
    'payment.paidAt': null,
  }).session(session);
  const legacyCreditReceipts = await PhysicalSale.countDocuments({
    balanceDue: { $gt: 0 },
    creditAccount: null,
  }).session(session);
  return {
    period: {
      from: period.from,
      to: period.to,
      start: period.start.toISOString(),
      endExclusive: period.end.toISOString(),
      timeZone: REPORT_TIME_ZONE,
    },
    generatedAt: new Date().toISOString(),
    totals,
    daily,
    current: {
      outstandingCreditKobo: integer(debt.balance),
      owingCustomers: integer(debt.customers),
      ordersNeedingReview: needsReview,
    },
    quality: {
      missingPosInitial: totals.missingPosInitial,
      missingOnlineCollections,
      undatedPaidOrders,
      legacyCreditReceipts,
    },
    notes: [
      'Sales value is goods sold, including in-store credit. Online sales use verified paid orders with committed stock and the payment date; refunds are shown separately.',
      'Money received uses immutable recorded online collections, initial POS payments and customer repayments once. Online fees/delivery collected are included; courier fees paid separately are excluded.',
      'Opening debt, corrections and forgiveness are not money received. Outstanding credit and review counts are current balances, not historic closing balances.',
      'Cash after refunds is not profit or a provider settlement figure. Product costs, operating expenses and gateway fees are not deducted.',
      ...(totals.missingPosInitial || missingOnlineCollections
        ? [
            'Older records with missing initial-payment or collection evidence need review; missing cash is excluded rather than estimated.',
          ]
        : []),
      ...(undatedPaidOrders || legacyCreditReceipts
        ? [
            'Undated paid orders cannot be assigned to a period. Unlinked older credit receipts are excluded from the current ledger balance until reviewed/migrated.',
          ]
        : []),
    ],
  };
}
