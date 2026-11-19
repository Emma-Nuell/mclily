# McLily E-Commerce — Development Verification Checklist

> **Purpose**: This checklist is a **second‑pass verification layer** for the McLily project. It complements `BRAIN.md` and `ROADMAP.md` by stress‑testing edge cases, concurrency, security, and UI quality. Use it during development and before launch.  
> **How to use**:  
> - Treat **Backend & Data Integrity** as non‑negotiable. Race conditions in inventory and payment webhooks are the #1 way e‑commerce MVPs lose money.  
> - Use the **Apple HIG principles** as a design filter, not just a style guide.  
> - Every checkbox should have a corresponding Playwright or API test. If you can’t test it, you can’t trust it.  
> - Mark `[x]` when the agent has implemented **and** verified via test.

---

## 1. Backend — Core API & Data Integrity

### 1.1 Database & Transactions

| Done | # | Check | Why it matters / How to verify |
|------|---|-------|-------------------------------|
| [x] | 1.1.1 | **Stock decrement is atomic *and* conditional** | Use `findOneAndUpdate({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`. Do **not** do `findOne` → check → `save()`. Two concurrent requests can both pass the check and oversell. |
| [x] | 1.1.2 | **Order save and stock decrement are in a single transaction** | If you decrement stock *before* `order.save()` and the save fails, you lose inventory with no order record. Wrap both in `session.withTransaction()` or implement a compensating rollback. |
| [x] | 1.1.3 | **Fabric yardage uses the smallest sellable unit as an integer** | Floating‑point decimals (e.g., `2.5` yards) cause rounding errors. Store **half‑yards as integers** (e.g., 5 = 2.5 yd) or use `Decimal128`. Convert at the API boundary. |
| [x] | 1.1.4 | **Optimistic concurrency is used for multi‑step flows** | If you must read → compute → write (e.g., applying a credit installment), use a `__v` version field and retry on conflict. `$inc` alone is not enough for conditional logic. |
| [x] | 1.1.5 | **Unique indexes are in place** | `slug`, `email`, `phone`, `paystackReference` must have unique indexes. Duplicate webhooks or retries must be idempotent. |
| [x] | 1.1.6 | **Transactions are *actually* available** | MongoDB transactions require a **replica set**. Verify your Atlas tier or local setup supports them. If not, implement compensation logic explicitly. |

### 1.2 Payments & Webhooks

| Done | # | Check | Why it matters / How to verify |
|------|---|-------|-------------------------------|
| [x] | 1.2.1 | **Paystack signature verified against the *raw* body** | Do **not** `JSON.parse` before verifying. Use `crypto.createHmac('sha512', secret).update(rawBody).digest('hex')` and `crypto.timingSafeEqual`. |
| [x] | 1.2.2 | **Webhook is idempotent** | Paystack retries webhooks for up to 72 hours. Store processed `event.id` or `reference` and return `200` if already handled. Do **not** decrement stock twice. |
| [x] | 1.2.3 | **Webhook responds `200` immediately, then processes asynchronously** | Paystack times out after 30 seconds. Return `200` immediately and enqueue or process in the background. |
| [x] | 1.2.4 | **Transaction is re‑verified server‑side before fulfillment** | Do not trust the webhook payload alone. Call `GET /transaction/verify/:reference` to confirm status and amount before marking paid. |
| [ ] | 1.2.5 | **Source IP allowlisting is configured** | Paystack’s IPs are `52.31.139.75`, `52.49.173.169`, `52.214.14.220`. Allowlist them at the firewall or in Express middleware. |
| [ ] | 1.2.6 | **Failed payment does *not* leave stock reserved forever** | If payment fails after stock reservation, a background job or webhook handler must **release the stock** after a timeout. |

### 1.3 Security (API & Auth)

