import { createHash, randomUUID } from 'node:crypto';
import EmailOutbox from '../models/EmailOutbox.js';
import NotificationState from '../models/NotificationState.js';
import User from '../models/User.js';
import { openEmail } from '../utils/emailPayload.js';
import { emailConfiguration, sendEmail } from './emailService.js';
import { renderEmail } from './emailTemplates.js';
import { inTransaction } from './transactionService.js';
import { queueTechnical } from './notificationService.js';
import env from '../config/env.js';

export async function recoveryEmailValid(job, payload, now = new Date()) {
  if (job.expiresAt && job.expiresAt <= now) return false;
  if (job.kind !== 'password_reset') return true;
  return Boolean(
    await User.exists({
      _id: job.user,
      isActive: true,
      resetTokenHash: payload.resetHash,
      resetExpiresAt: { $gt: now },
    })
  );
}
async function deliveryProblem(job, status, code) {
  await inTransaction(async (session) => {
    const result = await EmailOutbox.updateOne(
      { _id: job._id, status: 'sending', leaseToken: job.leaseToken },
      {
        $set: {
          status,
          lastError: code,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)
          ),
        },
        $unset: { leaseToken: '', leaseUntil: '' },
      },
      { session }
    );
    if (
      result.modifiedCount &&
      job.group !== 'technical' &&
      ['failed', 'uncertain'].includes(status)
    )
      await queueTechnical(
        'mail-' + job._id,
        `An email is ${status}. Open More → Email delivery to inspect it. SMTP acceptance is not proof of inbox delivery.`,
        session
      );
  });
}
export async function processEmailJob(id, send = sendEmail) {
  const status = emailConfiguration();
  if (!status.enabled || !status.configured) return;
  const token = randomUUID();
  const job = await EmailOutbox.findOneAndUpdate(
    { _id: id, status: 'pending', nextAttemptAt: { $lte: new Date() } },
    {
      $set: {
        status: 'sending',
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 180000),
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' }
  ).select('+payload');
  if (!job) return;
  let payload, message;
  try {
    payload = openEmail(job.payload);
    if (!(await recoveryEmailValid(job, payload))) {
      await EmailOutbox.updateOne(
        { _id: id, leaseToken: token },
        {
          $set: { status: 'expired', lastError: 'Link expired or replaced.' },
          $unset: { leaseToken: '', leaseUntil: '' },
        }
      );
      return;
    }
    message = renderEmail(job.kind, payload);
  } catch {
    await deliveryProblem(
      job,
      'failed',
      'Email content or encrypted payload could not be prepared.'
    );
    return;
  }
  const sender = env.SMTP_FROM.match(/<([^>]+)>/)?.[1] || env.SMTP_FROM;
  const host =
    sender
      .split('@')
      .at(-1)
      .replace(/[^a-z0-9.-]/gi, '') || 'mclily.local';
  const messageId = `<${createHash('sha256').update(job.key).digest('hex')}@${host}>`;
  try {
    const info = await send({ ...message, to: job.to, messageId });
    if (
      !info?.accepted?.some(
        (value) =>
          String(
            typeof value === 'object' ? value.address : value
          ).toLowerCase() === job.to
      )
    ) {
      await deliveryProblem(
        job,
        'failed',
        'SMTP did not accept this recipient.'
      );
      return;
    }
    // A DB failure after SMTP acceptance is held as uncertain by the catch below, never blindly resent.
    await EmailOutbox.updateOne(
      { _id: id, leaseToken: token, status: 'sending' },
      {
        $set: { status: 'sent', sentAt: new Date(), messageId, lastError: '' },
        $unset: { leaseToken: '', leaseUntil: '' },
      }
    );
  } catch (error) {
    const smtpCode = Number(error.responseCode);
    const definite =
      smtpCode >= 400 ||
      ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNECTION'].includes(error.code);
    const temporary =
      (smtpCode >= 400 && smtpCode < 500) ||
      ['EDNS', 'ECONNECTION'].includes(error.code);
    await deliveryProblem(
      job,
      !definite
        ? 'uncertain'
        : temporary && job.attempts < 6
          ? 'pending'
          : 'failed',
      !definite
        ? 'SMTP outcome is unknown. Check provider logs before retrying.'
        : temporary
          ? 'Temporary SMTP failure. Retry scheduled or attempts exhausted.'
          : 'SMTP rejected the message. Check mailbox configuration and recipient.'
    );
  }
}
export async function processEmailOutbox(send = sendEmail) {
  const now = new Date();
  await EmailOutbox.updateMany(
    { status: { $in: ['pending', 'failed'] }, expiresAt: { $lte: now } },
    { $set: { status: 'expired', lastError: 'Link expired before delivery.' } }
  );
  const stale = await EmailOutbox.find({
    status: 'sending',
    leaseUntil: { $lte: now },
  }).limit(25);
  for (const job of stale)
    await deliveryProblem(
      job,
      'uncertain',
      'Sending was interrupted. Check provider acceptance before retrying.'
    );
  const config = emailConfiguration();
  if (!config.enabled || !config.configured) return;
  const token = randomUUID();
  try {
    const lock = await NotificationState.findOneAndUpdate(
      {
        _id: 'email-dispatch',
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 180000) },
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (lock.leaseToken !== token) return;
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }
  try {
    for (let index = 0; index < 10; index++) {
      const hourCount = await EmailOutbox.countDocuments({
        $or: [
          { sentAt: { $gte: new Date(Date.now() - 3600000) } },
          {
            status: 'uncertain',
            updatedAt: { $gte: new Date(Date.now() - 3600000) },
          },
        ],
      });
      const dayCount = await EmailOutbox.countDocuments({
        $or: [
          { sentAt: { $gte: new Date(Date.now() - 86400000) } },
          {
            status: 'uncertain',
            updatedAt: { $gte: new Date(Date.now() - 86400000) },
          },
        ],
      });
      if (
        hourCount >= env.EMAIL_MAX_PER_HOUR ||
        dayCount >= env.EMAIL_MAX_PER_DAY
      )
        break;
      const job = await EmailOutbox.findOne({
        status: 'pending',
        nextAttemptAt: { $lte: new Date() },
      })
        .sort({ createdAt: 1, _id: 1 })
        .select('_id');
      if (!job) break;
      const owned = await NotificationState.updateOne(
        { _id: 'email-dispatch', leaseToken: token },
        { $set: { leaseUntil: new Date(Date.now() + 180000) } }
      );
      if (!owned.matchedCount) break;
      await processEmailJob(job._id, send);
    }
  } finally {
    await NotificationState.updateOne(
      { _id: 'email-dispatch', leaseToken: token },
      { $unset: { leaseToken: '', leaseUntil: '' } }
    );
  }
}
