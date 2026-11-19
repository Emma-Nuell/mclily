import { createHash, randomUUID } from 'node:crypto';
import env from '../config/env.js';
import User from '../models/User.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import Order from '../models/Order.js';
import InventoryMovement from '../models/InventoryMovement.js';
import {
  TelegramUpdate,
  TelegramDraft,
  TelegramReply,
} from '../models/Telegram.js';
import { openTelegram, sealTelegram } from '../utils/telegramPayload.js';
import { AppError } from '../utils/AppError.js';
import { inTransaction } from './transactionService.js';
import { uploadImageBuffer } from './cloudinaryService.js';
import {
  parseStatedFacts,
  validateDraft,
  draftHelp,
} from './productDraftService.js';
import { transcribeProductVoice, aiConfiguration } from './geminiService.js';
import { transitionOrder } from './orderStatusService.js';
import { queueTechnical } from './notificationService.js';

export function telegramConfiguration() {
  const bot = env.TELEGRAM_BOT_TOKEN?.split(':')[0];
  const ready = Boolean(
    env.TELEGRAM_ENABLED &&
    !(env.NODE_ENV === 'production' && env.TELEGRAM_TRANSPORT === 'polling') &&
    /^[1-9]\d*:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN || '') &&
    /^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_SECRET_TOKEN || '') &&
    (env.NODE_ENV !== 'production' || env.TELEGRAM_PAYLOAD_KEY)
  );
  return { enabled: env.TELEGRAM_ENABLED, ready, bot, transport: env.TELEGRAM_TRANSPORT };
}
export function updateIdentity(update) {
  const callback = update?.callback_query,
    message = callback?.message || update?.message;
  const id = callback?.from?.id || update?.message?.from?.id;
  if (
    !Number.isSafeInteger(update?.update_id) ||
    update.update_id < 0 ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    message?.chat?.type !== 'private' ||
    message.chat.id !== id ||
    callback?.from?.is_bot ||
    update?.message?.from?.is_bot
  )
    return null;
  return { telegramId: String(id), chat: String(message.chat.id) };
}
export async function authorizedAdmin(telegramId, session) {
  if (!/^[1-9]\d{0,15}$/.test(String(telegramId || ''))) return null;
  return User.findOne({
    telegramId: String(telegramId),
    isActive: true,
    role: { $in: ['admin', 'superadmin'] },
  }).session(session || null);
}
const replyData = (text, replyMarkup) => ({
  text,
  ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
});
async function queueReply(job, data, session, key = job.key) {
  return TelegramReply.updateOne(
    { key },
    {
      $setOnInsert: {
        key,
        bot: job.bot,
        user: job.user,
        chat: job.chat,
        payload: sealTelegram(data),
      },
    },
    { upsert: true, session }
  );
}
function preview(draft, errors = []) {
  const facts = draft.facts,
    missing = [...errors, ...validateDraft(facts, draft.images)];
  const balances =
    facts.productType === 'fabric'
      ? (facts.rolls || [])
          .map((v) => `${v.colorName}: ${v.halfYards / 2} yards`)
          .join('\n')
      : (facts.variants || [])
          .map((v) => `${v.size} / ${v.color}: ${v.stock} units`)
          .join('\n');
  const text = [
    'Product draft',
    `Name: ${facts.name ?? 'needed'}`,
    `Type: ${facts.productType ?? 'needed'}`,
    `Category: ${facts.category ?? 'needed'}`,
    `Price: ${facts.price === undefined ? 'needed' : `₦${facts.price.toLocaleString('en-NG')}${facts.productType === 'fabric' ? ' per yard' : ''}`}`,
    facts.material ? `Material: ${facts.material}` : '',
    balances,
    `Photos: ${draft.images.length}`,
    facts.description ? `Description: ${facts.description}` : '',
    missing.length
      ? `Please send:\n${missing.map((v) => '• ' + v).join('\n')}`
      : 'Review the price and every stock balance before saving.',
    draft.needsConfirmation
      ? 'Voice transcription must be confirmed. Correct anything that was misheard, then tap Confirm details.'
      : '',
    'Send corrections in this chat. /help shows examples.',
  ]
    .filter(Boolean)
    .join('\n');
  const buttons = [];
  if (!missing.length)
    buttons.push({
      text: draft.needsConfirmation ? 'Confirm details' : 'Save product',
      callback_data: `${draft.needsConfirmation ? 'confirm' : 'save'}:${draft._id}:${draft.revision}`,
    });
  buttons.push({
    text: 'Discard',
    callback_data: `discard:${draft._id}:${draft.revision}`,
  });
  return replyData(text, { inline_keyboard: [buttons] });
}