| Done | # | Check | Why it matters / How to verify |
|------|---|-------|-------------------------------|
| [x] | 1.3.1 | **JWT is in an `HttpOnly`, `Secure`, `SameSite` cookie** | Never in `localStorage`. Use `SameSite=Lax` or `Strict` to mitigate CSRF. |
| [x] | 1.3.2 | **JWT algorithm is locked** | Explicitly allow only `HS256` (or `RS256`). Reject `alg: none`. Validate `iss` and `aud` if applicable. |
| [x] | 1.3.3 | **Auth routes are rate‑limited per IP *and* per user** | Use `express-rate-limit` or Redis. Login, register, and OTP endpoints need stricter limits. |
| [x] | 1.3.4 | **Input validation on *every* request body and query** | Use Zod or Joi. Reject unknown fields (`additionalProperties: false`). Bound numeric inputs (e.g., `limit` max 100). |
| [x] | 1.3.5 | **Authorization is object‑level, not just role‑level** | A user must not be able to read/modify another user’s order by changing the ID. Test IDOR explicitly. |
| [ ] | 1.3.6 | **Password reset does not leak account existence** | Always return the same message regardless of whether the email/phone exists. |
| [x] | 1.3.7 | **No secrets in code or client bundles** | `.env` is git‑ignored. Paystack secret, Cloudinary API secret, Telegram token, and SMTP password are server‑only. |
| [x] | 1.3.8 | **CORS is restrictive** | Only allow your storefront and admin origins. Do not use `*` for credentialed requests. |
| [x] | 1.3.9 | **Helmet / security headers are enabled** | `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, etc. |
| [x] | 1.3.10 | **File upload validation** | MIME type, size limit, and extension check. Cloudinary signed uploads only. Do not accept arbitrary URLs. |

### 1.4 Core Business Endpoints

| Done | # | Check | Why it matters / How to verify |
|------|---|-------|-------------------------------|
| [x] | 1.4.1 | `GET /api/products` supports **typeahead search with debounce‑friendly pagination** | Return `limit`, `page`, `total`, `hasMore`. Do not return 10k results. |
| [x] | 1.4.2 | **Fabric filtering works with material *and* color swatches** | A fabric can have multiple colors, each with its own `rollStockYards`. The API must expose stock per swatch. |
| [x] | 1.4.3 | **POS endpoint does not allow negative stock** | Walk‑in sales must atomically decrement stock. Credit sales must still reserve stock. |
| [ ] | 1.4.4 | **Review endpoint enforces verified purchase** | Check that the user has a `delivered` order containing the product. Recalculate product `rating` and `reviewsCount` after moderation. |
| [x] | 1.4.5 | **Sitemap endpoint does not include admin/checkout routes** | Only public products, fabrics, categories, and content pages. |
| [x] | 1.4.6 | **Health endpoint does *not* leak internals** | `GET /api/health` should return `{ status: 'ok' }`, not DB connection strings or version numbers. |

---

## 2. Frontend — Customer Storefront & Admin

### 2.1 State & Cart Integrity

| Done | # | Check | Why it matters |
|------|---|-------|----------------|
| [x] | 2.1.1 | **Cart state is persisted and re‑validated on checkout** | Prices and stock can change while items sit in the cart. Re‑fetch and re‑validate before creating the order. |
| [x] | 2.1.2 | **Fabric quantity in the cart is a multiple of 0.5** | Enforce at UI *and* backend. Do not trust the client. |
| [x] | 2.1.3 | **Guest checkout creates an order without requiring an account** | The `userId` is optional. Do not block checkout for unregistered users. |
| [x] | 2.1.4 | **Delivery tier calculation is deterministic** | Lagos Mainland vs. Island vs. Abuja vs. Interstate vs. Pickup. Free pickup should zero out delivery fees. |
| [x] | 2.1.5 | **Low‑stock “Only X left!” text is driven by the same threshold as admin alerts** | Default: 5 retail, 3 fabric yards. Do not hard‑code in two places. |

### 2.2 Admin Dashboard

| Done | # | Check | Why it matters |
|------|---|-------|----------------|
| [x] | 2.2.1 | **Quick Post form does not allow negative stock or price** | Validation on the client *and* server. |
| [x] | 2.2.2 | **POS sale atomically updates stock** | A double‑tap on “Record Sale” must not decrement twice. Disable the button on first click and handle idempotency. |
| [x] | 2.2.3 | **Order status transitions are irreversible where appropriate** | You can go `pending → processing → shipped → delivered`, but not `delivered → pending` without an admin override. |
| [x] | 2.2.4 | **Admin routes are protected by role *and* auth** | `verifyAdmin` must check both JWT validity and `role` in DB. |
| [x] | 2.2.5 | **Image reordering in Quick Post is reflected in the product’s `images` array order** | The first image is the hero/OG image. |

### 2.3 SEO & Social Previews

| Done | # | Check | Why it matters |
|------|---|-------|----------------|
| [x] | 2.3.1 | **Every product/fabric page has server‑rendered OG tags** | SPA crawlers (WhatsApp, Telegram) do not execute JS. Use the edge interceptor or SSR meta injection. |
| [x] | 2.3.2 | **`og:image` is an absolute URL and at least 1200×630** | Cloudinary transformations should generate a social card size. |
| [x] | 2.3.3 | **JSON‑LD `Product` schema includes `availability`** | `InStock`, `OutOfStock`, `LimitedAvailability`. Do not hard‑code `InStock`. |
| [x] | 2.3.4 | **Canonical URLs are self‑referencing and exclude query params** | `/product/shirt?color=red` should canonicalize to `/product/shirt`. |
| [x] | 2.3.5 | **`robots.txt` disallows `/admin`, `/checkout`, `/account`, `/api`** | Do not accidentally index sensitive routes. |

---

## 3. UI/UX — Apple Fluid Design & Anti‑Generic‑AI Filters

### 3.1 Apple HIG Principles as a Filter

| Done | # | Check | Why it matters |
|------|---|-------|----------------|
| [x] | 3.1.1 | **Content over chrome** | Remove heavy borders, gradients, and decorative backgrounds. Let product photography be the hero. |
| [x] | 3.1.2 | **Semantic colors, not hard‑coded hex** | Use `label`, `secondaryLabel`, `systemBackground`, `separator` equivalents. Hard‑coding `#0A0A0A` everywhere breaks dark mode and accessibility. |
| [x] | 3.1.3 | **Motion communicates meaning, not decoration** | A spring should indicate a sheet’s origin or a button’s press. Do not animate every element on scroll. Honor `prefers-reduced-motion`. |
| [x] | 3.1.4 | **Typography weights are Regular/Medium/Semibold/Bold** | Apple explicitly advises avoiding Ultralight/Thin/Light for body text. Tight tracking is fine for display, but body text must be readable. |
| [x] | 3.1.5 | **Accessibility is built in from day one** | Contrast ratio ≥ 4.5:1, Dynamic Type support, focus states, accessible labels on icon‑only buttons. |
| [x] | 3.1.6 | **Safe areas and `100dvh` are respected** | The floating bottom nav must not overlap the home indicator. Test on iPhone with notch. |

