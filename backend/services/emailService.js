import nodemailer from 'nodemailer';
import validator from 'validator';
import env from '../config/env.js';
export function emailRecipients(group) {
  const setting =
    {
      operations: env.EMAIL_OPERATIONS_TO,
      technical: env.EMAIL_TECHNICAL_TO,
      financial: env.EMAIL_FINANCIAL_TO,
    }[group] || '';
  return [
    ...new Set(
      setting
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => validator.isEmail(value))
    ),
  ];
}
export function emailConfiguration() {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter(
    (name) => !env[name] || /^(your_|replace_|.*xxxxxxxx)/i.test(env[name])
  );
  if (
    !validator.isEmail(
      (env.SMTP_FROM || '').match(/<([^>]+)>/)?.[1] || env.SMTP_FROM || ''
    )
  )
    missing.push('SMTP_FROM (valid mailbox)');
  for (const group of ['operations', 'technical', 'financial'])
    if (!emailRecipients(group).length)
      missing.push('EMAIL_' + group.toUpperCase() + '_TO');
  if (env.SMTP_REPLY_TO && !validator.isEmail(env.SMTP_REPLY_TO))
    missing.push('SMTP_REPLY_TO (valid mailbox)');
  for (const name of ['FRONTEND_URL', 'ADMIN_URL']) {
    try {
      const url = new URL(env[name]);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        (env.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        missing.push(name + ' (trusted HTTPS URL)');
    } catch {
      missing.push(name + ' (valid URL)');
    }
  }
  return {
    enabled: env.EMAIL_ENABLED,
    configured: !missing.length,
    missing,
    port: env.SMTP_PORT,
    encryption: env.SMTP_PORT === 465 ? 'TLS' : 'STARTTLS',
    from: env.SMTP_FROM,
    replyTo: env.SMTP_REPLY_TO || '',
    recipients: Object.fromEntries(
      ['operations', 'technical', 'financial'].map((group) => [
        group,
        emailRecipients(group),
      ])
    ),
  };
}
let cached, signature;
export function smtpTransport() {
  const status = emailConfiguration();
  if (!status.enabled || !status.configured)
    throw new Error('SMTP delivery is disabled or not fully configured.');
  const current = [
    env.SMTP_HOST,
    env.SMTP_PORT,
    env.SMTP_USER,
    env.SMTP_PASS,
  ].join('|');
  if (!cached || current !== signature) {
    cached?.close();
    cached = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    signature = current;
  }
  return cached;
}
export async function sendEmail(message) {
  return smtpTransport().sendMail({
    ...message,
    from: env.SMTP_FROM,
    ...(env.SMTP_REPLY_TO ? { replyTo: env.SMTP_REPLY_TO } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function verifySmtp() {
  return smtpTransport().verify();
}
