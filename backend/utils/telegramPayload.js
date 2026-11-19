import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import env from '../config/env.js';
const key = () =>
  env.TELEGRAM_PAYLOAD_KEY
    ? Buffer.from(env.TELEGRAM_PAYLOAD_KEY, 'hex')
    : createHmac('sha256', env.JWT_SECRET)
        .update('mclily-telegram-v1')
        .digest();
export function sealTelegram(value) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((part) => part.toString('base64'))
    .join('.');
}
export function openTelegram(value) {
  const [iv, tag, bytes] = value
    .split('.')
    .map((part) => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8')
  );
}