### 3.2 Anti‑Generic‑AI UI Tips

| Done | # | Tip | Example / Rationale |
|------|---|-----|---------------------|
| [x] | 3.2.1 | **Do not use the default purple‑blue gradient** | This is the single most common AI UI cliché. Your monochrome palette is already a strong differentiator—stick to it. |
| [x] | 3.2.2 | **Use asymmetrical or editorial layouts for heroes** | A centered headline over a full‑bleed image is generic. Try a split‑screen with a model cropped off‑center, or a typographic hero with an offset product card. |
| [x] | 3.2.3 | **Avoid “three cards in a row” for every section** | Vary the rhythm: a large feature card + two stacked cards; a horizontal scroll for categories; a masonry grid for lookbook. |
| [x] | 3.2.4 | **Give the bottom nav a *reason* to float** | If it’s frosted and floating, it should have a subtle shadow that increases on scroll, or a magnetic snap to the active tab. Do not just copy the iOS tab bar. |
| [x] | 3.2.5 | **Use real product photography, not placeholders** | Google Flow prompts are already in your plan—use them early. Generic AI UI often uses abstract shapes or gradient blobs. |
| [x] | 3.2.6 | **Micro‑copy should sound like a brand, not a template** | Instead of “Shop Now,” try “Find Your Fit” or “New Drops.” Instead of “Add to Cart,” try “Add to Bag.” McLily’s motto is *Style. Quality. Convenience.*—let the copy reflect that. |
| [x] | 3.2.7 | **Fabric textures need a zoom‑first interaction** | A standard product gallery is generic. For fabrics, the default state should be a close‑up weave texture with a subtle “pinch to inspect” hint. |
| [x] | 3.2.8 | **Tailoring CTA should feel like a conversation, not a form** | The WhatsApp handoff is a strength—make the button look like a chat bubble, not a generic “Contact Us” button. Pre‑fill the message with the product the user was viewing. |
| [x] | 3.2.9 | **Dark mode is not just inverted colors** | Elevated surfaces should be lighter, not darker. Shadows should be less prominent. Test both modes on every component. |
| [x] | 3.2.10 | **Avoid stock illustrations and generic icons** | Use SF Symbols or custom line icons with consistent stroke weight. Do not mix filled and outlined icons in the same nav. |

