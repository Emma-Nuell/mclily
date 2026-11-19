import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import env from '../config/env.js';
const key = () =>
  env.EMAIL_PAYLOAD_KEY
    ? Buffer.from(env.EMAIL_PAYLOAD_KEY, 'hex')
    : createHmac('sha256', env.JWT_SECRET)
        .update('mclily-mail-payload-v1')
        .digest();
export function sealEmail(payload) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}
export function openEmail(payload) {
  const [iv, tag, data] = payload
    .split('.')
    .map((value) => Buffer.from(value, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
  );
}
