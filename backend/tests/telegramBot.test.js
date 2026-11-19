import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
vi.mock('../services/cloudinaryService.js', () => ({
  uploadImageBuffer: vi.fn(),
}));
import app from '../server.js';
import connectDatabase from '../config/database.js';
import env from '../config/env.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import InventoryMovement from '../models/InventoryMovement.js';
import EmailOutbox from '../models/EmailOutbox.js';
import {
  TelegramUpdate,
  TelegramDraft,
  TelegramReply,
  TelegramCursor,
  AIUsage,
  AIInvocation,
  telegramModels,
} from '../models/Telegram.js';
import bot from '../services/telegramBotService.js';
import { pollTelegramOnce } from '../services/telegramPollingService.js';
import { inTransaction } from '../services/transactionService.js';
import {
  parseProductDraft,
  transcribeProductVoice,
  geminiProvider,
} from '../services/geminiService.js';
import {
  parseStatedFacts,
  validateDraft,
} from '../services/productDraftService.js';
import { sealTelegram, openTelegram } from '../utils/telegramPayload.js';
import { uploadImageBuffer } from '../services/cloudinaryService.js';

const token = '123456:abcdefghijklmnopqrstuvwxyz_12345',
  secret = 's'.repeat(64);
const fields =
  'Name: TG Shirt\nType: retail\nCategory: Men\nPrice: 15k\nVariants: M / Navy / 2; L / Navy / 0';
let admin,
  second,
  number = 100;
const original = { ...env };
function message(text, id = 111111, extra = {}) {
  return {
    update_id: number++,
    message: {
      message_id: number,
      from: { id },
      chat: { id, type: 'private' },
      text,
      ...extra,
    },
  };
}
function callback(data, id = 111111) {
  return {
    update_id: number++,
    callback_query: {
      id: `query_${number}`,
      from: { id },
      data,
      message: { message_id: number, chat: { id, type: 'private' } },
    },
  };
}
const webhook = (update) =>
  request(app)
    .post('/api/telegram/webhook')
    .set('x-telegram-bot-api-secret-token', secret)
    .send(update);
async function run(update) {
  await bot.handleUpdate(update);
  await bot.processUpdates();
}
async function draft(overrides = {}) {
  return TelegramDraft.create({
    bot: '123456',
    user: admin._id,
    chat: '111111',
    facts: parseStatedFacts(fields).facts,
    images: ['https://example.com/real-test-photo.jpg'],
    expiresAt: new Date(Date.now() + 7200000),
    ...overrides,
  });
}
async function lastReply() {
  const job = await TelegramReply.findOne()
    .sort({ createdAt: -1, _id: -1 })
    .select('+payload');
  return openTelegram(job.payload);
}
function enableAI(overrides = {}) {
  Object.assign(env, {
    AI_ENABLED: true,
    GEMINI_API_KEY: 'isolated-fake-key',
    GEMINI_MODEL: 'configured-test-audio-model',
    AI_MONTHLY_REQUEST_LIMIT: 5,
    AI_MONTHLY_BUDGET_NAIRA: 100,
    AI_REQUEST_RESERVE_NAIRA: 20,
    ...overrides,
  });
}
const voiceRequest = (key) => ({
  key,
  buffer: Buffer.from('fixture audio'),
  mimeType: 'audio/ogg',
});