---

## 4. Testing — Playwright & API Integration

| Done | # | Check | How to verify |
|------|---|-------|---------------|
| [ ] | 4.1 | **Concurrent order test** | Fire two simultaneous orders for the last unit. Exactly one should succeed. The other must receive `409 Conflict` or `OutOfStock`. |
| [x] | 4.2 | **Webhook replay test** | Send the same Paystack `charge.success` payload twice. Stock must decrement only once. |
| [ ] | 4.3 | **Transaction rollback test** | Simulate `order.save()` failure after stock decrement. Verify stock is restored and no order exists. |
| [x] | 4.4 | **Auth flow test** | Login, access protected route, logout, verify cookie is cleared and token is rejected. |
| [x] | 4.5 | **Guest checkout test** | Complete checkout without logging in. Verify order is created with `userId: null` and email is sent. |
| [x] | 4.6 | **Fabric half‑yard test** | Order 1.5 yards. Verify stock is decremented by the correct integer unit and the receipt displays 1.5 yd. |
| [x] | 4.7 | **Playwright mobile visual test** | iPhone `390×844`: verify floating bottom nav, safe area, frosted header, bottom‑sheet filter, and cart drawer spring. |
| [x] | 4.8 | **Playwright desktop visual test** | `1440×900`: verify sticky header, search typeahead, product grid, and filter sidebar. |
| [x] | 4.9 | **Dark/light mode toggle test** | Toggle theme on every major page. Verify no hard‑coded colors break contrast. |
| [x] | 4.10 | **Sitemap and OG tag test** | Request `/api/seo/sitemap.xml` and a product page with a crawler user‑agent. Verify OG tags are present in the raw HTML. |

---

## 5. DevOps & Operational Readiness

| Done | # | Check | Why it matters |
|------|---|-------|----------------|
| [x] | 5.1 | **CI pipeline runs backend tests, frontend build, and admin build** | Your `.github/workflows/ci.yml` already covers this—ensure the test command includes the race condition and webhook tests. |
| [x] | 5.2 | **Environment variables are validated at startup** | Use a schema (Zod) to fail fast if `PAYSTACK_SECRET_KEY`, `MONGODB_URI`, etc. are missing. |
| [ ] | 5.3 | **Logging does not log PII or secrets** | Mask emails, phone numbers, and payment references in production logs. |
| [ ] | 5.4 | **Backup strategy for MongoDB** | Daily automated backups. Test a restore before launch. |
| [x] | 5.5 | **Cloudinary upload presets are signed** | Do not allow unsigned uploads from the client. Use a backend signature endpoint. |
| [x] | 5.6 | **Rate limiting is applied globally, not just on auth** | A scraping bot can hammer `/api/products`. Use a reasonable global limit (e.g., 100 req/min per IP). |
| [x] | 5.7 | **Error responses are standardized** | `{ success: false, message: '...', code: 'OUT_OF_STOCK' }`. Do not leak stack traces in production. |

---

## 6. The “Agent Check” Quick Summary

If your agent only remembers one thing from this checklist, it should be these five:

1. **Atomic conditional stock decrement + transaction with order save**—prevents overselling and lost inventory.
2. **Paystack webhook: raw body HMAC‑SHA512 verification + idempotency**—prevents fake payments and double‑decrements.
3. **JWT in HttpOnly cookie + rate limiting + input validation**—the baseline security triad.
4. **Fractional fabric inventory stored as integers**—prevents the 1.9999 yards bug.
5. **Apple HIG judgment: content over chrome, semantic colors, purposeful motion**—prevents the generic AI UI look.

---

> **Remember**: This checklist is intentionally *not* a replacement for your `BRAIN.md` and `ROADMAP.md`—it’s the **stress test** for them. Re‑run it at the end of each milestone.