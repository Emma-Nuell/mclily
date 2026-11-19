import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import env from '../config/env.js';
import connectDatabase from '../config/database.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import PhysicalSale from '../models/PhysicalSale.js';
import PaymentCollection from '../models/PaymentCollection.js';
import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import OrderRefund from '../models/OrderRefund.js';
import {
  buildSalesReport,
  reportPeriod,
} from '../services/salesReportService.js';
import { buildFinancialSummary } from '../services/financialSummaryService.js';
import { inTransaction } from '../services/transactionService.js';
const models = [
  User,
  Order,
  PhysicalSale,
  PaymentCollection,
  CreditAccount,
  CreditEntry,
  OrderRefund,
];
const dates = { from: '2026-11-01', to: '2026-11-03' };
const instant = (day) => new Date(`2026-11-0${day}T10:00:00Z`);
let admin;
const auth = (user) =>
  'Bearer ' + jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET);
const get = (query = dates, user = admin) =>
  request(app)
    .get('/api/reports/sales')
    .query(query)
    .set('Authorization', auth(user));
const report = (query = dates) =>
  inTransaction((session) => buildSalesReport(reportPeriod(query), session));
async function at(model, doc, date) {
  await model.collection.updateOne(
    { _id: doc._id },
    { $set: { createdAt: date } }
  );
  return doc;
}
async function order(overrides = {}) {
  return Order.create({
    customer: {
      name: 'Report QA',
      email: 'report@example.com',
      phone: '08000000000',
    },
    shippingAddress: {
      street: 'Fixture',
      city: 'Fixture',
      state: 'Fixture',
      deliveryTier: 'in_store_pickup',
    },
    orderItems: [
      {
        product: new mongoose.Types.ObjectId(),
        productType: 'retail',
        name: 'Fixture goods',
        unitPrice: 1000,
        quantity: 1,
        subtotal: 1000,
      },
    ],
    pricing: {
      subtotal: 1000,
      deliveryFee: 0,
      baseAmount: 1000,
      paymentFee: 120,
      totalAmount: 1120,
    },
    payment: {
      gateway: 'bachs',
      reference: crypto.randomUUID(),
      status: 'paid',
      paidAt: instant(1),
      recordedCollectionKobo: 112000,
    },
    inventory: { status: 'consumed' },
    fulfillment: { status: 'processing' },
    ...overrides,
  });
}
async function account(balance = 0) {
  return CreditAccount.create({
    fullName: 'Report account',
    phone: '08012345678',
    phoneKey: crypto.randomUUID(),
    balanceKobo: balance,
    unallocatedKobo: 0,
    createdBy: admin._id,
  });
}
async function entry(account, type, delta, before, after, sequence, day) {
  return at(
    CreditEntry,
    await CreditEntry.create({
      key: crypto.randomUUID(),
      account: account._id,
      type,
      deltaKobo: delta,
      balanceBeforeKobo: before,
      balanceAfterKobo: after,
      sequence,
      recordedBy: admin._id,
      recordedByName: admin.fullName,
    }),
    instant(day)
  );
}
async function sale({
  initial = 200,
  total = 1000,
  creditAccount,
  created = instant(1),
  ...rest
} = {}) {
  const doc = await PhysicalSale.create({
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        productType: 'retail',
        name: 'QA',
        unitPrice: total,
        quantity: 1,
        subtotal: total,
      },
    ],
    totalAmount: total,
    initialAmountPaid: initial,
    amountPaid: initial ?? 0,
    balanceDue: 0,
    recordedBy: admin._id,
    creditAccount,
    ...rest,
  });
  return at(PhysicalSale, doc, created);
}
describe('Sales report accounting and date boundaries', () => {
  beforeAll(async () => {
    await connectDatabase();
    for (const model of models) await model.init();
  });
  beforeEach(async () => {
    for (const model of models) await model.deleteMany({});
    admin = await User.create({
      fullName: 'Report admin',
      email: 'report-admin@example.com',
      password: 'isolated_report_password',
      role: 'admin',
    });
  });
  afterAll(async () => {
    for (const model of models) await model.deleteMany({});
    await mongoose.disconnect();
  });
  it('requires full-admin access and sends private no-store reports', async () => {
    expect((await request(app).get('/api/reports/sales')).status).toBe(401);
    const customer = await User.create({
      fullName: 'Customer',
      email: 'report-customer@example.com',
      password: 'isolated_report_password',
    });
    expect((await get(dates, customer)).status).toBe(403);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('uses Nigerian midnight, inclusive end dates and strict real calendar dates', () => {
    const value = reportPeriod(dates);
    expect(value.start.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(value.end.toISOString()).toBe('2026-11-03T23:00:00.000Z');
    expect(value.days).toBe(3);
    expect(reportPeriod({}, new Date('2026-11-13T23:30:00Z')).from).toBe(
      '2026-11-14'
    );
    for (const query of [
      { from: '2026-02-30' },
      { from: '2026-11-03', to: '2026-11-01' },
      { from: '2020-01-01', to: '2026-01-01' },
      { from: { $gt: '' } },
      { from: '2099-01-01' },
      { unknown: 'x' },
    ])
      expect(() => reportPeriod(query)).toThrow();
  });
  it('rejects invalid request dates without returning partial numbers', async () => {
    const response = await get({ from: '2026-02-30' });
    expect(response.status).toBe(400);
    expect(response.body.data).toBeUndefined();
  });
  it('returns true zero/empty daily buckets instead of invented sample sales', async () => {
    const data = await report();
    expect(data.daily.map((row) => row.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(data.totals.receivedKobo).toBe(0);
    expect(data.totals.salesKobo).toBe(0);
    expect(data.current.outstandingCreditKobo).toBe(0);
  });
  it('separates gross sales, cash, credit, opening debt, forgiveness and refunds without double-counting repayments', async () => {
    const online = await order();
    await at(Order, online, new Date('2026-10-01T10:00:00Z'));
    await at(
      PaymentCollection,
      await PaymentCollection.create({
        key: crypto.randomUUID(),
        order: online._id,
        amountKobo: 112000,
      }),
      instant(2)
    );
    const buyer = await account(20000),
      opening = await account(55000);
    await sale({
      creditAccount: buyer._id,
      amountPaid: 700,
      amountForgiven: 100,
      balanceDue: 200,
      paymentType: 'credit_installment',
    });
    await entry(buyer, 'credit_sale', 80000, 0, 80000, 1, 1);
    await entry(buyer, 'payment', -50000, 80000, 30000, 2, 2);
    await entry(buyer, 'write_off', -10000, 30000, 20000, 3, 3);
    await entry(opening, 'opening_balance', 50000, 0, 50000, 1, 1);
    await entry(opening, 'balance_correction', 5000, 50000, 55000, 2, 3);
    await OrderRefund.create({
      order: online._id,
      reference: crypto.randomUUID(),
      mode: 'manual',
      status: 'completed',
      amountKobo: 112000,
      reason: 'Fixture refund',
      createdBy: admin._id,
      completedAt: instant(3),
    });
    const data = await report();
    expect(data.totals).toMatchObject({
      salesKobo: 200000,
      onlineSalesKobo: 100000,
      posSalesKobo: 100000,
      onlineCollectionsKobo: 112000,
      initialPosPaymentsKobo: 20000,
      debtRepaymentsKobo: 50000,
      receivedKobo: 182000,
      refundsKobo: 112000,
      cashAfterRefundsKobo: 70000,
      creditAddedKobo: 80000,
      openingDebtKobo: 50000,
      forgivenKobo: 10000,
      correctionsKobo: 5000,
    });
    expect(data.current).toMatchObject({
      outstandingCreditKobo: 75000,
      owingCustomers: 2,
    });
    expect(data.daily[0].onlineSalesKobo).toBe(100000);
    expect(data.daily[0].onlineCollectionsKobo).toBe(0);
    expect(data.daily[1].onlineCollectionsKobo).toBe(112000);
    const email = await inTransaction((session) =>
      buildFinancialSummary(
        reportPeriod(dates).start,
        reportPeriod(dates).end,
        session
      )
    );
    expect(email.metrics['Total recorded money received'] * 100).toBe(
      data.totals.receivedKobo
    );
    expect(email.metrics['Recorded cash less refunds'] * 100).toBe(
      data.totals.cashAfterRefundsKobo
    );
  });
  it('counts a later payment on an old credit receipt as current cash, not a new sale or a changed initial payment', async () => {
    const buyer = await account(30000);
    await sale({
      creditAccount: buyer._id,
      amountPaid: 700,
      balanceDue: 300,
      created: new Date('2026-10-15T10:00:00Z'),
    });
    await entry(buyer, 'payment', -50000, 80000, 30000, 1, 2);
    const data = await report();
    expect(data.totals.posSalesKobo).toBe(0);
    expect(data.totals.initialPosPaymentsKobo).toBe(0);
    expect(data.totals.receivedKobo).toBe(50000);
  });
  it('keeps recorded money under review separate from verified committed goods sales', async () => {
    const online = await order({
      payment: {
        gateway: 'bachs',
        reference: crypto.randomUUID(),
        status: 'review',
        paidAt: instant(1),
      },
      inventory: { status: 'released' },
      fulfillment: { status: 'needs_resolution' },
    });
    await at(
      PaymentCollection,
      await PaymentCollection.create({
        key: crypto.randomUUID(),
        order: online._id,
        amountKobo: 10000,
      }),
      instant(1)
    );
    const data = await report();
    expect(data.totals.receivedKobo).toBe(10000);
    expect(data.totals.onlineSalesKobo).toBe(0);
    expect(data.current.ordersNeedingReview).toBe(1);
  });
  it('uses an exclusive next-midnight boundary with exact kobo amounts', async () => {
    const online = await order(),
      period = reportPeriod(dates);
    for (const [time, amount] of [
      [period.start.getTime() - 1, 100],
      [period.start.getTime(), 101],
      [period.end.getTime() - 1, 202],
      [period.end.getTime(), 400],
    ])
      await at(
        PaymentCollection,
        await PaymentCollection.create({
          key: crypto.randomUUID(),
          order: online._id,
          amountKobo: amount,
        }),
        new Date(time)
      );
    const data = await report();
    expect(data.totals.onlineCollectionsKobo).toBe(303);
    expect(data.daily[0].onlineCollectionsKobo).toBe(101);
    expect(data.daily[2].onlineCollectionsKobo).toBe(202);
  });
  it('only counts completed refunds by completion date and permits negative cash after refunds', async () => {
    const online = await order();
    for (const [status, date, amount] of [
      ['completed', instant(2), 112000],
      ['requested', instant(2), 100],
      ['completed', new Date('2026-10-01'), 200],
    ])
      await OrderRefund.create({
        order: online._id,
        reference: crypto.randomUUID(),
        mode: 'manual',
        status,
        amountKobo: amount,
        reason: 'Fixture',
        createdBy: admin._id,
        completedAt: date,
      });
    const data = await report();
    expect(data.totals.refundsKobo).toBe(112000);
    expect(data.totals.cashAfterRefundsKobo).toBe(-112000);
  });
  it('warns about missing legacy evidence rather than treating amountPaid as initial cash', async () => {
    await sale({ initial: undefined, amountPaid: 900, balanceDue: 100 });
    const legacy = await PhysicalSale.findOne();
    await PhysicalSale.collection.updateOne(
      { _id: legacy._id },
      { $unset: { initialAmountPaid: 1 } }
    );
    await order({
      payment: {
        gateway: 'bachs',
        reference: crypto.randomUUID(),
        status: 'paid',
        paidAt: instant(1),
      },
      inventory: { status: 'consumed' },
    });
    await order({
      payment: {
        gateway: 'bachs',
        reference: crypto.randomUUID(),
        status: 'paid',
      },
    });
    const data = await report();
    expect(data.totals.initialPosPaymentsKobo).toBe(0);
    expect(data.quality).toMatchObject({
      missingPosInitial: 1,
      missingOnlineCollections: 1,
      undatedPaidOrders: 1,
      legacyCreditReceipts: 1,
    });
    expect(data.notes.join(' ')).toContain('excluded');
  });
  it('labels outstanding debt as current even for a historic selected window', async () => {
    await account(12345);
    const data = await report();
    expect(data.current.outstandingCreditKobo).toBe(12345);
    expect(data.totals.creditAddedKobo).toBe(0);
    expect(data.notes.join(' ')).toContain('not historic closing balances');
  });
  it('rounds each stored decimal payment to kobo before summing', async () => {
    for (let index = 0; index < 10; index++)
      await sale({ initial: 0.1, total: 0.1 });
    await sale({ initial: 0.2, total: 0.2 });
    expect((await report()).totals.receivedKobo).toBe(120);
  });
  it('reads a consistent snapshot across repeated source queries during concurrent writes', async () => {
    const online = await order();
    await inTransaction(async (session) => {
      const before = await buildSalesReport(reportPeriod(dates), session);
      await at(
        PaymentCollection,
        await PaymentCollection.create({
          key: crypto.randomUUID(),
          order: online._id,
          amountKobo: 10000,
        }),
        instant(2)
      );
      const after = await buildSalesReport(reportPeriod(dates), session);
      expect(after.totals.receivedKobo).toBe(before.totals.receivedKobo);
    });
    expect((await report()).totals.receivedKobo).toBe(10000);
  });
  it('does not write financial records when a report is read or refreshed', async () => {
    await sale();
    const before = await Promise.all(
      models.map((model) => model.countDocuments())
    );
    await get();
    await get();
    expect(
      await Promise.all(models.map((model) => model.countDocuments()))
    ).toEqual(before);
  });
});
