import { timingSafeEqual } from 'node:crypto';
import telegramBotService, {
  telegramConfiguration,
} from '../services/telegramBotService.js';
import env from '../config/env.js';

/**
 * @desc   Telegram Webhook Receiver
 * @route  POST /api/telegram/webhook
 * @access Public (Secret token verified)
 */
export const handleTelegramWebhook = async (req, res, next) => {
  if (!telegramConfiguration().ready || env.TELEGRAM_TRANSPORT !== 'webhook')
    return res
      .status(503)
      .json({ ok: false, message: 'Telegram is not enabled.' });
  const received = Buffer.from(
    String(req.headers['x-telegram-bot-api-secret-token'] || '')
  );
  const expected = Buffer.from(env.TELEGRAM_SECRET_TOKEN);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return res.status(403).json({ ok: false });
  try {
    const result = await telegramBotService.handleUpdate(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};
