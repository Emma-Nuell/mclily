import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderEmail } from '../services/emailTemplates.js';
import env from '../config/env.js';
const directory = path.resolve(fileURLToPath(new URL('../../.test-data/email-previews/', import.meta.url)));
await mkdir(directory, { recursive: true });
const order = { user: 'preview-account', orderNumber: 'PREVIEW-ONLY', customer: { name: 'Sample customer', phone: 'Sample contact' },
  orderItems: [{ name: 'Everyday shirt', productType: 'retail', size: 'M', color: 'Navy', quantity: 1, subtotal: 20000 }, { name: 'Cotton fabric', productType: 'fabric', yards: 1.5, fabricColor: 'Blue', subtotal: 7500 }],
  pricing: { subtotal: 27500, deliveryFee: 2500, paymentFee: 700, totalAmount: 30700 }, payment: { status: 'paid' }, refundSummary: { status: 'completed', amount: 30700 } };
const resetUrl = new URL('/reset-password#token=preview-example-only', env.FRONTEND_URL).toString(), orderUrl = new URL('/checkout/confirmation?order=PREVIEW-ONLY', env.FRONTEND_URL).toString();
const examples = { password_reset: { name: 'Sample customer', resetUrl }, password_changed: { loginUrl: new URL('/account', env.FRONTEND_URL).toString() },
  order_placed: { order, orderUrl }, ...Object.fromEntries(['customer_paid', 'customer_preparing', 'customer_shipped', 'customer_delivered', 'customer_cancelled', 'customer_review', 'customer_refund', 'operations_created', 'operations_paid', 'operations_preparing'].map(kind => [kind, { order, orderUrl }])),
  technical_alert: { message: 'Preview: a payment needs reconciliation.', orderNumber: order.orderNumber }, smtp_test: {}, financial_summary: { periodStart: '2026-11-01', periodEnd: '2026-11-15', metrics: { 'Recorded online collections': 50000, 'Customer debt repayments': 5000, 'Recorded completed refunds': 2000, 'Recorded cash less refunds': 53000, 'Current customer debt': 15000 }, notes: ['Preview figures only. No business records were read.'] } };
for (const [kind, data] of Object.entries(examples)) { const message = renderEmail(kind, data); await writeFile(path.join(directory, kind + '.html'), message.html, 'utf8'); await writeFile(path.join(directory, kind + '.txt'), message.text, 'utf8'); }
await writeFile(path.join(directory, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>McLily email previews</title><style>body{font:16px/1.6 Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;background:#f6f5f1;color:#1f2622}a{display:block;padding:12px 0;color:#315b46}li{margin-bottom:4px}</style></head><body><h1>McLily email previews</h1><p>Sample content only. No emails were sent and no business data was read.</p><ul>${Object.keys(examples).map(kind => `<li><a href="${kind}.html">${kind.replaceAll('_', ' ')}</a> <a href="${kind}.txt">Plain text</a></li>`).join('')}</ul></body></html>`, 'utf8');
console.log('Email previews generated:', path.join(directory, 'index.html'));
