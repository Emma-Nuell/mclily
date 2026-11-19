import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import CreditAccount from '../models/CreditAccount.js';
import CreditEntry from '../models/CreditEntry.js';
import PhysicalSale from '../models/PhysicalSale.js';
import Product, { RetailProduct } from '../models/Product.js';
import InventoryMovement from '../models/InventoryMovement.js';
import IdempotencyLog from '../models/IdempotencyLog.js';
import User from '../models/User.js';
import { creditPhone } from '../utils/creditMoney.js';

let admin, customer, product;
const key = () => crypto.randomUUID();
const phone = '08012345678';
const auth = (user) =>
  'Bearer ' +
  jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
  });
const get = (url) =>
  request(app)
    .get('/api/customers' + url)
    .set('Authorization', auth(admin));
const create = (openingBalance = 0, overrides = {}, nonce = key()) =>
  request(app)
    .post('/api/customers')
    .set('Authorization', auth(admin))
    .send({
      fullName: 'Ama Obi',
      phone,
      openingBalance,
      idempotencyKey: nonce,
      ...overrides,
    });
const change = (id, kind, data = {}, nonce = key()) =>
  request(app)
    .post(`/api/customers/${id}/${kind}`)
    .set('Authorization', auth(admin))
    .send({ idempotencyKey: nonce, ...data });
const sale = (data = {}, nonce = key()) =>
  request(app)
    .post('/api/pos/sale')
    .set('Authorization', auth(admin))
    .send({
      customerName: 'Ama Obi',
      customerPhone: phone,
      paymentType: 'credit_installment',
      amountPaid: 0,
      items: [
        {
          productId: String(product._id),
          retailVariantId: String(product.sizes[0]._id),
          quantity: 1,
        },
      ],
      idempotencyKey: nonce,
      ...data,
    });

