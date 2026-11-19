import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import env from '../config/env.js';
import connectDatabase from '../config/database.js';
import User from '../models/User.js';
import {
  TelegramUpdate,
  TelegramReply,
  AIUsage,
  TelegramCursor,
} from '../models/Telegram.js';
import { telegramConfiguration } from '../services/telegramBotService.js';
import { aiConfiguration } from '../services/geminiService.js';

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const has = (flag) => args.includes(flag);
try {
  if (has('--prepare-env')) {
    const path = fileURLToPath(new URL('../.env', import.meta.url));
    let content = await readFile(path, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    for (const [key, fallback] of Object.entries({
      TELEGRAM_ENABLED: 'false',
      AI_ENABLED: 'false',
      TELEGRAM_SECRET_TOKEN: randomBytes(32).toString('hex'),
      TELEGRAM_PAYLOAD_KEY: randomBytes(32).toString('hex'),
    })) {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      if (!pattern.test(content)) content += `\n${key}=${fallback}\n`;
      else if (
        (content.match(pattern)?.[0] || '')
          .split('=')
          .slice(1)
          .join('=')
          .trim() === ''
      )
        content = content.replace(pattern, `${key}=${fallback}`);
    }
    await writeFile(path, content, 'utf8');
    console.log(
      'Missing local Telegram secrets generated. Existing non-empty settings retained. No secrets displayed; no provider contacted.'
    );
  } else if (
    has('--verify-bot') ||
    has('--register-webhook') ||
    has('--discover-ids')
  ) {
    if (!/^[1-9]\d*:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN || ''))
      throw new Error(
        'Configure the bot token in the backend environment first.'
      );
    let payload = {},
      method = 'getMe';
    if (has('--discover-ids')) {
      // Read only, before webhook setup. No offset advances or inbound actions are applied.
      method = 'getUpdates';
      payload = {
        limit: 20,
        timeout: 0,
        allowed_updates: ['message', 'callback_query'],
      };
    }
    if (has('--register-webhook')) {
      if (!telegramConfiguration().ready)
        throw new Error(
          'Complete Telegram configuration and explicitly enable it first.'
        );
      if (env.TELEGRAM_TRANSPORT !== 'webhook')
        throw new Error(
          'Set TELEGRAM_TRANSPORT=webhook and stop the local poller before registering a webhook.'
        );
      await connectDatabase({ initializeIndexes: false });
      if (
        !(await User.exists({
          isActive: true,
          role: { $in: ['admin', 'superadmin'] },
          telegramId: { $type: 'string' },
        }))
      )
        throw new Error(
          'Bind at least one intended admin before registering the webhook.'
        );
      const url = new URL(env.TELEGRAM_WEBHOOK_URL || '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/api/telegram/webhook'
      )
        throw new Error(
          'Set an HTTPS TELEGRAM_WEBHOOK_URL ending in /api/telegram/webhook, without credentials or query parameters.'
        );
      method = 'setWebhook';
      payload = {
        url: url.toString(),
        secret_token: env.TELEGRAM_SECRET_TOKEN,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 1,
        drop_pending_updates: false,
      };
    }
    let result;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        }
      );
      result = await response.json();
      if (!response.ok || !result.ok) throw new Error();
    } catch {
      throw new Error(
        'Telegram did not confirm this request. Credentials and provider URLs have been withheld.'
      );
    }
    if (method === 'getUpdates') {
      const identities = new Map();
      for (const update of result.result || []) {
        const message = update.message;
        if (
          message?.chat?.type === 'private' &&
          message.chat.id === message.from?.id &&
          !message.from?.is_bot
        )
          identities.set(message.from.id, {
            telegramId: String(message.from.id),
            name: [message.from.first_name, message.from.last_name]
              .filter(Boolean)
              .join(' ')
              .slice(0, 100),
          });
      }
      console.log(
        'Private senders in the first 20 queued updates; verify each person before binding:',
        [...identities.values()]
      );
      console.log(
        'No message contents displayed, update offsets advanced, identities bound or messages sent. This command requires polling before a webhook is registered.'
      );
    } else
      console.log(
        method === 'getMe'
          ? `Bot credentials verified; numeric bot ID: ${result.result.id}. No message sent.`
          : 'Webhook registration confirmed. Pending updates retained.'
      );
  } else {
    console.log(
      JSON.stringify(
        {
          telegram: telegramConfiguration(),
          ai: aiConfiguration(),
          model: env.GEMINI_MODEL || 'not selected',
          aiMonthlyRequestLimit: env.AI_MONTHLY_REQUEST_LIMIT,
          aiMonthlyAllowanceNaira: env.AI_MONTHLY_BUDGET_NAIRA,
          aiPerCallReservationNaira: env.AI_REQUEST_RESERVE_NAIRA,
        },
        null,
        2
      )
    );
    if (
      has('--database') ||
      has('--bind-email') ||
      has('--unbind-email') ||
      has('--discard-update')
    ) {
      await connectDatabase({ initializeIndexes: false });
      if (has('--bind-email')) {
        const email = String(value('--bind-email') || '')
            .trim()
            .toLowerCase(),
          telegramId = value('--telegram-id');
        if (!has('--telegram-id') || !/^[1-9]\d{0,15}$/.test(telegramId || ''))
          throw new Error(
            'Supply --telegram-id with the intended admin’s numeric private Telegram user ID.'
          );
        const user = await User.findOne({
          email,
          isActive: true,
          role: { $in: ['admin', 'superadmin'] },
        });
        if (!user) throw new Error('No active full admin matches that email.');
        if (user.telegramId && user.telegramId !== telegramId)
          throw new Error(
            'This admin is already bound. Deliberately unbind the old ID first.'
          );
        if (await User.exists({ telegramId, _id: { $ne: user._id } }))
          throw new Error('This Telegram ID belongs to another account.');
        user.telegramId = telegramId;
        await user.save();
        console.log(
          'Telegram ID bound to the existing admin. No message sent.'
        );
      }
      if (has('--unbind-email')) {
        await User.updateOne(
          {
            email: String(value('--unbind-email')).trim().toLowerCase(),
            role: { $in: ['admin', 'superadmin'] },
          },
          { $unset: { telegramId: 1 } }
        );
        console.log(
          'Telegram binding removed. Pending requests and replies will recheck access.'
        );
      }
      if (has('--discard-update')) {
        const reason = value('--reason');
        if (
          !has('--reason') ||
          !reason ||
          reason.startsWith('--') ||
          reason.length > 200
        )
          throw new Error(
            'Supply a short --reason after reviewing the request’s outcome.'
          );
        const result = await TelegramUpdate.updateOne(
          { key: value('--discard-update'), status: 'review' },
          {
            $set: {
              status: 'discarded',
              errorCode: 'MANUALLY_DISCARDED',
              reviewReason: reason,
            },
          }
        );
        if (!result.modifiedCount)
          throw new Error('No held request matched. No request changed.');
        console.log(
          'Held request discarded, not replayed. Its audit and any saved product remain. The admin can use /draft to inspect the current draft.'
        );
      }
      console.log(
        'Bound active full admins:',
        await User.countDocuments({
          isActive: true,
          role: { $in: ['admin', 'superadmin'] },
          telegramId: { $type: 'string' },
        })
      );
      const botScope = telegramConfiguration().bot;
      if (botScope) {
        console.log(
          'Inbound delivery counts:',
          await TelegramUpdate.aggregate([
            { $match: { bot: botScope } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
        );
        console.log(
          'Outgoing delivery counts:',
          await TelegramReply.aggregate([
            { $match: { bot: botScope } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
        );
        console.log(
          'Local polling cursor:',
          await TelegramCursor.findOne({ bot: botScope })
            .select('offset updatedAt')
            .lean()
        );
      }
      console.log(
        'Held inbound requests:',
        await TelegramUpdate.find({ status: 'review' })
          .select('key errorCode createdAt')
          .limit(20)
          .lean()
      );
      console.log(
        'Unconfirmed outgoing replies:',
        await TelegramReply.find({ status: { $in: ['failed', 'uncertain'] } })
          .select('key status errorCode createdAt')
          .limit(20)
          .lean()
      );
      console.log(
        'Current AI allowance usage:',
        await AIUsage.findOne({ month: new Date().toISOString().slice(0, 7) })
          .select('month requests reservedKobo warned stopped')
          .lean()
      );
    }
  }
} catch (error) {
  console.error(
    error.code === 11000
      ? 'This Telegram ID is already bound; no duplicate binding was saved.'
      : error.message
  );
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await mongoose.disconnect();
}