class TelegramBotService {
  isConfigured() {
    return telegramConfiguration().ready;
  }
  async isAuthorized(id) {
    return Boolean(await authorizedAdmin(id));
  }

  // Plain text avoids HTML injection through product/customer names. Never log provider URLs/errors.
  async callApi(method, payload) {
    if (!this.isConfigured()) throw new Error('TELEGRAM_DISABLED');
    if (
      ![
        'sendMessage',
        'getFile',
        'getMe',
        'setWebhook',
        'getWebhookInfo',
        'getUpdates',
        'answerCallbackQuery',
      ].includes(method)
    )
      throw new Error('TELEGRAM_METHOD_INVALID');
    let response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const error = new Error('TELEGRAM_REJECTED');
        error.definitelyRejected = true;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.definitelyRejected) throw error;
      throw new Error('TELEGRAM_OUTCOME_UNCERTAIN');
    }
  }

  async downloadTelegramFile(fileId, limit = 5 * 1024 * 1024) {
    if (typeof fileId !== 'string' || fileId.length > 300)
      throw new Error('TELEGRAM_FILE_INVALID');
    const info = await this.callApi('getFile', { file_id: fileId }),
      file = info.result;
    if (
      !file?.file_path ||
      !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(file.file_path) ||
      file.file_path.includes('..') ||
      file.file_path.startsWith('/') ||
      file.file_size > limit
    )
      throw new Error('TELEGRAM_FILE_INVALID');
    let reader;
    try {
      const response = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(15000), redirect: 'error' }
      );
      if (
        !response.ok ||
        Number(response.headers.get('content-length')) > limit
      )
        throw new Error();
      reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > limit) throw new Error();
        chunks.push(Buffer.from(part.value));
      }
      return Buffer.concat(chunks);
    } catch {
      throw new Error('TELEGRAM_FILE_DOWNLOAD_FAILED');
    } finally {
      if (reader) await reader.cancel().catch(() => {});
    }
  }

  // Only this durable intake is used by the webhook; returning 200 must follow the write.
  async handleUpdate(update) {
    const config = telegramConfiguration();
    if (!config.ready)
      throw new AppError(503, 'TELEGRAM_DISABLED', 'Telegram is not enabled.');
    if (Buffer.byteLength(JSON.stringify(update || {})) > 64000)
      throw new AppError(413, 'TELEGRAM_UPDATE_TOO_LARGE', 'Update too large.');
    const identity = updateIdentity(update);
    if (!identity) return { ignored: true };
    const admin = await authorizedAdmin(identity.telegramId);
    if (!admin) return { ignored: true };
    const key = `${config.bot}:${update.update_id}`,
      hash = createHash('sha256').update(JSON.stringify(update)).digest('hex');
    try {
      await TelegramUpdate.create({
        key,
        hash,
        bot: config.bot,
        updateId: update.update_id,
        user: admin._id,
        chat: identity.chat,
        payload: sealTelegram(update),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await TelegramUpdate.findOne({ key });
      if (existing?.hash !== hash)
        throw new AppError(
          409,
          'TELEGRAM_UPDATE_CONFLICT',
          'Update conflicts with an earlier request.'
        );
    }
    return { accepted: true };
  }

  // Network operations are prepared once, outside transactions; interrupted work is held for review.
  async prepare(job, update) {
    if (!update.message) return {};
    const message = update.message,
      text = (message.text || message.caption || '').trim();
    if (text.startsWith('/')) return { text };
    let transcription;
    if (message.voice) {
      if (!aiConfiguration().ready)
        return {
          notice:
            'Voice assistance is off. Please send the product details as text; /help shows a short example.',
        };
      if (
        message.voice.duration > 60 ||
        message.voice.file_size > 4 * 1024 * 1024
      )
        return {
          notice:
            'Please send a voice note under one minute and 4 MB, or use text.',
        };
      const mimeType = message.voice.mime_type || 'audio/ogg';
      if (
        !['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'].includes(
          mimeType
        )
      )
        return {
          notice: 'This voice format is not supported. Please use text.',
        };
      const buffer = await this.downloadTelegramFile(
        message.voice.file_id,
        4 * 1024 * 1024
      );
      transcription = (
        await transcribeProductVoice({ key: job.key, buffer, mimeType })
      ).transcript;
      if (transcription.length > 1000)
        return {
          notice:
            'That note contains too much detail for a safe chat preview. Please send shorter text details using /help.',
        };
    }
    let image;
    if (message.photo?.length) {
      const photo = message.photo.at(-1);
      if (photo.file_size > 5 * 1024 * 1024)
        return { notice: 'Choose a photo smaller than 5 MB.' };
      const buffer = await this.downloadTelegramFile(photo.file_id);
      // Telegram photos are re-encoded JPEGs. Documents are deliberately not treated as product photos.
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff)
        return {
          notice: 'Please send this as a photo, rather than a document.',
        };
      image = (
        await uploadImageBuffer(buffer, 'mclily/telegram', {
          publicId: `bot-${job.bot}-update-${job.updateId}`,
        })
      ).secureUrl;
    }
    return {
      text: transcription || text,
      image,
      transcribed: Boolean(transcription),
    };
  }

  async apply(job, update, prepared, session) {
    const identity = updateIdentity(update),
      admin = identity && (await authorizedAdmin(identity.telegramId, session));
    if (!admin || String(admin._id) !== String(job.user))
      return replyData('Access is no longer available.');
    if (update.callback_query)
      return this.applyCallback(job, update.callback_query, session);
    if (prepared.notice) return replyData(prepared.notice);
    const text = prepared.text || '',
      scope = {
        bot: job.bot,
        user: job.user,
        chat: job.chat,
        status: 'active',
      };
    if (['/start', '/help'].includes(text)) return replyData(draftHelp);
    if (text === '/status') {
      const pending = await Order.countDocuments({
        'payment.status': 'paid',
        'fulfillment.status': { $in: ['processing', 'shipped'] },
      }).session(session);
      const count = await Product.countDocuments({ isActive: true }).session(
        session
      );
      return replyData(
        `Store status\nPaid orders being prepared or delivered: ${pending}\nActive catalog products: ${count}\nCash, credit and refund figures are available in the admin reports.`
      );
    }
    if (text === '/stock') {
      const products = await Product.find({ isActive: true })
        .sort({ updatedAt: -1 })
        .limit(100)
        .session(session);
      const low = products.flatMap((product) =>
        product.productType === 'fabric'
          ? product.colorVariants
              .filter((v) => v.rollStockHalfYards - v.reservedHalfYards <= 6)
              .map(
                (v) =>
                  `${product.name} / ${v.colorName}: ${(v.rollStockHalfYards - v.reservedHalfYards) / 2} yards available`
              )
          : product.sizes
              .filter((v) => v.stock - v.reservedStock <= 5)
              .map(
                (v) =>
                  `${product.name} / ${v.size || ''} / ${v.color || ''}: ${v.stock - v.reservedStock} units available`
              )
      );
      return replyData(
        `Low stock (up to 100 recently updated products)\n${low.slice(0, 12).join('\n') || 'None in this sample.'}\nUse Products in the admin for the full inventory.`
      );
    }
    if (text === '/cancel' || text === '/new') {
      await TelegramDraft.updateMany(
        scope,
        { $set: { status: 'cancelled' } },
        { session }
      );
      return replyData(
        text === '/new'
          ? 'Send a photo and product details to start a new draft.'
          : 'Current draft discarded.'
      );
    }
    if (text.startsWith('/') && text !== '/draft')
      return replyData('Use /help to see the available commands.');
    let draft = await TelegramDraft.findOne({
      ...scope,
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (text === '/draft')
      return draft
        ? preview(draft)
        : replyData('No current draft. Send a photo and product details.');
    if (!text && !prepared.image)
      return replyData(
        'Please send a product photo and text details. /help shows an example.'
      );
    if (!draft)
      [draft] = await TelegramDraft.create(
        [{ ...scope, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }],
        { session }
      );
    const parsed = parseStatedFacts(text);
    draft.facts = { ...draft.facts, ...parsed.facts };
    // An invalid attempted correction cannot leave an older value silently saveable.
    for (const line of text.split('\n')) {
      const match = line.match(
        /^(name|type|category|price|description|material|variants|rolls)\s*:/i
      );
      if (!match) continue;
      const key =
        match[1].toLowerCase() === 'type'
          ? 'productType'
          : match[1].toLowerCase();
      if (parsed.facts[key] === undefined) delete draft.facts[key];
    }
    if (prepared.image)
      draft.images = [...draft.images, prepared.image].slice(-5);
    if (prepared.transcribed) draft.needsConfirmation = true;
    draft.revision += 1;
    draft.markModified('facts');
    await draft.save({ session });
    const data = preview(draft, parsed.errors);
    if (prepared.transcribed)
      data.text = `Voice transcript (check carefully):\n${text}\n\n${data.text}`;
    return data;
  }

  async applyCallback(job, callback, session) {
    const action = callback.data || '';
    const match = action.match(/^(save|confirm|discard):([a-f0-9]{24}):(\d+)$/);
    if (match) {
      const draft = await TelegramDraft.findOne({
        _id: match[2],
        bot: job.bot,
        user: job.user,
        chat: job.chat,
      }).session(session);
      if (!draft)
        return replyData('This draft is unavailable for your account.');
      if (draft.status === 'saved')
        return replyData(
          `Already saved to the catalog. Product ID: ${draft.product}.`
        );
      if (draft.status !== 'active' || draft.expiresAt <= new Date())
        return replyData(
          'This draft was discarded or has expired. Send the details again.'
        );
      if (draft.revision !== Number(match[3]))
        return replyData(
          'These buttons refer to an older version. Send /draft to review the current details.'
        );
      if (match[1] === 'discard') {
        draft.status = 'cancelled';
        await draft.save({ session });
        return replyData('Draft discarded.');
      }
      if (match[1] === 'confirm') {
        draft.needsConfirmation = false;
        draft.revision += 1;
        await draft.save({ session });
        return preview(draft);
      }
      if (
        draft.needsConfirmation ||
        validateDraft(draft.facts, draft.images).length
      )
        return preview(draft);
      const f = draft.facts,
        Model = f.productType === 'fabric' ? FabricProduct : RetailProduct;
      const [product] = await Model.create(
        [
          {
            name: f.name,
            slug: `${
              f.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 120) || 'product'
            }-${draft._id}`,
            category: f.category,
            price: f.price,
            description: f.description || f.name,
            images: draft.images,
            isFeatured: false,
            isActive: true,
            ...(f.productType === 'fabric'
              ? {
                  material: f.material,
                  pricePerYard: f.price,
                  colorVariants: f.rolls.map((v) => ({
                    colorName: v.colorName,
                    rollStockHalfYards: v.halfYards,
                    reservedHalfYards: 0,
                    image: draft.images[0],
                  })),
                }
              : {
                  sizes: f.variants.map((v) => ({
                    ...v,
                    size:
                      v.size.toLowerCase() === 'standard' ? undefined : v.size,
                    color:
                      v.color.toLowerCase() === 'standard'
                        ? undefined
                        : v.color,
                    reservedStock: 0,
                  })),
                }),
          },
        ],
        { session }
      );
      const variants =
        product.productType === 'fabric'
          ? product.colorVariants
          : product.sizes;
      for (const variant of variants) {
        const units =
          product.productType === 'fabric'
            ? variant.rollStockHalfYards
            : variant.stock;
        await InventoryMovement.create(
          [
            {
              key: `telegram-initial:${draft._id}:${variant._id}`,
              product: product._id,
              variant: variant._id,
              productType: product.productType,
              action: 'correction',
              reason: 'Opening stock explicitly confirmed in Telegram',
              units,
              stockBefore: 0,
              stockAfter: units,
              reservedBefore: 0,
              reservedAfter: 0,
              source: `telegram:${draft._id}`,
              actor: String(job.user),
            },
          ],
          { session }
        );
      }
      draft.status = 'saved';
      draft.product = product._id;
      await draft.save({ session });
      return replyData(
        `Saved to the catalog: ${product.name}\nProduct ID: ${product._id}\nYou can review it in Products in the admin. A storefront in preview mode continues to show its preview catalog.`
      );
    }
    const orderAction = action.match(
      /^order_status_([a-f0-9]{24})_(shipped|delivered)$/
    );
    if (orderAction) {
      const order = await Order.findById(orderAction[1]).session(session);
      if (!order) return replyData('Order unavailable.');
      if (order.fulfillment.status === orderAction[2])
        return replyData(
          `Order ${order.orderNumber} is already ${orderAction[2]}.`
        );
      try {
        const updated = await transitionOrder(order._id, orderAction[2], {
          actor: String(job.user),
          note: 'Updated through the authorized Telegram assistant',
          session,
        });
        const next =
          orderAction[2] === 'shipped'
            ? {
                inline_keyboard: [
                  [
                    {
                      text: 'Mark delivered',
                      callback_data: `order_status_${order._id}_delivered`,
                    },
                  ],
                ],
              }
            : undefined;
        return replyData(
          `Order ${updated.orderNumber}: ${updated.fulfillment.status}.`,
          next
        );
      } catch (error) {
        if (error instanceof AppError)
          return replyData(
            'This order cannot move to that status. Check payment, stock and open issues in Orders.'
          );
        throw error;
      }
    }
    return replyData(
      'This action is no longer available. Use /draft or open the admin.'
    );
  }

  async processUpdates(limit = 10) {
    if (!this.isConfigured()) return;
    const bot = telegramConfiguration().bot;
    // A crashed worker might have called a provider. Hold it for deliberate review rather than replay it.
    const interrupted = await TelegramUpdate.find({
      bot,
      status: 'processing',
      leaseUntil: { $lt: new Date() },
    }).limit(30);
    for (const item of interrupted)
      await inTransaction(async (session) => {
        const held = await TelegramUpdate.findOneAndUpdate(
          {
            _id: item._id,
            status: 'processing',
            leaseUntil: { $lt: new Date() },
          },
          { $set: { status: 'review', errorCode: 'WORKER_INTERRUPTED' } },
          { session }
        );
        if (held) {
          await queueReply(
            item,
            replyData(
              'This request was interrupted and needs a technical check. No success is confirmed. Please contact the technical administrator.'
            ),
            session,
            `${item.key}:review`
          );
          await queueTechnical(
            `telegram-review:${item.key}`,
            'An interrupted Telegram request was held for review. Check the request and any provider outcome before discarding it; do not replay it automatically.',
            session
          );
        }
      });
    for (let n = 0; n < limit; n++) {
      const candidates = await TelegramUpdate.find({ bot, status: 'pending' })
        .sort({ createdAt: 1, updateId: 1 })
        .limit(30);
      let job;
      for (const candidate of candidates) {
        const earlier = await TelegramUpdate.exists({
          bot,
          chat: candidate.chat,
          _id: { $ne: candidate._id },
          status: { $in: ['pending', 'processing', 'review'] },
          $or: [
            { createdAt: { $lt: candidate.createdAt } },
            {
              createdAt: candidate.createdAt,
              updateId: { $lt: candidate.updateId },
            },
          ],
        });
        if (earlier) continue;
        job = await TelegramUpdate.findOneAndUpdate(
          { _id: candidate._id, status: 'pending' },
          {
            $set: {
              status: 'processing',
              lease: randomUUID(),
              leaseUntil: new Date(Date.now() + 180000),
            },
          },
          { returnDocument: 'after' }
        ).select('+payload +prepared');
        if (job) break;
      }
      if (!job) break;
      try {
        const admin = await authorizedAdmin(job.chat);
        if (!admin || String(admin._id) !== String(job.user)) {
          await TelegramUpdate.updateOne(
            { _id: job._id, lease: job.lease },
            { $set: { status: 'discarded', errorCode: 'ACCESS_REVOKED' } }
          );
          continue;
        }
        const update = openTelegram(job.payload),
          prepared = job.prepared
            ? openTelegram(job.prepared)
            : await this.prepare(job, update);
        await TelegramUpdate.updateOne(
          { _id: job._id, status: 'processing', lease: job.lease },
          { $set: { prepared: sealTelegram(prepared) } }
        );
        await inTransaction(async (session) => {
          const locked = await TelegramUpdate.findOneAndUpdate(
            {
              _id: job._id,
              status: 'processing',
              lease: job.lease,
              leaseUntil: { $gt: new Date() },
            },
            { $set: { status: 'completed' } },
            { session, returnDocument: 'after' }
          );
          if (!locked) throw new Error('TELEGRAM_LEASE_LOST');
          const data = await this.apply(job, update, prepared, session);
          if (update.callback_query)
            data.callback_query_id = update.callback_query.id;
          await queueReply(job, data, session);
        });
      } catch (error) {
        await inTransaction(async (session) => {
          const held = await TelegramUpdate.findOneAndUpdate(
            { _id: job._id, lease: job.lease, status: 'processing' },
            {
              $set: {
                status: 'review',
                errorCode: 'PROCESSING_REQUIRES_REVIEW',
              },
            },
            { session }
          );
          if (held) {
            await queueReply(
              job,
              replyData(
                'This request needs a technical check. No success is confirmed. Please contact the technical administrator; manual entry in the admin remains available.'
              ),
              session,
              `${job.key}:review`
            );
            await queueTechnical(
              `telegram-review:${job.key}`,
              'A Telegram request was held for technical review. Check the Telegram setup report. Do not replay a provider call without checking its outcome.',
              session
            );
          }
        });
      }
    }
  }

  async processReplies(limit = 10) {
    if (!this.isConfigured()) return;
    const bot = telegramConfiguration().bot;
    await TelegramReply.updateMany(
      { bot, status: 'sending', leaseUntil: { $lt: new Date() } },
      { $set: { status: 'uncertain', errorCode: 'WORKER_INTERRUPTED' } }
    );
    for (let n = 0; n < limit; n++) {
      const reply = await TelegramReply.findOneAndUpdate(
        { bot, status: 'pending' },
        {
          $set: {
            status: 'sending',
            lease: randomUUID(),
            leaseUntil: new Date(Date.now() + 60000),
          },
        },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      ).select('+payload');
      if (!reply) break;
      const admin = await authorizedAdmin(reply.chat);
      if (!admin || String(admin._id) !== String(reply.user)) {
        await TelegramReply.updateOne(
          { _id: reply._id, lease: reply.lease },
          { $set: { status: 'cancelled' } }
        );
        continue;
      }
      try {
        const { callback_query_id: callbackId, ...data } = openTelegram(
          reply.payload
        );
        if (callbackId) {
          // Callback acknowledgements may expire; their outcome never changes the saved product.
          try {
            await this.callApi('answerCallbackQuery', {
              callback_query_id: callbackId,
            });
          } catch {
            /* The durable result message is still useful. */
          }
        }
        await this.callApi('sendMessage', {
          chat_id: reply.chat,
          ...data,
          text: data.text.slice(0, 4000),
        });
        await TelegramReply.updateOne(
          { _id: reply._id, lease: reply.lease, status: 'sending' },
          { $set: { status: 'sent' } }
        );
      } catch (error) {
        await TelegramReply.updateOne(
          { _id: reply._id, lease: reply.lease, status: 'sending' },
          {
            $set: {
              status: error.definitelyRejected ? 'failed' : 'uncertain',
              errorCode: error.definitelyRejected
                ? 'PROVIDER_REJECTED'
                : 'PROVIDER_OUTCOME_UNCERTAIN',
            },
          }
        );
      }
    }
  }

  // Optional secondary channel. Email remains the primary operational notification.
  async sendOrderNotification(order, { session: existingSession } = {}) {
    if (!this.isConfigured()) return;
    const work = async (session) => {
      const admins = await User.find({
        isActive: true,
        role: { $in: ['admin', 'superadmin'] },
        telegramId: { $type: 'string' },
      }).session(session);
      for (const admin of admins)
        await queueReply(
          {
            bot: telegramConfiguration().bot,
            user: admin._id,
            chat: admin.telegramId,
          },
          replyData(
            `Paid order ${order.orderNumber}. Review the customer and delivery details in Orders.`,
            {
              inline_keyboard: [
                [
                  {
                    text: 'Mark shipped',
                    callback_data: `order_status_${order._id}_shipped`,
                  },
                ],
              ],
            }
          ),
          session,
          `order-paid:${telegramConfiguration().bot}:${order._id}:${admin._id}`
        );
    };
    if (existingSession) {
      if (!existingSession.inTransaction())
        throw new Error('Telegram notification writes require a transaction.');
      return work(existingSession);
    }
    return inTransaction(work);
  }
  async sendLowStockAlert(product, currentStock) {
    if (!this.isConfigured()) return;
    const admins = await User.find({
      isActive: true,
      role: { $in: ['admin', 'superadmin'] },
      telegramId: { $type: 'string' },
    });
    await inTransaction(async (session) => {
      for (const admin of admins)
        await queueReply(
          {
            bot: telegramConfiguration().bot,
            user: admin._id,
            chat: admin.telegramId,
          },
          replyData(
            `Stock alert: ${product.name}. Check exact available variant balances in Products.`
          ),
          session,
          `stock:${telegramConfiguration().bot}:${product._id}:${product.updatedAt?.getTime()}:${admin._id}`
        );
    });
  }
}
export const telegramBotService = new TelegramBotService();
export default telegramBotService;
