import { createHash, randomBytes } from 'node:crypto';
import validator from 'validator';
import User from '../models/User.js';
import EmailOutbox from '../models/EmailOutbox.js';
import { inTransaction } from '../services/transactionService.js';
import { enqueueEmail } from '../services/notificationService.js';
import { clearAuthCookie } from '../middlewares/authMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import env from '../config/env.js';
import { appUrl } from '../vendor/publicUrls.mjs';
const digest = (token) => createHash('sha256').update(token).digest('hex');
export const forgotPassword = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (
    typeof req.body.email !== 'string' ||
    req.body.email.length > 254 ||
    !validator.isEmail(req.body.email.trim())
  )
    throw new AppError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  const email = req.body.email.trim().toLowerCase(),
    started = Date.now(),
    token = randomBytes(32).toString('hex');
  await inTransaction(async (session) => {
    const user = await User.findOne({ email, isActive: true })
      .select('+resetTokenHash +resetExpiresAt +resetRequestedAt')
      .session(session);
    if (
      !user ||
      (user.resetRequestedAt &&
        Date.now() - user.resetRequestedAt.getTime() < 60000)
    )
      return;
    user.resetTokenHash = digest(token);
    user.resetExpiresAt = new Date(Date.now() + 30 * 60000);
    user.resetRequestedAt = new Date();
    await user.save({ session });
    await EmailOutbox.updateMany(
      {
        user: user._id,
        kind: 'password_reset',
        status: { $in: ['pending', 'failed'] },
      },
      {
        $set: {
          status: 'cancelled',
          lastError: 'A newer recovery request replaced this link.',
        },
      },
      { session }
    );
    const admin = ['admin', 'superadmin'].includes(user.role);
    const url = new URL(appUrl(admin ? env.ADMIN_URL : env.FRONTEND_URL, 'reset-password'));
    url.hash = new URLSearchParams({ token }).toString();
    await enqueueEmail(
      {
        key: 'reset:' + user._id + ':' + user.resetTokenHash,
        kind: 'password_reset',
        group: 'customer',
        to: email,
        user: user._id,
        expiresAt: user.resetExpiresAt,
        data: {
          name: user.fullName,
          resetUrl: url.toString(),
          resetHash: user.resetTokenHash,
        },
      },
      session
    );
  });
  // Same text/status and minimum response interval for an existing, inactive or unknown address.
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 200 - (Date.now() - started)))
  );
  res.status(202).json({
    success: true,
    message:
      'If an active account uses this email, a password-reset link will be emailed to it. Check your inbox and spam folder.',
  });
});
export const resetPassword = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { token, password } = req.body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(
      400,
      'INVALID_RESET_LINK',
      'This reset link is invalid or expired. Request a new one.'
    );
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128
  )
    throw new AppError(
      400,
      'INVALID_PASSWORD',
      'Use a password between 8 and 128 characters.'
    );
  await inTransaction(async (session) => {
    const user = await User.findOne({
      resetTokenHash: digest(token),
      resetExpiresAt: { $gt: new Date() },
      isActive: true,
    })
      .select('+resetTokenHash +resetExpiresAt')
      .session(session);
    if (!user)
      throw new AppError(
        400,
        'INVALID_RESET_LINK',
        'This reset link is invalid or expired. Request a new one.'
      );
    user.password = password;
    user.authVersion = (user.authVersion || 0) + 1;
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;
    await user.save({ session });
    await EmailOutbox.updateMany(
      {
        user: user._id,
        kind: 'password_reset',
        status: { $in: ['pending', 'failed'] },
      },
      { $set: { status: 'cancelled', lastError: 'Recovery link was used.' } },
      { session }
    );
    const admin = ['admin', 'superadmin'].includes(user.role);
    const url = new URL(appUrl(admin ? env.ADMIN_URL : env.FRONTEND_URL, admin ? 'login' : 'account'));
    await enqueueEmail(
      {
        key: `password-changed:${user._id}:${user.authVersion}`,
        kind: 'password_changed',
        group: 'customer',
        to: user.email,
        user: user._id,
        data: { loginUrl: url.toString() },
      },
      session
    );
  });
  clearAuthCookie(res);
  res.json({
    success: true,
    message: 'Your password has been changed. Sign in with your new password.',
  });
});
