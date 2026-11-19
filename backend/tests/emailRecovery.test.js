import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { ipKeyGenerator } from 'express-rate-limit';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import EmailOutbox from '../models/EmailOutbox.js';
import NotificationState from '../models/NotificationState.js';
import PaymentCollection from '../models/PaymentCollection.js';
import PhysicalSale from '../models/PhysicalSale.js';
import CreditEntry from '../models/CreditEntry.js';
import CreditAccount from '../models/CreditAccount.js';
import OrderRefund from '../models/OrderRefund.js';
import { recoveryLimiter } from '../middlewares/rateLimitMiddleware.js';
import { openEmail, sealEmail } from '../utils/emailPayload.js';
import { inTransaction } from '../services/transactionService.js';
import {
  enqueueEmail,
  queueOrderCreated,
  queueOrderUpdate,
  queueTechnical,
  recordVerifiedCollection,
} from '../services/notificationService.js';
import {
  processEmailJob,
  processEmailOutbox,
} from '../services/emailOutboxService.js';
import { emailConfiguration, smtpTransport } from '../services/emailService.js';
import { renderEmail } from '../services/emailTemplates.js';
import {
  buildFinancialSummary,
  scheduleFinancialSummary,
} from '../services/financialSummaryService.js';

const models = [
  EmailOutbox,
  NotificationState,
  PaymentCollection,
  Order,
  PhysicalSale,
  CreditEntry,
  CreditAccount,
  OrderRefund,
];
let admin, customer;
const auth = (user) =>
  'Bearer ' +
  jwt.sign(
    { id: user._id, role: user.role, ver: user.authVersion || 0 },
    env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
const adminGet = (url) =>
  request(app)
    .get('/api/email' + url)
    .set('Authorization', auth(admin));
const adminPost = (url, data = {}) =>
  request(app)
    .post('/api/email' + url)
    .set('Authorization', auth(admin))
    .send({ idempotencyKey: crypto.randomUUID(), ...data });
const forgot = (email) =>
  request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password = 'new_isolated_password') =>
  request(app).post('/api/auth/reset-password').send({ token, password });