describe('Consolidated customer credit ledger on a real replica set', () => {
  beforeAll(async () => {
    await connectDatabase();
    for (const model of [
      CreditAccount,
      CreditEntry,
      PhysicalSale,
      Product,
      InventoryMovement,
      IdempotencyLog,
      User,
    ])
      await model.init();
    admin = await User.create({
      fullName: 'Credit test administrator',
      email: 'credit-test-admin@example.com',
      role: 'admin',
      password: 'isolated_password',
    });
    customer = await User.create({
      fullName: 'Credit test customer',
      email: 'credit-test-customer@example.com',
      role: 'customer',
      password: 'isolated_password',
    });
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const model of [
      CreditEntry,
      CreditAccount,
      PhysicalSale,
      Product,
      InventoryMovement,
      IdempotencyLog,
    ])
      await model.deleteMany({});
    product = await RetailProduct.create({
      name: 'Credit test shirt',
      slug: key(),
      category: 'Clothing',
      description: 'Isolated fixture',
      price: 1000,
      images: ['test.jpg'],
      sizes: [{ size: 'M', stock: 30 }],
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Accounting invariant: no balance can exist without matching receipts/opening debt and ledger entries.
    for (const account of await CreditAccount.find()) {
      const receipts = await PhysicalSale.find({ creditAccount: account._id });
      const receiptBalance = receipts.reduce(
        (sum, receipt) => sum + Math.round(receipt.balanceDue * 100),
        0
      );
      expect(account.balanceKobo).toBe(
        account.unallocatedKobo + receiptBalance
      );
      const entries = await CreditEntry.find({ account: account._id }).sort({
        sequence: 1,
      });
      expect(entries.reduce((sum, entry) => sum + entry.deltaKobo, 0)).toBe(
        account.balanceKobo
      );
      expect(entries.length).toBe(account.revision);
      entries.forEach((entry, index) => expect(entry.sequence).toBe(index + 1));
    }
  });
  afterAll(async () => {
    await User.deleteMany({
      _id: { $in: [admin?._id, customer?._id].filter(Boolean) },
    });
    await mongoose.disconnect();
  });

  it('requires administrator access and keeps debt separate from public accounts', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/customers')
          .set('Authorization', auth(customer))
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/customers')
          .set('Authorization', auth(customer))
          .send({})
      ).status
    ).toBe(403);
    expect((await get('/bad-id')).status).toBe(400);
  });
  it('creates opening debt without a sale, normalizes phones and replays creation exactly once', async () => {
    const nonce = key(),
      first = await create(8000, {}, nonce),
      replay = await create(8000, {}, nonce);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.account._id).toBe(first.body.data.account._id);
    expect(first.body.data.account.balance).toBe(8000);
    expect(await PhysicalSale.countDocuments()).toBe(0);
    expect(await CreditEntry.countDocuments({ type: 'opening_balance' })).toBe(
      1
    );
    const lookup = await get(
      '/lookup?phone=' + encodeURIComponent('+2348012345678')
    );
    expect(lookup.body.data.account._id).toBe(first.body.data.account._id);
    expect((await create(9000, { phone: '+2348012345678' })).status).toBe(409);
    expect(creditPhone('0801 234 5678').phoneKey).toBe('+2348012345678');
  });
  it('combines repeated credit purchases with the same canonical phone into one account', async () => {
    expect((await sale()).status).toBe(201);
    expect(
      (
        await sale({
          customerPhone: '+2348012345678',
          amountPaid: 500,
          items: [
            {
              productId: String(product._id),
              retailVariantId: String(product.sizes[0]._id),
              quantity: 2,
            },
          ],
        })
      ).status
    ).toBe(201);
    expect(await CreditAccount.countDocuments()).toBe(1);
    expect((await CreditAccount.findOne()).balanceKobo).toBe(250000);
    expect(await CreditEntry.countDocuments({ type: 'credit_sale' })).toBe(2);
  });
  it('calculates the shared opening/purchase/payment example and settles opening debt before receipts', async () => {
    const created = await create(8000),
      id = created.body.data.account._id;
    const bought = await sale({
      customerAccountId: id,
      items: [
        {
          productId: String(product._id),
          retailVariantId: String(product.sizes[0]._id),
          quantity: 4,
        },
      ],
    });
    expect(bought.status).toBe(201);
    const paid = await change(id, 'payment', {
      amount: 5000,
      paymentMethod: 'cash',
    });
    expect(paid.status).toBe(200);
    expect(paid.body.data.account.balance).toBe(7000);
    expect((await PhysicalSale.findById(bought.body.data._id)).amountPaid).toBe(
      0
    );
    await change(id, 'payment', { amount: 4000, paymentMethod: 'transfer' });
    const receipt = await PhysicalSale.findById(bought.body.data._id);
    expect(receipt.amountPaid).toBe(1000);
    expect(receipt.balanceDue).toBe(3000);
    expect((await get('/' + id)).body.data.balance).toBe(3000);
  });
  it('allocates customer payments to older receipts and preserves the existing receipt payment endpoint', async () => {
    const first = await sale(),
      second = await sale();
    const id = String((await CreditAccount.findOne())._id);
    await change(id, 'payment', { amount: 1200, paymentMethod: 'transfer' });
    expect((await PhysicalSale.findById(first.body.data._id)).balanceDue).toBe(
      0
    );
    expect((await PhysicalSale.findById(second.body.data._id)).balanceDue).toBe(
      800
    );
    const paid = await request(app)
      .post('/api/pos/sales/' + second.body.data._id + '/installment')
      .set('Authorization', auth(admin))
      .send({ amount: 800, paymentMethod: 'cash', idempotencyKey: key() });
    expect(paid.status).toBe(200);
    expect(paid.body.data.amountPaid).toBe(1000);
    expect((await get('/' + id)).body.data.balance).toBe(0);
  });
  it('never counts forgiven debt as money received or resurrects it on a later payment', async () => {
    const bought = await sale({ amountPaid: 200 });
    let account = await CreditAccount.findOne();
    const forgiven = await change(String(account._id), 'write-off', {
      amount: 300,
      reason: 'Owner forgave this amount',
      expectedRevision: account.revision,
    });
    expect(forgiven.status).toBe(200);
    let receipt = await PhysicalSale.findById(bought.body.data._id);
    expect(receipt.amountPaid).toBe(200);
    expect(receipt.amountForgiven).toBe(300);
    expect(receipt.balanceDue).toBe(500);
    const paid = await change(String(account._id), 'payment', {
      amount: 500,
      paymentMethod: 'cash',
    });
    expect(paid.status).toBe(200);
    receipt = await PhysicalSale.findById(receipt._id);
    expect(receipt.balanceDue).toBe(0);
    expect(receipt.amountPaid).toBe(700);
    expect(receipt.amountForgiven).toBe(300);
    expect(receipt.paymentType).toBe('credit_installment');
    expect(await CreditEntry.countDocuments({ type: 'write_off' })).toBe(1);
  });
  it('records reasoned balance corrections without fabricating payments or changing stock', async () => {
    const bought = await sale();
    let account = await CreditAccount.findOne();
    const beforeStock = (await Product.findById(product._id)).sizes[0].stock;
    const down = await change(String(account._id), 'correction', {
      newBalance: 600,
      reason: 'Corrected an old debt error',
      expectedRevision: account.revision,
    });
    expect(down.status).toBe(200);
    let receipt = await PhysicalSale.findById(bought.body.data._id);
    expect(receipt.amountPaid).toBe(0);
    expect(receipt.amountAdjusted).toBe(400);
    expect(receipt.balanceDue).toBe(600);
    account = await CreditAccount.findOne();
    const up = await change(String(account._id), 'correction', {
      newBalance: 900,
      reason: 'Added omitted opening debt',
      expectedRevision: account.revision,
    });
    expect(up.status).toBe(200);
    expect(up.body.data.account.balance).toBe(900);
    expect((await Product.findById(product._id)).sizes[0].stock).toBe(
      beforeStock
    );
    expect(await CreditEntry.countDocuments({ type: 'payment' })).toBe(0);
  });
  it('rejects stale corrections and distinguishes them from an idempotent retry', async () => {
    const created = await create(1000),
      account = created.body.data.account;
    await change(account._id, 'payment', { amount: 100 });
    expect(
      (
        await change(account._id, 'correction', {
          newBalance: 800,
          reason: 'Stock book correction',
          expectedRevision: account.revision,
        })
      ).status
    ).toBe(409);
    const current = (await get('/' + account._id)).body.data,
      nonce = key();
    const body = {
      newBalance: 800,
      reason: 'Corrected old record',
      expectedRevision: current.revision,
    };
    expect((await change(account._id, 'correction', body, nonce)).status).toBe(
      200
    );
    expect((await change(account._id, 'correction', body, nonce)).status).toBe(
      200
    );
    expect((await get('/' + account._id)).body.data.balance).toBe(800);
  });
  it('allows only one concurrent payment when together they exceed the balance', async () => {
    const id = (await create(1000)).body.data.account._id;
    const responses = await Promise.all([
      change(id, 'payment', { amount: 700 }),
      change(id, 'payment', { amount: 700 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get('/' + id)).body.data.balance).toBe(300);
    expect(await CreditEntry.countDocuments({ type: 'payment' })).toBe(1);
  });
  it('replays simultaneous identical payments without receiving money twice', async () => {
    const id = (await create(1000)).body.data.account._id,
      nonce = key();
    const responses = await Promise.all([
      change(id, 'payment', { amount: 400 }, nonce),
      change(id, 'payment', { amount: 400 }, nonce),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await get('/' + id)).body.data.balance).toBe(600);
    expect(await CreditEntry.countDocuments({ type: 'payment' })).toBe(1);
  });
  it('handles two first credit sales for one new customer without creating duplicate accounts', async () => {
    const responses = await Promise.all([sale(), sale()]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await CreditAccount.countDocuments()).toBe(1);
    expect((await CreditAccount.findOne()).balanceKobo).toBe(200000);
  });
  it('rolls back receipt, account and stock if credit history persistence fails', async () => {
    vi.spyOn(CreditEntry, 'create').mockRejectedValueOnce(
      new Error('Injected ledger failure')
    );
    expect((await sale()).status).toBe(500);
    expect(await PhysicalSale.countDocuments()).toBe(0);
    expect(await CreditAccount.countDocuments()).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect(await IdempotencyLog.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).sizes[0].stock).toBe(30);
  });
  it('rolls back receipt payments when their ledger entry cannot be saved', async () => {
    const bought = await sale(),
      account = await CreditAccount.findOne();
    vi.spyOn(CreditEntry, 'create').mockRejectedValueOnce(
      new Error('Injected payment history failure')
    );
    expect(
      (await change(String(account._id), 'payment', { amount: 400 })).status
    ).toBe(500);
    expect((await CreditAccount.findById(account._id)).balanceKobo).toBe(
      100000
    );
    expect((await PhysicalSale.findById(bought.body.data._id)).amountPaid).toBe(
      0
    );
  });
  it('uses exact kobo arithmetic for small decimal purchases and repayments', async () => {
    await RetailProduct.updateOne(
      { _id: product._id },
      { $set: { price: 0.1 } }
    );
    expect(
      (
        await sale({
          items: [
            {
              productId: String(product._id),
              retailVariantId: String(product.sizes[0]._id),
              quantity: 3,
            },
          ],
        })
      ).status
    ).toBe(201);
    const account = await CreditAccount.findOne();
    await change(String(account._id), 'payment', { amount: 0.1 });
    await change(String(account._id), 'payment', { amount: 0.2 });
    expect((await CreditAccount.findById(account._id)).balanceKobo).toBe(0);
  });
  it('rejects zero/negative/overpayments, missing correction reasons and identity mix-ups', async () => {
    const account = (await create(1000)).body.data.account;
    expect((await change(account._id, 'payment', { amount: 0 })).status).toBe(
      400
    );
    expect((await change(account._id, 'payment', { amount: -1 })).status).toBe(
      400
    );
    expect(
      (await change(account._id, 'payment', { amount: 1001 })).status
    ).toBe(409);
    expect(
      (
        await change(account._id, 'correction', {
          newBalance: 1,
          expectedRevision: account.revision,
        })
      ).status
    ).toBe(400);
    expect((await sale({ customerName: 'Different person' })).status).toBe(409);
    expect(
      (
        await sale({
          customerName: 'Selected existing account',
          customerAccountId: account._id,
        })
      ).status
    ).toBe(201);
    expect((await create(0, { phone: '123' })).status).toBe(400);
  });
  it('brings forward only an old receipt balance and preserves prior payment history', async () => {
    const old = await PhysicalSale.create({
      customerName: 'Ama Obi',
      customerPhone: phone,
      items: [
        {
          product: product._id,
          productType: 'retail',
          name: product.name,
          unitPrice: 1000,
          quantity: 1,
          subtotal: 1000,
        },
      ],
      totalAmount: 1000,
      amountPaid: 600,
      balanceDue: 400,
      paymentType: 'credit_installment',
      recordedBy: admin._id,
      installmentHistory: [{ amount: 600, receivedBy: admin.fullName }],
    });
    const paid = await request(app)
      .post('/api/pos/sales/' + old._id + '/installment')
      .set('Authorization', auth(admin))
      .send({ amount: 100, idempotencyKey: key() });
    expect(paid.status).toBe(200);
    expect(paid.body.data.amountPaid).toBe(700);
    expect(paid.body.data.installmentHistory).toHaveLength(2);
    expect((await CreditAccount.findOne()).balanceKobo).toBe(30000);
    expect(await CreditEntry.countDocuments({ type: 'legacy_balance' })).toBe(
      1
    );
  });
  it('provides ordered, private, paginated history and literal customer search', async () => {
    const account = (await create(1000, { fullName: 'Ama [School]' })).body.data
      .account;
    await change(account._id, 'payment', { amount: 100 });
    const rows = await get('/' + account._id + '/entries?limit=1&page=1');
    expect(rows.body.total).toBe(2);
    expect(rows.body.pages).toBe(2);
    expect(rows.body.data[0].type).toBe('payment');
    expect(rows.body.data[0].recordedByName).toBe(admin.fullName);
    expect(rows.text).not.toContain(admin.email);
    expect((await get('?search=%5B&status=owing')).body.total).toBe(1);
    expect((await get('?status=cleared')).body.total).toBe(0);
    expect(
      (
        await request(app)
          .delete('/api/customers/' + account._id)
          .set('Authorization', auth(admin))
      ).status
    ).toBe(404);
  });
});
