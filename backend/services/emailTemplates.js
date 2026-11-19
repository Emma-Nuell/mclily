import env from '../config/env.js';
import { appUrl } from '../vendor/publicUrls.mjs';
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );
const money = (value) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
const cleanSubject = (value) =>
  String(value)
    .replace(/[\r\n]/g, ' ')
    .slice(0, 180);
export function trustedEmailUrl(value) {
  const parsed = new URL(value),
    allowed = [new URL(env.FRONTEND_URL).origin, new URL(env.ADMIN_URL).origin];
  if (
    !allowed.includes(parsed.origin) ||
    !['https:', ...(env.NODE_ENV !== 'production' ? ['http:'] : [])].includes(
      parsed.protocol
    )
  )
    throw new Error('Untrusted email link origin.');
  return parsed.toString();
}
const orderLink = (order) =>
  order.user
    ? new URL(
        '/checkout/confirmation?order=' + encodeURIComponent(order.orderNumber),
        env.FRONTEND_URL
      ).toString()
    : null;
const adminLink = () => appUrl(env.ADMIN_URL, 'orders');
const orderLines = (order) =>
  (order.orderItems || []).map(
    (item) =>
      `${item.name} · ${item.productType === 'fabric' ? `${item.yards ?? item.halfYards / 2} yd · ${item.fabricColor || ''}` : [item.quantity + ' ×', item.size, item.color].filter(Boolean).join(' ')} · ${money(item.subtotal)}`
  );