async function recovery(user = customer) {
  expect((await forgot(user.email)).status).toBe(202);
  const job = await EmailOutbox.findOne({
    kind: 'password_reset',
    user: user._id,
  }).select('+payload');
  const data = openEmail(job.payload);
  return {
    job,
    data,
    token: new URLSearchParams(new URL(data.resetUrl).hash.slice(1)).get(
      'token'
    ),
  };
}
async function queued(overrides = {}) {
  let result;
  await inTransaction(async (session) => {
    result = await enqueueEmail(
      {
        key: crypto.randomUUID(),
        kind: 'smtp_test',
        group: 'customer',
        to: customer.email,
        data: {},
        ...overrides,
      },
      session
    );
  });
  return result;
}
async function orderFixture(user = null) {
  return Order.create({
    user,
    customer: {
      name: 'Email customer',
      email: customer.email,
      phone: '08012345678',
    },
    shippingAddress: {
      street: 'Test',
      city: 'Test',
      state: 'Test',
      deliveryTier: 'in_store_pickup',
    },
    orderItems: [
      {
        product: new mongoose.Types.ObjectId(),
        productType: 'retail',
        name: 'Test shirt',
        quantity: 1,
        unitPrice: 1000,
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
      status: 'pending',
      reference: crypto.randomUUID(),
    },
  });
}
describe('Recovery and durable SMTP notification delivery', () => {
  beforeAll(async () => {
    await connectDatabase();
    for (const model of [User, ...models]) await model.init();
  });
  beforeEach(async () => {
    for (const model of models) await model.deleteMany({});
    await User.deleteMany({
      email: { $in: ['email-admin@example.com', 'email-customer@example.com'] },
    });
    admin = await User.create({
      fullName: 'Email admin',
      email: 'email-admin@example.com',
      password: 'old_isolated_password',
      role: 'admin',
    });
    customer = await User.create({
      fullName: 'Email customer',
      email: 'email-customer@example.com',
      password: 'old_isolated_password',
    });
    env.EMAIL_ENABLED = true;
    env.SMTP_HOST = 'smtp.example.com';
    env.SMTP_PORT = 587;
    env.SMTP_USER = 'orders@example.com';
    env.SMTP_PASS = 'isolated_mail_password';
    env.SMTP_FROM = 'McLily <orders@example.com>';
    env.EMAIL_OPERATIONS_TO = 'ops-one@example.com,ops-two@example.com';
    env.EMAIL_TECHNICAL_TO = 'tech@example.com';
    env.EMAIL_FINANCIAL_TO = 'owner@example.com';
    env.EMAIL_MAX_PER_HOUR = 50;
    env.EMAIL_MAX_PER_DAY = 200;
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      await recoveryLimiter.resetKey(ipKeyGenerator(ip));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await User.deleteMany({
      email: {
        $in: [
          'email-admin@example.com',
          'email-customer@example.com',
          'new-email-user@example.com',
        ],
      },
    });
    await mongoose.disconnect();
  });
  it('returns the same public recovery response for known, unknown and inactive accounts', async () => {
    const known = await forgot(customer.email),
      unknown = await forgot('unknown@example.com');
    await User.updateOne({ _id: customer._id }, { isActive: false });
    const inactive = await forgot(customer.email);
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual(inactive.body);
    expect(await EmailOutbox.countDocuments()).toBe(1);
    expect(known.text).not.toMatch(/token|resetUrl|passwordHash/);
  });
  it('stores a reset hash and encrypted payload, uses the correct trusted UI and ignores redirect injection', async () => {
    const { job, data, token } = await recovery();
    expect(job.payload).not.toContain(token);
    expect(job.payload).not.toContain('reset-password');
    const user = await User.findById(customer._id).select('+resetTokenHash');
    expect(user.resetTokenHash).not.toBe(token);
    expect(user.resetTokenHash).toHaveLength(64);
    expect(new URL(data.resetUrl).origin).toBe(
      new URL(env.FRONTEND_URL).origin
    );
    await request(app)
      .post('/api/auth/forgot-password')
      .set('Host', 'attacker.example')
      .send({ email: admin.email, redirectUrl: 'https://attacker.example' });
    const adminJob = await EmailOutbox.findOne({ user: admin._id }).select(
      '+payload'
    );
    expect(new URL(openEmail(adminJob.payload).resetUrl).origin).toBe(
      new URL(env.ADMIN_URL).origin
    );
  });
  it('changes the password once, hashes it and invalidates both old cookie and bearer sessions', async () => {
    const old = auth(customer),
      { token } = await recovery();
    expect((await reset(token)).status).toBe(200);
    expect((await reset(token)).status).toBe(400);
    const user = await User.findById(customer._id).select('+password');
    expect(user.password).not.toBe('new_isolated_password');
    expect(await user.matchPassword('new_isolated_password')).toBe(true);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', old)).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Cookie', 'mcl_jwt=' + old.slice(7))
      ).status
    ).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ credential: customer.email, password: 'new_isolated_password' });
    expect(login.status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer ' + login.body.token)
      ).status
    ).toBe(200);
    expect(await EmailOutbox.countDocuments({ kind: 'password_changed' })).toBe(
      1
    );
  });
  it('rejects expired links and weak passwords without consuming a valid reset link', async () => {
    const { token } = await recovery();
    expect((await reset(token, 'short')).status).toBe(400);
    await User.updateOne(
      { _id: customer._id },
      { resetExpiresAt: new Date(0) }
    );
    expect((await reset(token)).status).toBe(400);
    expect((await reset('invalid')).status).toBe(400);
  });
  it('allows only one of two concurrent reset submissions to consume a token', async () => {
    const { token } = await recovery();
    const responses = await Promise.all([reset(token), reset(token)]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(await EmailOutbox.countDocuments({ kind: 'password_changed' })).toBe(
      1
    );
  });
  it('rate limits recovery and does not replace a recent valid request', async () => {
    await recovery();
    await forgot(customer.email);
    expect(await EmailOutbox.countDocuments()).toBe(1);
    let last;
    for (let index = 0; index < 9; index++)
      last = await forgot('not-found@example.com');
    expect(last.status).toBe(429);
  });
  it('requires email for new registration without a verification gate or historic guest-order claim', async () => {
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .send({
            fullName: 'New user',
            phone: '08011112222',
            password: 'new_registration_password',
          })
      ).status
    ).toBe(400);
    const order = await orderFixture();
    await Order.updateOne(
      { _id: order._id },
      { 'customer.email': 'new-email-user@example.com' }
    );
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'New user',
        email: 'new-email-user@example.com',
        password: 'new_registration_password',
      });
    expect(response.status).toBe(201);
    const history = await request(app)
      .get('/api/orders/my-orders')
      .set('Authorization', 'Bearer ' + response.body.token);
    expect(history.body.data).toHaveLength(0);
    expect((await Order.findById(order._id)).user).toBeNull();
  });
  it('never falls back to simulated delivery when SMTP is disabled or incomplete', async () => {
    const job = await queued(),
      send = vi.fn();
    env.EMAIL_ENABLED = false;
    await processEmailJob(job._id, send);
    expect(send).not.toHaveBeenCalled();
    expect((await EmailOutbox.findById(job._id)).status).toBe('pending');
    expect(() => smtpTransport()).toThrow();
    env.EMAIL_ENABLED = true;
    env.SMTP_PASS = '';
    expect(emailConfiguration().configured).toBe(false);
    await processEmailJob(job._id, send);
    expect(send).not.toHaveBeenCalled();
  });
  it('marks SMTP acceptance once with a stable message ID and does not resend a completed job', async () => {
    const job = await queued(),
      send = vi.fn(async (message) => ({ accepted: [message.to] }));
    await Promise.all([
      processEmailJob(job._id, send),
      processEmailJob(job._id, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const current = await EmailOutbox.findById(job._id);
    expect(current.status).toBe('sent');
    expect(current.messageId).toMatch(/^<.+@/);
    expect(send.mock.calls[0][0].text).toContain('connection test');
  });
  it('retries a definite temporary SMTP rejection with backoff', async () => {
    const job = await queued(),
      error = Object.assign(new Error('Private provider detail'), {
        responseCode: 451,
        command: 'DATA',
      });
    const send = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementation(async (message) => ({ accepted: [message.to] }));
    await processEmailJob(job._id, send);
    let current = await EmailOutbox.findById(job._id);
    expect(current.status).toBe('pending');
    expect(current.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(current.lastError).not.toContain('Private provider');
    await EmailOutbox.updateOne(
      { _id: job._id },
      { nextAttemptAt: new Date(0) }
    );
    await processEmailJob(job._id, send);
    expect((await EmailOutbox.findById(job._id)).status).toBe('sent');
  });
  it('holds uncertain SMTP outcomes for review instead of blindly sending duplicates', async () => {
    const job = await queued(),
      send = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Lost acknowledgement'), {
            code: 'ETIMEDOUT',
            command: 'DATA',
          })
        );
    await processEmailJob(job._id, send);
    await processEmailJob(job._id, send);
    const current = await EmailOutbox.findById(job._id);
    expect(current.status).toBe('uncertain');
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await adminPost(`/${job._id}/retry`, {
          expectedUpdatedAt: current.updatedAt.toISOString(),
        })
      ).status
    ).toBe(400);
    expect(
      (
        await adminPost(`/${job._id}/accepted`, {
          expectedUpdatedAt: current.updatedAt.toISOString(),
          providerAccepted: true,
        })
      ).status
    ).toBe(200);
    expect((await EmailOutbox.findById(job._id)).status).toBe('sent');
  });
  it('does not retry an expired, replaced or already used password-reset email', async () => {
    const { job, token } = await recovery(),
      send = vi.fn();
    await reset(token);
    await processEmailJob(job._id, send);
    expect(send).not.toHaveBeenCalled();
    await EmailOutbox.updateOne({ _id: job._id }, { status: 'failed' });
    const current = await EmailOutbox.findById(job._id);
    expect(
      (
        await adminPost(`/${job._id}/retry`, {
          expectedUpdatedAt: current.updatedAt.toISOString(),
        })
      ).status
    ).toBe(409);
  });
  it('survives an interrupted sender without losing the unknown-outcome record', async () => {
    const job = await queued();
    await EmailOutbox.updateOne(
      { _id: job._id },
      {
        status: 'sending',
        leaseToken: 'crashed-worker',
        leaseUntil: new Date(0),
      }
    );
    env.EMAIL_ENABLED = false;
    const send = vi.fn();
    await processEmailOutbox(send);
    expect(send).not.toHaveBeenCalled();
    expect((await EmailOutbox.findById(job._id)).status).toBe('uncertain');
    expect(
      await EmailOutbox.countDocuments({
        group: 'technical',
        to: 'tech@example.com',
      })
    ).toBe(1);
  });
  it('stops at the configured hourly quota and does not send technical failure alerts to the owner', async () => {
    env.EMAIL_MAX_PER_HOUR = 1;
    await queued();
    await queued();
    const send = vi.fn(async (message) => ({ accepted: [message.to] }));
    await processEmailOutbox(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await EmailOutbox.countDocuments({ status: 'pending' })).toBe(1);
    await inTransaction((session) =>
      queueTechnical(
        'test-technical',
        'A test incident needs attention.',
        session
      )
    );
    const alerts = await EmailOutbox.find({ group: 'technical' });
    expect(alerts.map((job) => job.to)).toEqual(['tech@example.com']);
  });
  it('keeps recovery tokens, SMTP passwords and encrypted payloads out of admin APIs', async () => {
    const { token } = await recovery();
    expect((await request(app).get('/api/email')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/email')
          .set('Authorization', auth(customer))
      ).status
    ).toBe(403);
    const response = await adminGet('');
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain('payload');
    expect(response.text).not.toContain(env.SMTP_PASS);
    expect(response.text).not.toContain('resetTokenHash');
  });
  it('queues customer/private links and each operational recipient once in the business transaction', async () => {
    const order = await orderFixture(),
      access = 'a'.repeat(64);
    await inTransaction(async (session) => {
      const current = await Order.findById(order._id).session(session);
      await queueOrderCreated(current, access, session);
    });
    expect(await EmailOutbox.countDocuments()).toBe(3);
    const original = await EmailOutbox.findOne({ kind: 'order_placed' }).select(
      '+payload'
    );
    expect(openEmail(original.payload).orderUrl).toContain('access=' + access);
    expect(original.payload).not.toContain(access);
    await inTransaction(async (session) => {
      const current = await Order.findById(order._id).session(session);
      current.payment.status = 'paid';
      await current.save({ session });
      await queueOrderUpdate(current, 'paid', session);
      await queueOrderUpdate(current, 'paid', session);
    });
    expect(await EmailOutbox.countDocuments({ kind: 'operations_paid' })).toBe(
      2
    );
    expect(await EmailOutbox.countDocuments({ kind: 'customer_paid' })).toBe(1);
    const paid = await EmailOutbox.findOne({ kind: 'customer_paid' }).select(
      '+payload'
    );
    expect(openEmail(paid.payload).orderUrl).toContain(access);
  });
  it('rolls back queued messages with a failed transaction and snapshots verified collections without replay income', async () => {
    const order = await orderFixture();
    await expect(
      inTransaction(async (session) => {
        await enqueueEmail(
          {
            key: 'rolled-back',
            kind: 'smtp_test',
            group: 'customer',
            to: customer.email,
            data: {},
          },
          session
        );
        throw new Error('Injected business rollback');
      })
    ).rejects.toThrow();
    expect(await EmailOutbox.countDocuments()).toBe(0);
    for (const amount of [1120, 1120, 1200])
      await inTransaction(async (session) => {
        const current = await Order.findById(order._id).session(session);
        await recordVerifiedCollection(
          current,
          { amount, chargeId: 'ch-test' },
          session
        );
        await current.save({ session });
      });
    const rows = await PaymentCollection.find();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.amountKobo, 0)).toBe(120000);
  });
  it('escapes email content, provides plain text and rejects untrusted reset links', () => {
    const order = {
      customer: { name: '<script>bad</script>' },
      orderNumber: 'MCL-\r\nINJECT',
      orderItems: [],
      pricing: {
        subtotal: 1000,
        deliveryFee: 0,
        paymentFee: 120,
        totalAmount: 1120,
      },
    };
    const email = renderEmail('order_placed', {
      order,
      orderUrl: env.FRONTEND_URL + '/checkout/confirmation?order=test',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain('not proof of payment');
    expect(() =>
      renderEmail('password_reset', {
        resetUrl: 'https://attacker.example/reset',
      })
    ).toThrow();
    expect(() =>
      renderEmail('password_reset', { resetUrl: 'javascript:alert(1)' })
    ).toThrow();
  });
  it('sends fortnightly summaries only to the financial recipient and deduplicates concurrent schedules', async () => {
    const end = new Date(Date.now() - 1000);
    await NotificationState.create({
      _id: 'financial-summary',
      nextRunAt: end,
    });
    await Promise.all([scheduleFinancialSummary(), scheduleFinancialSummary()]);
    const jobs = await EmailOutbox.find({ kind: 'financial_summary' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].to).toBe('owner@example.com');
    expect(
      (
        await NotificationState.findById('financial-summary')
      ).nextRunAt.getTime() - end.getTime()
    ).toBe(14 * 86400000);
  });
  it('keeps opening debt and forgiveness separate from cash, and does not double-count receipt repayments', async () => {
    const order = await orderFixture(),
      now = new Date(),
      product = new mongoose.Types.ObjectId();
    await PaymentCollection.create({
      key: crypto.randomUUID(),
      order: order._id,
      amountKobo: 500000,
    });
    await PhysicalSale.create({
      customerName: 'Credit buyer',
      items: [
        {
          product,
          productType: 'retail',
          name: 'Shirt',
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
        },
      ],
      totalAmount: 1000,
      initialAmountPaid: 200,
      amountPaid: 500,
      balanceDue: 500,
      paymentType: 'credit_installment',
      recordedBy: admin._id,
    });
    const account = await CreditAccount.create({
      fullName: 'Credit buyer',
      phone: '08012345678',
      phoneKey: '+2348012345678',
      balanceKobo: 100000,
      unallocatedKobo: 100000,
      createdBy: admin._id,
    });
    for (const [index, [type, delta]] of [
      ['opening_balance', 200000],
      ['payment', -30000],
      ['write_off', -10000],
      ['balance_correction', 5000],
    ].entries())
      await CreditEntry.create({
        key: crypto.randomUUID(),
        account: account._id,
        sequence: index + 1,
        type,
        deltaKobo: delta,
        balanceBeforeKobo: 200000,
        balanceAfterKobo: 200000 + delta,
        recordedBy: admin._id,
        recordedByName: admin.fullName,
      });
    await OrderRefund.create({
      order: order._id,
      reference: crypto.randomUUID(),
      mode: 'manual',
      status: 'completed',
      amountKobo: 100000,
      reason: 'Recorded refund',
      createdBy: admin._id,
      completedAt: now,
    });
    const summary = await inTransaction((session) =>
      buildFinancialSummary(
        new Date(now.getTime() - 86400000),
        new Date(now.getTime() + 86400000),
        session
      )
    );
    expect(summary.metrics['Total recorded money received']).toBe(5500);
    expect(summary.metrics['Recorded cash less refunds']).toBe(4500);
    expect(summary.metrics['Opening debt added (not sales)']).toBe(2000);
    expect(summary.metrics['Debt forgiven (not cash)']).toBe(100);
    expect(summary.metrics['In-store sales value (includes credit)']).toBe(
      1000
    );
    expect(renderEmail('financial_summary', summary).text).toContain(
      'not profit'
    );
  });
  it('treats a database failure after SMTP acceptance as uncertain rather than sending again', async () => {
    const job = await queued(),
      realUpdate = EmailOutbox.updateOne.bind(EmailOutbox);
    vi.spyOn(EmailOutbox, 'updateOne').mockImplementation(
      (filter, update, ...rest) => {
        if (update?.$set?.status === 'sent')
          return Promise.reject(
            new Error('Injected acknowledgement persistence failure')
          );
        return realUpdate(filter, update, ...rest);
      }
    );
    const send = vi.fn(async (message) => ({ accepted: [message.to] }));
    await processEmailJob(job._id, send);
    await processEmailJob(job._id, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await EmailOutbox.findById(job._id)).status).toBe('uncertain');
  });
  it('replaces stale reset requests without sending an old valid-looking queued payload', async () => {
    const original = await recovery();
    await User.updateOne(
      { _id: customer._id },
      { resetRequestedAt: new Date(Date.now() - 120000) }
    );
    await forgot(customer.email);
    expect((await reset(original.token)).status).toBe(400);
    await EmailOutbox.updateOne(
      { _id: original.job._id },
      { status: 'pending' }
    );
    const send = vi.fn();
    await processEmailJob(original.job._id, send);
    expect(send).not.toHaveBeenCalled();
    expect((await EmailOutbox.findById(original.job._id)).status).toBe(
      'expired'
    );
  });
  it('fails safely on encrypted-payload corruption without leaking token contents', async () => {
    const job = await queued();
    await EmailOutbox.updateOne(
      { _id: job._id },
      { payload: 'not-valid-encrypted-content' }
    );
    const send = vi.fn();
    await processEmailJob(job._id, send);
    expect(send).not.toHaveBeenCalled();
    expect((await EmailOutbox.findById(job._id)).status).toBe('failed');
  });
  it('uses verified TLS on 465 and required STARTTLS on 587 without sending a message', () => {
    const transport = { close: vi.fn(), sendMail: vi.fn(), verify: vi.fn() },
      factory = vi
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue(transport);
    env.SMTP_PORT = 465;
    smtpTransport();
    expect(factory.mock.lastCall[0]).toMatchObject({
      secure: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });
    env.SMTP_PORT = 587;
    smtpTransport();
    expect(factory.mock.lastCall[0]).toMatchObject({
      secure: false,
      requireTLS: true,
    });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('sums cash metrics in integer kobo instead of exposing binary fractional totals', async () => {
    const order = await orderFixture();
    await PaymentCollection.create({
      key: crypto.randomUUID(),
      order: order._id,
      amountKobo: 10,
    });
    await PhysicalSale.create({
      customerName: 'Decimal fixture',
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          productType: 'retail',
          name: 'Decimal item',
          quantity: 1,
          unitPrice: 1,
          subtotal: 1,
        },
      ],
      totalAmount: 1,
      initialAmountPaid: 0.2,
      amountPaid: 0.2,
      balanceDue: 0.8,
      paymentType: 'credit_installment',
    });
    const summary = await inTransaction((session) =>
      buildFinancialSummary(
        new Date(Date.now() - 86400000),
        new Date(Date.now() + 86400000),
        session
      )
    );
    expect(summary.metrics['Total recorded money received']).toBe(0.3);
    expect(summary.metrics['Recorded cash less refunds']).toBe(0.3);
  });
});
