import { createHash } from 'node:crypto';
import IdempotencyLog from '../models/IdempotencyLog.js';
import { AppError } from '../utils/AppError.js';
import { inTransaction } from './transactionService.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
export function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function requestKey(req) {
  const key = req.get('Idempotency-Key') || req.body.idempotencyKey;
  if (typeof key !== 'string' || !/^[\w:-]{8,128}$/.test(key))
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid transaction reference is required. Please retry from the original screen.'
    );
  return key;
}
export async function idempotentTransaction(
  key,
  action,
  payload,
  work,
  { retryOnDuplicate = () => false } = {}
) {
  const hash = fingerprint(payload);
  const replay = (existing) => {
    if (existing.requestHash !== hash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This reference was already used for a different request.'
      );
    if (existing.status !== 'COMPLETED')
      throw new AppError(
        409,
        'REQUEST_PROCESSING',
        'This request is still processing.'
      );
    return { data: existing.responseData, replayed: true };
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await inTransaction(async (session) => {
        const existing = await IdempotencyLog.findOne({ key }).session(session);
        if (existing) return replay(existing);
        const [record] = await IdempotencyLog.create(
          [{ key, action, requestHash: hash, status: 'PROCESSING' }],
          { session }
        );
        const data = await work(session);
        record.status = 'COMPLETED';
        record.responseData = data;
        await record.save({ session });
        return { data, replayed: false };
      });
    } catch (error) {
      // A concurrent duplicate insert waits for the winning transaction to commit.
      if (error.code === 11000) {
        const existing = await IdempotencyLog.findOne({ key });
        if (existing) return replay(existing);
        if (attempt < 2 && retryOnDuplicate(error)) continue;
      }
      throw error;
    }
  }
}
