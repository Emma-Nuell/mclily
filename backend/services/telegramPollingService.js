import { randomUUID } from 'node:crypto';
import env from '../config/env.js';
import bot, { telegramConfiguration } from './telegramBotService.js';
import { TelegramCursor } from '../models/Telegram.js';

export async function pollTelegramOnce() {
  const config = telegramConfiguration();
  if (
    !config.ready ||
    config.transport !== 'polling' ||
    env.NODE_ENV === 'production'
  )
    return;
  // One local poller per bot, even if a second development server is accidentally started.
  try {
    await TelegramCursor.updateOne(
      { bot: config.bot },
      { $setOnInsert: { bot: config.bot, offset: 0, leaseUntil: new Date(0) } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const lease = randomUUID();
  const cursor = await TelegramCursor.findOneAndUpdate(
    { bot: config.bot, leaseUntil: { $lte: new Date() } },
    { $set: { lease, leaseUntil: new Date(Date.now() + 60000) } },
    { returnDocument: 'after' }
  );
  if (!cursor) return;
  try {
    const info = await bot.callApi('getWebhookInfo', {});
    if (!info.result || info.result.url)
      throw new Error('TELEGRAM_WEBHOOK_ACTIVE');
    const response = await bot.callApi('getUpdates', {
      offset: cursor.offset,
      limit: 20,
      timeout: 5,
      allowed_updates: ['message', 'callback_query'],
    });
    if (
      !Array.isArray(response.result) ||
      response.result.length > 20 ||
      response.result.some(
        (update) =>
          !Number.isSafeInteger(update.update_id) || update.update_id < 0
      )
    )
      throw new Error('TELEGRAM_INVALID_POLL_RESPONSE');
    let offset = cursor.offset;
    for (const update of response.result.sort(
      (a, b) => a.update_id - b.update_id
    )) {
      // A crash here redelivers the update; durable intake deduplicates it. Never advance before storage.
      await bot.handleUpdate(update);
      offset = Math.max(offset, update.update_id + 1);
      const written = await TelegramCursor.updateOne(
        { _id: cursor._id, lease },
        { $set: { offset } }
      );
      if (!written.matchedCount) throw new Error('TELEGRAM_POLL_LEASE_LOST');
    }
    return { received: response.result.length, offset };
  } finally {
    await TelegramCursor.updateOne(
      { _id: cursor._id, lease },
      { $set: { leaseUntil: new Date(0) }, $unset: { lease: 1 } }
    );
  }
}

export function startTelegramPolling() {
  if (!telegramConfiguration().ready || env.TELEGRAM_TRANSPORT !== 'polling')
    return () => {};
  let stopped = false,
    timer;
  const tick = async () => {
    let delay = 250;
    try {
      const result = await pollTelegramOnce();
      if (!result) delay = 3000;
    } catch {
      delay = 15000;
      console.warn(
        'Telegram polling paused; check connectivity or an existing webhook. Pending messages are retained.'
      );
    }
    if (!stopped) {
      timer = setTimeout(tick, delay);
      timer.unref();
    }
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