describe('Telegram durable drafts, authorization and bounded AI', () => {
  beforeAll(async () => {
    await connectDatabase();
  });
  beforeEach(async () => {
    Object.assign(env, original, {
      TELEGRAM_ENABLED: true,
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_SECRET_TOKEN: secret,
      TELEGRAM_OWNER_ID: undefined,
      AI_ENABLED: false,
    });
    for (const model of [...telegramModels, EmailOutbox])
      await model.deleteMany({});
    await Product.deleteMany({ name: /^TG / });
    await InventoryMovement.deleteMany({ source: /^telegram:/ });
    await Order.deleteMany({ orderNumber: /^TG-/ });
    await User.deleteMany({
      email: {
        $in: [
          'tg-owner@example.com',
          'tg-tech@example.com',
          'tg-customer@example.com',
        ],
      },
    });
    admin = await User.create({
      fullName: 'TG owner',
      email: 'tg-owner@example.com',
      password: 'isolated_tg_password',
      role: 'admin',
      telegramId: '111111',
    });
    second = await User.create({
      fullName: 'TG tech',
      email: 'tg-tech@example.com',
      password: 'isolated_tg_password',
      role: 'superadmin',
      telegramId: '222222',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Unexpected external request'))
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.assign(env, original);
  });
  afterAll(async () => {
    for (const model of telegramModels) await model.deleteMany({});
    await Product.deleteMany({ name: /^TG / });
    await InventoryMovement.deleteMany({ source: /^telegram:/ });
    await Order.deleteMany({ orderNumber: /^TG-/ });
    await EmailOutbox.deleteMany({
      key: /telegram-review:|ai-limit:|ai-allowance:/,
    });
    await User.deleteMany({ email: /^tg-.*@example.com$/ });
    await mongoose.disconnect();
  });

  it('fails closed without an explicitly mapped active full admin, regardless of legacy owner ID', async () => {
    env.TELEGRAM_OWNER_ID = '333333';
    expect(await bot.isAuthorized('333333')).toBe(false);
    await User.create({
      fullName: 'TG customer',
      email: 'tg-customer@example.com',
      password: 'isolated_password',
      role: 'customer',
      telegramId: '333333',
    });
    expect(await bot.isAuthorized('333333')).toBe(false);
    expect(await bot.isAuthorized('111111')).toBe(true);
    expect(await bot.isAuthorized('222222')).toBe(true);
  });
  it('does not allow one Telegram ID to bind two accounts', async () => {
    await expect(
      User.updateOne({ _id: second._id }, { $set: { telegramId: '111111' } })
    ).rejects.toMatchObject({ code: 11000 });
  });
  it('requires an enabled bot and mandatory sufficiently strong webhook secret', async () => {
    env.TELEGRAM_ENABLED = false;
    expect((await webhook(message('/help'))).status).toBe(503);
    env.TELEGRAM_ENABLED = true;
    env.TELEGRAM_SECRET_TOKEN = '';
    expect((await webhook(message('/help'))).status).toBe(503);
    env.TELEGRAM_SECRET_TOKEN = secret;
    expect(
      (await request(app).post('/api/telegram/webhook').send(message('/help')))
        .status
    ).toBe(403);
    expect(await TelegramUpdate.countDocuments()).toBe(0);
  });
  it('acknowledges only after encrypted durable intake, with no provider call', async () => {
    const update = message(fields);
    expect((await webhook(update)).status).toBe(200);
    const job = await TelegramUpdate.findOne().select('+payload');
    expect(job.status).toBe('pending');
    expect(job.payload).not.toContain('TG Shirt');
    expect(openTelegram(job.payload)).toEqual(update);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not acknowledge a failed intake write', async () => {
    vi.spyOn(TelegramUpdate, 'create').mockRejectedValueOnce(
      new Error('isolated write failed')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await webhook(message('/help'))).status).toBe(500);
  });
  it('deduplicates redelivery and rejects a conflicting update payload', async () => {
    const update = message('/help');
    expect((await webhook(update)).status).toBe(200);
    expect((await webhook(update)).status).toBe(200);
    expect(await TelegramUpdate.countDocuments()).toBe(1);
    expect(
      (
        await webhook({
          ...update,
          message: { ...update.message, text: '/new' },
        })
      ).status
    ).toBe(409);
  });
  it('ignores unauthorized callbacks, group chats and another user’s private-chat identity', async () => {
    const forged = callback('save:anything', 999999);
    expect((await webhook(forged)).body.ignored).toBe(true);
    const group = message(fields);
    group.message.chat.type = 'group';
    expect((await webhook(group)).body.ignored).toBe(true);
    const mismatch = callback('save:anything');
    mismatch.callback_query.message.chat.id = 222222;
    expect((await webhook(mismatch)).body.ignored).toBe(true);
    expect(await TelegramUpdate.countDocuments()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks access after intake, before any download or business write', async () => {
    await bot.handleUpdate(
      message(fields, 111111, { photo: [{ file_id: 'photo' }] })
    );
    await User.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    await bot.processUpdates();
    expect((await TelegramUpdate.findOne()).status).toBe('discarded');
    expect(await TelegramDraft.countDocuments()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never fabricates price, stock, variants, material or marketing claims', async () => {
    const result = await parseProductDraft({ text: 'A lovely new shirt' });
    expect(result).toEqual({ name: 'A lovely new shirt' });
    const ambiguous = await parseProductDraft({
      text: 'TG blazer, 45000 naira, 8 pieces in size M and L',
    });
    expect(ambiguous.price).toBe(45000);
    expect(ambiguous.variants).toBeUndefined();
    expect(validateDraft(ambiguous)).toContain('a product photo');
  });
  it('parses explicit independent zero balances and half-yard rolls without distributing totals', () => {
    const retail = parseStatedFacts(fields).facts;
    expect(retail.price).toBe(15000);
    expect(retail.variants.map((v) => v.stock)).toEqual([2, 0]);
    const fabric = parseStatedFacts(
      'Name: TG Linen\nType: fabric\nCategory: Fabrics\nPrice: 14000\nMaterial: Linen\nRolls: Indigo / 12.5; White / 0'
    ).facts;
    expect(fabric.rolls.map((v) => v.halfYards)).toEqual([25, 0]);
    expect(
      parseStatedFacts('Rolls: Indigo / 1.2').errors.length
    ).toBeGreaterThan(0);
    expect(
      parseStatedFacts('Variants: M / Navy / 1.5').errors.length
    ).toBeGreaterThan(0);
  });
  it('asks for actual product photos and missing facts, without placeholder images', async () => {
    await run(message(fields));
    const saved = await TelegramDraft.findOne();
    expect(saved.images).toEqual([]);
    const reply = await lastReply();
    expect(reply.text).toContain('a product photo');
    expect(
      reply.reply_markup.inline_keyboard
        .flat()
        .some((v) => v.text === 'Save product')
    ).toBe(false);
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(0);
  });
  it('resumes persistent drafts and applies corrections while invalid corrections clear older facts', async () => {
    await run(message(fields));
    await run(message('Price: invalid'));
    expect((await TelegramDraft.findOne()).facts.price).toBeUndefined();
    await run(message('Price: 20000'));
    await run(message('/draft'));
    expect((await lastReply()).text).toContain('₦20,000');
    expect(await TelegramDraft.countDocuments()).toBe(1);
  });
  it('uploads only the real supplied photo, outside the business transaction', async () => {
    vi.spyOn(bot, 'downloadTelegramFile').mockResolvedValue(
      Buffer.from([0xff, 0xd8, 0xff, 1])
    );
    vi.mocked(uploadImageBuffer).mockResolvedValue({
      secureUrl: 'https://example.com/uploaded.jpg',
    });
    await run(
      message(fields, 111111, { photo: [{ file_id: 'actual-photo' }] })
    );
    expect((await TelegramDraft.findOne()).images).toEqual([
      'https://example.com/uploaded.jpg',
    ]);
    expect(uploadImageBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      'mclily/telegram',
      { publicId: expect.stringMatching(/^bot-123456-update-/) }
    );
  });
  it('saves exact stock and opening audits atomically, including zero', async () => {
    const d = await draft();
    await run(callback(`save:${d._id}:1`));
    const product = await Product.findOne({ name: 'TG Shirt' });
    expect(product.sizes.map((v) => v.stock)).toEqual([2, 0]);
    expect(product.isFeatured).toBe(false);
    expect(product.description).toBe('TG Shirt');
    expect(
      await InventoryMovement.countDocuments({ product: product._id })
    ).toBe(2);
    expect((await TelegramDraft.findById(d._id)).status).toBe('saved');
    expect((await lastReply()).text).toContain('preview mode');
  });
  it('deduplicates concurrent distinct approvals and webhook redelivery even before a reply is sent', async () => {
    const d = await draft(),
      update = callback(`save:${d._id}:1`);
    await Promise.all([
      bot.handleUpdate(update),
      bot.handleUpdate(update),
      bot.handleUpdate(callback(`save:${d._id}:1`)),
    ]);
    await Promise.all([bot.processUpdates(), bot.processUpdates()]);
    await bot.processUpdates();
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(1);
    expect(
      await InventoryMovement.countDocuments({ source: `telegram:${d._id}` })
    ).toBe(2);
    expect(await TelegramUpdate.countDocuments({ status: 'completed' })).toBe(
      2
    );
  });
  it('rolls back product, audit, draft and completion together when a related write fails', async () => {
    const d = await draft();
    vi.spyOn(InventoryMovement, 'create').mockRejectedValueOnce(
      new Error('isolated audit failure')
    );
    await run(callback(`save:${d._id}:1`));
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(0);
    expect((await TelegramDraft.findById(d._id)).status).toBe('active');
    expect((await TelegramUpdate.findOne()).status).toBe('review');
  });
  it('blocks another admin’s draft, stale buttons and expired drafts', async () => {
    const d = await draft();
    await run(callback(`save:${d._id}:1`, 222222));
    expect((await lastReply()).text).toContain('unavailable for your account');
    await run(callback(`save:${d._id}:0`));
    expect((await lastReply()).text).toContain('older version');
    await TelegramDraft.updateOne(
      { _id: d._id },
      { $set: { expiresAt: new Date(0) } }
    );
    await run(callback(`save:${d._id}:1`));
    expect((await lastReply()).text).toContain('expired');
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(0);
  });
  it('cancels the actual active draft and rejects its old save button', async () => {
    const d = await draft();
    await run(message('/cancel'));
    await run(callback(`save:${d._id}:1`));
    expect((await TelegramDraft.findById(d._id)).status).toBe('cancelled');
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(0);
  });
  it('persists fabric colour balances as integer half-yards with no default material or yardage', async () => {
    const facts = parseStatedFacts(
      'Name: TG Linen\nType: fabric\nCategory: Fabrics\nPrice: 14000\nMaterial: Linen\nRolls: Indigo / 12.5; White / 0'
    ).facts;
    const d = await draft({ facts });
    await run(callback(`save:${d._id}:1`));
    const product = await Product.findOne({ name: 'TG Linen' });
    expect(product.colorVariants.map((v) => v.rollStockHalfYards)).toEqual([
      25, 0,
    ]);
    expect(product.pricePerYard).toBe(14000);
  });
  it('holds interrupted work for review instead of replaying an upload or AI charge', async () => {
    await bot.handleUpdate(message(fields));
    await TelegramUpdate.updateOne(
      {},
      { $set: { status: 'processing', lease: 'lost', leaseUntil: new Date(0) } }
    );
    const prepare = vi.spyOn(bot, 'prepare');
    await bot.processUpdates();
    expect((await TelegramUpdate.findOne()).status).toBe('review');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('holds ambiguous outgoing acceptance and never republishes or blindly resends', async () => {
    const d = await draft();
    await run(callback(`save:${d._id}:1`));
    const api = vi
      .spyOn(bot, 'callApi')
      .mockRejectedValue(new Error('network lost'));
    await bot.processReplies();
    await bot.processReplies();
    expect(api.mock.calls.filter((v) => v[0] === 'sendMessage')).toHaveLength(
      1
    );
    expect((await TelegramReply.findOne()).status).toBe('uncertain');
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(1);
  });
  it('cancels outgoing replies if the account loses access', async () => {
    await run(message('/help'));
    await User.updateOne({ _id: admin._id }, { $unset: { telegramId: 1 } });
    await bot.processReplies();
    expect((await TelegramReply.findOne()).status).toBe('cancelled');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses plain text for untrusted names rather than interpreting Telegram HTML', async () => {
    const d = await draft({
      facts: { ...parseStatedFacts(fields).facts, name: 'TG <b>unsafe</b>' },
    });
    await run(callback(`save:${d._id}:1`));
    const api = vi.spyOn(bot, 'callApi').mockResolvedValue({ ok: true });
    await bot.processReplies();
    const sent = api.mock.calls.find((v) => v[0] === 'sendMessage')[1];
    expect(sent.parse_mode).toBeUndefined();
    expect(sent.text).toContain('<b>unsafe</b>');
  });
  it('checks download paths, metadata size and actual streamed size', async () => {
    const api = vi.spyOn(bot, 'callApi');
    api.mockResolvedValueOnce({ result: { file_path: '../secret.jpg' } });
    await expect(bot.downloadTelegramFile('photo')).rejects.toThrow(
      'FILE_INVALID'
    );
    expect(fetch).not.toHaveBeenCalled();
    api.mockResolvedValueOnce({
      result: { file_path: 'photos/file.jpg', file_size: 100 },
    });
    await expect(bot.downloadTelegramFile('photo', 10)).rejects.toThrow(
      'FILE_INVALID'
    );
    api.mockResolvedValueOnce({ result: { file_path: 'photos/file.jpg' } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(20)));
    await expect(bot.downloadTelegramFile('photo', 10)).rejects.toThrow(
      'DOWNLOAD_FAILED'
    );
  });
  it('does not expose token-bearing fetch errors or treat an ambiguous response as success', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error(`https://api.telegram.org/bot${token}/sendMessage`)
    );
    await expect(bot.callApi('sendMessage', {})).rejects.toThrow(
      'TELEGRAM_OUTCOME_UNCERTAIN'
    );
  });
  it('explains voice unavailability honestly and never calls AI with disabled or zero limits', async () => {
    const provider = vi.spyOn(geminiProvider, 'transcribe');
    await run(
      message('', 111111, { voice: { file_id: 'voice', duration: 10 } })
    );
    expect((await lastReply()).text).toContain('Voice assistance is off');
    enableAI({ AI_MONTHLY_REQUEST_LIMIT: 0 });
    await expect(
      transcribeProductVoice(voiceRequest('disabled'))
    ).rejects.toThrow('AI_NOT_CONFIGURED');
    expect(provider).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation of voice-derived details before saving', async () => {
    const d = await draft({ needsConfirmation: true });
    await run(callback(`save:${d._id}:1`));
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(0);
    await run(callback(`confirm:${d._id}:1`));
    expect((await TelegramDraft.findById(d._id)).needsConfirmation).toBe(false);
    await run(callback(`save:${d._id}:2`));
    expect(await Product.countDocuments({ name: 'TG Shirt' })).toBe(1);
  });
  it('validates AI output, records token counts and reuses a durable result without a second charge', async () => {
    enableAI();
    const provider = vi.spyOn(geminiProvider, 'transcribe').mockResolvedValue({
      text: JSON.stringify({ transcript: fields }),
      usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 25 },
    });
    expect(
      (await transcribeProductVoice(voiceRequest('voice-1'))).transcript
    ).toBe(fields);
    expect(
      (await transcribeProductVoice(voiceRequest('voice-1'))).transcript
    ).toBe(fields);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await AIInvocation.findOne()).inputTokens).toBe(42);
    expect((await AIUsage.findOne()).reservedKobo).toBe(2000);
  });
  it('processes an actual bounded voice input into a persistent draft requiring review', async () => {
    enableAI();
    const d = await draft();
    vi.spyOn(bot, 'downloadTelegramFile').mockResolvedValue(
      Buffer.from('fixture audio')
    );
    const provider = vi.spyOn(geminiProvider, 'transcribe').mockResolvedValue({
      text: JSON.stringify({ transcript: 'Price: 16000' }),
    });
    await run(
      message('', 111111, {
        voice: { file_id: 'voice', duration: 12, mime_type: 'audio/ogg' },
      })
    );
    const updated = await TelegramDraft.findById(d._id);
    expect(updated.facts.price).toBe(16000);
    expect(updated.needsConfirmation).toBe(true);
    expect((await lastReply()).text).toContain(
      'Voice transcript (check carefully)'
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized or unsupported voice inputs before a provider request', async () => {
    enableAI();
    const provider = vi.spyOn(geminiProvider, 'transcribe');
    await run(
      message('', 111111, { voice: { file_id: 'voice', duration: 61 } })
    );
    expect((await lastReply()).text).toContain('under one minute');
    await expect(
      transcribeProductVoice({
        ...voiceRequest('wrong-type'),
        mimeType: 'text/html',
      })
    ).rejects.toThrow('AI_INPUT_INVALID');
    expect(provider).not.toHaveBeenCalled();
    expect(await AIInvocation.countDocuments()).toBe(0);
  });
  it('stops at the monetary allowance independently of the request ceiling and resets by UTC month', async () => {
    enableAI({ AI_MONTHLY_BUDGET_NAIRA: 20, AI_MONTHLY_REQUEST_LIMIT: 100 });
    const provider = vi
      .spyOn(geminiProvider, 'transcribe')
      .mockResolvedValue({ text: '{"transcript":"TG Shirt"}' });
    await transcribeProductVoice({
      ...voiceRequest('month-a'),
      now: new Date('2026-11-01T00:00:00Z'),
    });
    await expect(
      transcribeProductVoice({
        ...voiceRequest('month-b'),
        now: new Date('2026-11-30T23:59:00Z'),
      })
    ).rejects.toThrow('AI_ALLOWANCE_REACHED');
    await transcribeProductVoice({
      ...voiceRequest('month-c'),
      now: new Date('2026-12-01T00:00:00Z'),
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await AIUsage.countDocuments()).toBe(2);
  });
  it('holds a timed-out AI request without releasing its possible charge', async () => {
    enableAI();
    const provider = vi
      .spyOn(geminiProvider, 'transcribe')
      .mockRejectedValue(new Error('timeout'));
    await expect(
      transcribeProductVoice(voiceRequest('timeout'))
    ).rejects.toThrow('AI_OUTCOME_UNCERTAIN');
    await expect(
      transcribeProductVoice(voiceRequest('timeout'))
    ).rejects.toThrow('AI_PREVIOUS_OUTCOME_UNCERTAIN');
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await AIInvocation.findOne()).status).toBe('uncertain');
    expect((await AIUsage.findOne()).requests).toBe(1);
  });
  it('enforces the allowance under concurrent calls and emits one technical stop notification', async () => {
    enableAI({
      AI_MONTHLY_REQUEST_LIMIT: 1,
      EMAIL_TECHNICAL_TO: 'tg-tech@example.com',
    });
    const provider = vi
      .spyOn(geminiProvider, 'transcribe')
      .mockResolvedValue({ text: '{"transcript":"TG Shirt"}' });
    const results = await Promise.allSettled([
      transcribeProductVoice(voiceRequest('a')),
      transcribeProductVoice(voiceRequest('b')),
    ]);
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    await expect(transcribeProductVoice(voiceRequest('c'))).rejects.toThrow(
      'AI_ALLOWANCE_REACHED'
    );
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await AIUsage.findOne()).requests).toBe(1);
    expect(await EmailOutbox.countDocuments({ key: /ai-limit/ })).toBe(1);
  });
  it('retains reservations on invalid output or timeouts and never retries uncertain AI calls', async () => {
    enableAI();
    const provider = vi
      .spyOn(geminiProvider, 'transcribe')
      .mockResolvedValue({ text: '{"transcript":"TG Shirt","stock":999}' });
    await expect(
      transcribeProductVoice(voiceRequest('invalid'))
    ).rejects.toThrow('AI_OUTCOME_UNCERTAIN');
    await expect(
      transcribeProductVoice(voiceRequest('invalid'))
    ).rejects.toThrow('AI_PREVIOUS_OUTCOME_UNCERTAIN');
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await AIUsage.findOne()).reservedKobo).toBe(2000);
  });
  it('guards Telegram dispatch with verified payment, stock commitment and authorized callbacks', async () => {
    const order = await Order.create({
      orderNumber: `TG-${number++}`,
      customer: {
        name: 'TG Customer',
        email: 'tg-order@example.com',
        phone: '08000000000',
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
          name: 'TG Shirt',
          unitPrice: 100,
          quantity: 1,
          subtotal: 100,
        },
      ],
      pricing: {
        subtotal: 100,
        deliveryFee: 0,
        baseAmount: 100,
        paymentFee: 0,
        totalAmount: 100,
      },
      payment: {
        gateway: 'bachs',
        reference: `tg-ref-${number++}`,
        status: 'pending',
      },
      inventory: { status: 'consumed' },
      fulfillment: { status: 'processing' },
    });
    await run(callback(`order_status_${order._id}_shipped`));
    expect((await Order.findById(order._id)).fulfillment.status).toBe(
      'processing'
    );
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.status': 'paid' } }
    );
    await run(callback(`order_status_${order._id}_shipped`));
    await run(callback(`order_status_${order._id}_shipped`));
    const updated = await Order.findById(order._id);
    expect(updated.fulfillment.status).toBe('shipped');
    expect(
      updated.fulfillment.timeline.filter((v) => v.status === 'shipped')
    ).toHaveLength(1);
  });
  it('queues paid-order intents once per bound admin within the payment transaction, with full rollback', async () => {
    const order = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'TG-PAID',
    };
    await expect(
      inTransaction(async (session) => {
        await bot.sendOrderNotification(order, { session });
        throw new Error('isolated payment rollback');
      })
    ).rejects.toThrow('isolated payment rollback');
    expect(await TelegramReply.countDocuments()).toBe(0);
    await inTransaction(async (session) => {
      await bot.sendOrderNotification(order, { session });
    });
    await inTransaction(async (session) => {
      await bot.sendOrderNotification(order, { session });
    });
    expect(await TelegramReply.countDocuments()).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('polling persists updates before advancing its durable offset and produces a normal authorized reply', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    const update = message('/start');
    const api = vi
      .spyOn(bot, 'callApi')
      .mockImplementation(async (method) =>
        method === 'getWebhookInfo'
          ? { ok: true, result: { url: '' } }
          : { ok: true, result: [update] }
      );
    await pollTelegramOnce();
    expect(await TelegramUpdate.countDocuments()).toBe(1);
    expect((await TelegramCursor.findOne()).offset).toBe(update.update_id + 1);
    await bot.processUpdates();
    expect((await lastReply()).text).toContain('Send a photo');
    expect(api.mock.calls.find((v) => v[0] === 'getUpdates')[1].offset).toBe(0);
    expect((await webhook(message('/help'))).status).toBe(503);
  });
  it('does not advance polling acknowledgement past a failed durable write', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    const update = message('/start');
    vi.spyOn(bot, 'callApi').mockImplementation(async (method) =>
      method === 'getWebhookInfo'
        ? { result: { url: '' } }
        : { result: [update] }
    );
    vi.spyOn(TelegramUpdate, 'create').mockRejectedValueOnce(
      new Error('isolated intake failure')
    );
    await expect(pollTelegramOnce()).rejects.toThrow('isolated intake failure');
    expect((await TelegramCursor.findOne()).offset).toBe(0);
    expect(await TelegramUpdate.countDocuments()).toBe(0);
    await pollTelegramOnce();
    expect((await TelegramCursor.findOne()).offset).toBe(update.update_id + 1);
    expect(await TelegramUpdate.countDocuments()).toBe(1);
  });
  it('deduplicates polling redelivery after intake succeeded but offset persistence failed', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    const update = message('/start');
    vi.spyOn(bot, 'callApi').mockImplementation(async (method) =>
      method === 'getWebhookInfo'
        ? { result: { url: '' } }
        : { result: [update] }
    );
    const write = TelegramCursor.updateOne.bind(TelegramCursor);
    let failed = false;
    vi.spyOn(TelegramCursor, 'updateOne').mockImplementation(
      (filter, change, options) => {
        if (!failed && change.$set?.offset !== undefined) {
          failed = true;
          throw new Error('isolated offset failure');
        }
        return write(filter, change, options);
      }
    );
    await expect(pollTelegramOnce()).rejects.toThrow('isolated offset failure');
    expect(await TelegramUpdate.countDocuments()).toBe(1);
    expect((await TelegramCursor.findOne()).offset).toBe(0);
    await pollTelegramOnce();
    expect(await TelegramUpdate.countDocuments()).toBe(1);
    expect((await TelegramCursor.findOne()).offset).toBe(update.update_id + 1);
  });
  it('refuses to poll over an existing webhook without removing it or dropping pending updates', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    const api = vi
      .spyOn(bot, 'callApi')
      .mockResolvedValue({
        result: { url: 'https://existing.example/api/telegram/webhook' },
      });
    await expect(pollTelegramOnce()).rejects.toThrow('TELEGRAM_WEBHOOK_ACTIVE');
    expect(api.mock.calls.map((v) => v[0])).toEqual(['getWebhookInfo']);
    expect((await TelegramCursor.findOne()).offset).toBe(0);
  });
  it('honours another poller’s lease and can recover an expired lease', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    await TelegramCursor.create({
      bot: '123456',
      offset: 99,
      lease: 'another-process',
      leaseUntil: new Date(Date.now() + 60000),
    });
    const api = vi
      .spyOn(bot, 'callApi')
      .mockImplementation(async (method) =>
        method === 'getWebhookInfo' ? { result: { url: '' } } : { result: [] }
      );
    await pollTelegramOnce();
    expect(api).not.toHaveBeenCalled();
    await TelegramCursor.updateOne({}, { $set: { leaseUntil: new Date(0) } });
    await pollTelegramOnce();
    expect(api.mock.calls.find((v) => v[0] === 'getUpdates')[1].offset).toBe(
      99
    );
  });
  it('does not perform polling network calls in webhook mode, when disabled or in production', async () => {
    const api = vi.spyOn(bot, 'callApi');
    await pollTelegramOnce();
    env.TELEGRAM_TRANSPORT = 'polling';
    env.TELEGRAM_ENABLED = false;
    await pollTelegramOnce();
    env.TELEGRAM_ENABLED = true;
    env.NODE_ENV = 'production';
    await pollTelegramOnce();
    expect(api).not.toHaveBeenCalled();
  });
  it('acknowledges ignored unauthorized polling updates without creating drafts or replies', async () => {
    env.TELEGRAM_TRANSPORT = 'polling';
    const update = message('/start', 999999);
    vi.spyOn(bot, 'callApi').mockImplementation(async (method) =>
      method === 'getWebhookInfo'
        ? { result: { url: '' } }
        : { result: [update] }
    );
    await pollTelegramOnce();
    expect((await TelegramCursor.findOne()).offset).toBe(update.update_id + 1);
    expect(await TelegramUpdate.countDocuments()).toBe(0);
    expect(await TelegramReply.countDocuments()).toBe(0);
  });
});
