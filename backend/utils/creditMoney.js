import { AppError } from './AppError.js';

export function toKobo(value, { positive = false } = {}) {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !value.trim())
  )
    throw new AppError(400, 'INVALID_AMOUNT', 'Enter a valid amount.');
  const number = Number(value),
    kobo = Math.round(number * 100);
  if (
    !Number.isFinite(number) ||
    !Number.isSafeInteger(kobo) ||
    number < 0 ||
    Math.abs(number * 100 - kobo) > 0.00001 ||
    (positive && kobo <= 0)
  ) {
    throw new AppError(
      400,
      'INVALID_AMOUNT',
      positive
        ? 'Enter a payment greater than zero with at most two decimal places.'
        : 'Enter a non-negative amount with at most two decimal places.'
    );
  }
  return kobo;
}
export const naira = (kobo) => kobo / 100;

export function creditPhone(value) {
  if (typeof value !== 'string')
    throw new AppError(
      400,
      'INVALID_CUSTOMER_PHONE',
      'Enter a valid customer phone number.'
    );
  let key = value.replace(/[\s().-]/g, '');
  if (/^0\d{10}$/.test(key)) key = '+234' + key.slice(1);
  else if (/^234\d{10}$/.test(key)) key = '+' + key;
  if (!/^\+[1-9]\d{7,14}$/.test(key))
    throw new AppError(
      400,
      'INVALID_CUSTOMER_PHONE',
      'Use an 11-digit Nigerian number or an international number with its country code.'
    );
  return {
    phoneKey: key,
    phone:
      key.startsWith('+234') && key.length === 14 ? '0' + key.slice(4) : key,
  };
}
export function creditName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200)
    throw new AppError(400, 'CUSTOMER_REQUIRED', 'Enter the customer name.');
  return value.trim().replace(/\s+/g, ' ');
}
export const identityName = (value) => creditName(value).toLowerCase();
export function creditReason(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length < 3 ||
    value.trim().length > 500
  )
    throw new AppError(
      400,
      'REASON_REQUIRED',
      'Give a short reason for this balance change.'
    );
  return value.trim();
}
export function creditPaymentMethod(value) {
  if (value === undefined) return undefined;
  if (!['cash', 'transfer', 'pos_terminal'].includes(value))
    throw new AppError(
      400,
      'INVALID_PAYMENT_METHOD',
      'Choose cash, bank transfer or card terminal.'
    );
  return value;
}
