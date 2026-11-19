import EmailOutbox from '../models/EmailOutbox.js';
import { emailConfiguration, verifySmtp } from '../services/emailService.js';
import { enqueueEmail } from '../services/notificationService.js';
import {
  idempotentTransaction,
  requestKey,
} from '../services/idempotencyService.js';
import { recoveryEmailValid } from '../services/emailOutboxService.js';
import { openEmail } from '../utils/emailPayload.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import validator from 'validator';
export const listEmailDelivery = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1),
    filter = {};
  if (req.query.status && req.query.status !== 'all') {
    if (
      ![
        'pending',
        'sending',
        'sent',
        'failed',
        'uncertain',
        'expired',
        'cancelled',
      ].includes(req.query.status)
    )
      throw new AppError(400, 'INVALID_STATUS', 'Choose a valid email status.');
    filter.status = req.query.status;
  }
  const [total, jobs, grouped] = await Promise.all([
    EmailOutbox.countDocuments(filter),
    EmailOutbox.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 15)
      .limit(15),
    EmailOutbox.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  res.json({
    success: true,
    data: jobs.map((job) => ({
      _id: job._id,
      kind: job.kind,
      group: job.group,
      to: job.to,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
      sentAt: job.sentAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    })),
    page,
    pages: Math.ceil(total / 15) || 1,
    total,
    counts: Object.fromEntries(grouped.map((row) => [row._id, row.count])),
    configuration: emailConfiguration(),
  });
});
export const verifyEmailConfiguration = asyncHandler(async (req, res) => {
  if (!emailConfiguration().enabled || !emailConfiguration().configured)
    throw new AppError(
      409,
      'EMAIL_NOT_CONFIGURED',
      'Insert the SMTP settings and enable email first.'
    );
  try {
    await verifySmtp();
  } catch {
    throw new AppError(
      503,
      'SMTP_UNAVAILABLE',
      'SMTP authentication or connection could not be verified. Check the provider settings.'
    );
  }
  res.json({
    success: true,
    message:
      'SMTP connection and authentication verified. Inbox delivery still needs a test email.',
  });
});
export const queueEmailTest = asyncHandler(async (req, res) => {
  if (!validator.isEmail(req.user.email || ''))
    throw new AppError(
      409,
      'EMAIL_RECIPIENT_REQUIRED',
      'Your administrator account needs an email address for a test message.'
    );
  if (!emailConfiguration().enabled || !emailConfiguration().configured)
    throw new AppError(
      409,
      'EMAIL_NOT_CONFIGURED',
      'Insert the SMTP settings and enable email first.'
    );
  const key = requestKey(req),
    payload = { actor: String(req.user._id), email: req.user.email };
  const result = await idempotentTransaction(
    'EMAIL_TEST_' + key,
    'EMAIL_ACTION',
    payload,
    async (session) => {
      await enqueueEmail(
        {
          key: 'test:' + key,
          kind: 'smtp_test',
          group: 'technical',
          to: req.user.email,
          user: req.user._id,
          data: {},
        },
        session
      );
      return { queued: true };
    }
  );
  res.json({
    success: true,
    data: result.data,
    message:
      'Test email queued to your account email. Check its status and your inbox.',
  });
});
export const updateEmailDelivery = asyncHandler(async (req, res) => {
  const key = requestKey(req),
    action = req.params.action;
  if (
    !['retry', 'accepted'].includes(action) ||
    !/^[a-f0-9]{24}$/i.test(req.params.id)
  )
    throw new AppError(
      400,
      'INVALID_EMAIL_ACTION',
      'Choose a valid email action.'
    );
  const payload = {
    ...req.body,
    idempotencyKey: undefined,
    id: req.params.id,
    action,
    actor: String(req.user._id),
  };
  const result = await idempotentTransaction(
    'EMAIL_ACTION_' + key,
    'EMAIL_ACTION',
    payload,
    async (session) => {
      const job = await EmailOutbox.findById(req.params.id)
        .select('+payload')
        .session(session);
      if (!job || !['failed', 'uncertain'].includes(job.status))
        throw new AppError(
          409,
          'EMAIL_CHANGED',
          'This message is no longer awaiting this action. Refresh the list.'
        );
      if (job.updatedAt.toISOString() !== req.body.expectedUpdatedAt)
        throw new AppError(
          409,
          'EMAIL_CHANGED',
          'The message changed. Refresh the list first.'
        );
      if (action === 'accepted') {
        if (job.status !== 'uncertain' || req.body.providerAccepted !== true)
          throw new AppError(
            400,
            'EMAIL_CHECK_REQUIRED',
            'Confirm that the provider logs show this message was accepted.'
          );
        job.status = 'sent';
        job.sentAt = new Date();
        job.lastError =
          'Provider acceptance confirmed by administrator; inbox delivery is not guaranteed.';
      } else {
        if (job.status === 'uncertain' && req.body.checkedNotAccepted !== true)
          throw new AppError(
            400,
            'EMAIL_CHECK_REQUIRED',
            'Check provider logs and confirm it was not accepted before resending.'
          );
        if (!(await recoveryEmailValid(job, openEmail(job.payload))))
          throw new AppError(
            409,
            'EMAIL_LINK_EXPIRED',
            'This recovery link is expired, replaced or already used. Request a new link.'
          );
        job.status = 'pending';
        job.attempts = 0;
        job.nextAttemptAt = new Date();
        job.lastError = '';
      }
      job.reviewedBy = req.user._id;
      job.leaseToken = undefined;
      job.leaseUntil = undefined;
      await job.save({ session });
      return { updated: true };
    }
  );
  res.json({ success: true, data: result.data });
});