const sumLines = (order) => [
  ...(order.delivery?.label
    ? [`Delivery / collection: ${order.delivery.label}`]
    : []),
  ...(order.delivery?.method === 'pickup'
    ? [`Collection details: ${order.delivery.description}`]
    : []),
  `Items: ${money(order.pricing.subtotal)}`,
  `Delivery collected online: ${money(order.pricing.deliveryFee)}`,
  `Website service charge: ${money(order.pricing.paymentFee)}`,
  `${order.delivery?.method === 'courier' ? 'Online payment total' : 'Order total'}: ${money(order.pricing.totalAmount)}`,
  ...(order.delivery?.method === 'courier'
    ? [
        order.delivery.courierStatus === 'confirmed'
          ? `Pay ${order.delivery.courierName} on delivery: ${money(order.delivery.courierFee)}. This is separate from the online payment.`
          : 'Delivery fee is not included. Pay the courier on delivery. McLily will confirm the cost with you before preparation or dispatch.',
      ]
    : []),
];
export function renderEmail(kind, data) {
  let title,
    paragraphs = [],
    lines = [],
    cta,
    link;
  if (kind === 'password_reset') {
    title = 'Reset your McLily password';
    paragraphs = [
      `Hi ${data.name || 'there'},`,
      'Use the link below to choose a new password. It expires in 30 minutes and can be used once.',
      'If you did not request this, you can ignore this email. Your password has not changed.',
    ];
    cta = 'Choose a new password';
    link = data.resetUrl;
  } else if (kind === 'password_changed') {
    title = 'Your McLily password was changed';
    paragraphs = [
      'Your password was successfully changed. Previous sign-in sessions have been signed out.',
      'If this was not you, reset your password again and contact McLily on WhatsApp: +2348037256630.',
    ];
    cta = 'Sign in';
    link = data.loginUrl;
  } else if (kind === 'order_placed') {
    title = `Order received · ${data.order.orderNumber}`;
    paragraphs = [
      `Hi ${data.order.customer.name},`,
      'Your order has been created. This email is not proof of payment. We prepare orders after the server verifies payment and stock.',
      'Keep your private order link safe; anyone with the link can view this order.',
    ];
    lines = [...orderLines(data.order), ...sumLines(data.order)];
    link = data.orderUrl;
    cta = 'View your order';
  } else if (kind.startsWith('customer_') || kind.startsWith('operations_')) {
    const order = data.order,
      operations = kind.startsWith('operations_'),
      state = kind.split('_').slice(1).join('_');
    const messages = {
      created: [
        'New order received',
        'An order was created and is awaiting verified payment. Do not prepare it yet.',
      ],
      paid: [
        'Payment confirmed',
        order.delivery?.method === 'courier' &&
        order.delivery.courierStatus !== 'confirmed'
          ? 'Payment is verified. McLily will confirm the courier fee and your acceptance before preparing or dispatching this order.'
          : 'Payment is verified. Your order is ready for preparation.',
      ],
      courier: [
        'Courier details confirmed',
        'Your agreed delivery fee is paid separately to the courier on delivery. It has not been added to your online payment.',
      ],
      preparing: ['Order preparation', 'Your order is being prepared.'],
      shipped: ['Order on delivery', 'Your order is on its way.'],
      delivered: [
        'Order delivered',
        'Your order is recorded as delivered. Thank you for shopping with McLily.',
      ],
      cancelled: [
        'Order cancelled',
        'The order was cancelled. Cancellation alone does not confirm a refund.',
      ],
      review: [
        'Order needs attention',
        order.payment?.status === 'paid'
          ? 'Payment is confirmed, but availability needs a check before preparation. McLily will contact you.'
          : 'The payment details need a check. Please contact McLily with your order reference.',
      ],
      refund: [
        'Refund update',
        `Refund status: ${order.refundSummary?.status}. ${order.refundSummary?.status === 'completed' ? 'The refund is recorded as sent. Bank arrival timing may vary.' : 'This does not yet confirm money has reached the customer.'}`,
      ],
    };
    const [heading, message] = messages[state] || [
      'Order update',
      'There is an update to this order.',
    ];
    title = `${heading} · ${order.orderNumber}`;
    paragraphs = operations
      ? [
          message,
          `Customer: ${order.customer.name} · ${order.customer.phone}`,
          'Open the admin to check the order and its next action.',
        ]
      : [`Hi ${order.customer.name},`, message];
    lines = [
      ...orderLines(order),
      ...sumLines(order),
      ...(state === 'refund'
        ? [`Refund amount: ${money(order.refundSummary?.amount)}`]
        : []),
    ];
    link = operations ? adminLink() : data.orderUrl || orderLink(order);
    cta = operations ? 'Open orders' : 'View your order';
  } else if (kind === 'technical_alert') {
    title = 'McLily technical attention needed';
    paragraphs = [
      data.message || 'A payment or background task requires attention.',
      'Check the admin and service logs. No password, payment secret or private access token is included in this alert.',
    ];
    if (data.orderNumber) lines = [`Order: ${data.orderNumber}`];
    link = adminLink();
    cta = 'Open the admin';
  } else if (kind === 'financial_summary') {
    title = 'McLily · your fortnightly financial summary';
    paragraphs = [
      `Period: ${data.periodStart} to ${data.periodEnd} (end exclusive).`,
      'These are recorded sales and cash movements, not profit or a bank settlement statement.',
    ];
    lines = Object.entries(data.metrics).map(
      ([label, value]) =>
        `${label}: ${typeof value === 'number' ? money(value) : value}`
    );
    paragraphs.push(...(data.notes || []));
    link = appUrl(env.ADMIN_URL, 'pos?view=history');
    cta = 'View sales';
  } else if (kind === 'smtp_test') {
    title = 'McLily email connection test';
    paragraphs = [
      'This is a requested test of the McLily email configuration. No order or payment was created.',
    ];
  } else throw new Error('Unknown email template.');
  if (link) link = trustedEmailUrl(link);
  const text = [
    title,
    '',
    ...paragraphs,
    '',
    ...lines,
    ...(link ? ['', `${cta}: ${link}`] : []),
    '',
    'McLily · Style. Quality. Convenience.',
    'WhatsApp: +2348037256630',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#f6f5f1;color:#1f2622;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e1e4db;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 24px;font-size:24px;font-weight:bold">McLily</p><h1 style="font-size:23px;line-height:1.3;margin:0 0 24px">${escape(title)}</h1>${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.7">${escape(p)}</p>`).join('')}${lines.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">${lines.map((line) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e1e4db;font-size:14px;line-height:1.6">${escape(line)}</td></tr>`).join('')}</table>` : ''}${link ? `<p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;background:#315b46;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${escape(cta)}</a></p><p style="font-size:12px;overflow-wrap:anywhere">Or copy this link: <a href="${escape(link)}">${escape(link)}</a></p>` : ''}<p style="margin-top:32px;padding-top:20px;border-top:1px solid #e1e4db;font-size:12px;color:#5d655f">Style. Quality. Convenience.<br>WhatsApp: +2348037256630</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: cleanSubject(title), text, html };
}
