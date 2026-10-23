# Payments (RNX-35a, RNX-229)

Follows: D240 (one provider, AutoGoPay in RNX-229), D19, D23 (Starter and Pro are bought once), D36 (no credits-only state), D37 (snapshots are permanent), D46 (values are settings, not code), R-20 section 5.

This is the provider-independent core (the provider interface, orders, the one grant path, reconciliation, the limits and the kill switch, and the admin's manual reconciliation) and the AutoGoPay QRIS adapter (RNX-229, section 8). The checkout and billing screens (RNX-59), the back-office orders screen, refunds through a provider (RNX-63) and Enterprise invoices are not part of it.

## Guard-rails

- **No network in development or tests.** Development and the core's tests use `FakePaymentProvider`: no network, no provider key, no money. The AutoGoPay adapter is tested only over a fake transport with recorded fixtures and a dummy key (section 8); nothing in a test talks to a payment service.
- **Real-money tests are the Tech Lead's only.** No agent uses a real GoPay or AutoGoPay account, a real provider key or real money, and no account detail is written anywhere (D240).
- **Logs.** Nothing logs a provider key, a webhook signature or secret, a raw webhook body or an account detail. A provider error is logged by its class name only (it could carry a key). A test plants all of these and checks the log lines of a whole payments run (AC11).

## 1. The provider interface

`PaymentProvider` (`apps/api/src/app/payments/types/payment-provider.ts`) is everything provider-specific; nothing above it knows a provider's names or formats.

| Member | What it does |
|---|---|
| `name` | Stored on every order (`fake` or `autogopay`). |
| `minAmountRupiah`, `maxAmountRupiah` | The provider's own limits; checkout refuses an amount outside them (AutoGoPay: Rp1 to Rp10.000.000). |
| `createCharge({ orderId, amountRupiah, expiresAt, description })` | Returns the provider's reference (its transaction id), the payment code (a QR string, e.g. a dynamic QRIS that carries the amount, or a URL) and the provider's expiry. Called once per order; the core never retries it. |
| `getStatus(providerRef, { timeoutMs }?)` | The state (`paid`, `pending`, `expired`, `cancelled`, `unknown`), the amount paid and when. The adapter maps its own statuses (AutoGoPay "settlement" = `paid`; anything it cannot map = `unknown`). `timeoutMs` shortens the adapter's own total timeout (the webhook path, below). |
| `cancel(providerRef)` | Cancels a charge the core will not use (a charge whose reference could not be stored). |
| `verifyWebhook({ rawBody, headers })` | Checks the signature over the raw bytes (AutoGoPay: HMAC-SHA256 with its API key, compared in constant time) and reads the reported reference, state and amount. |

An adapter applies its own timeouts (AutoGoPay: 10 s total, section 8). The status check a webhook starts is given a shorter total timeout, `WEBHOOK_STATUS_TIMEOUT_MS` (5 s, D280), so the webhook answers within AutoGoPay's 10 s; the job and the admin keep the adapter's own. A thrown `createCharge` fails the order (502 to the buyer); a thrown `getStatus` counts as an `unknown` answer.

**Choosing the provider.** `PAYMENT_PROVIDER`, checked at boot (`main.ts`) before anything starts:

| Environment | Unset | `fake` | `autogopay` | Anything else |
|---|---|---|---|---|
| Development, test | `fake` | `fake` | only with a non-empty `PAYMENT_PROVIDER_API_KEY`, else refuses | refuses to boot |
| Production | refuses to boot | only with `PAYMENTS_FORCE_OFF=true` (payments can never run on the fake), else refuses | only with a non-empty `PAYMENT_PROVIDER_API_KEY`, else refuses | refuses to boot |

The refusal names the variable, never its value (RX-110 pattern).

The fake's webhook key is `PAYMENT_FAKE_WEBHOOK_SECRET` (a placeholder in `.env.example`; local development only). Without it no webhook verifies.

## 2. Orders, states and flags

Table `payment_orders`: the buyer, the offer version (a package version or a top-up pack version, exactly one), its USD price, the purchase rate with its date and source, the rupiah amount, the provider and its reference, the payment code, the status, the expiry, and the paid and last-webhook times.

| Status | Meaning |
|---|---|
| `pending` | Created; waiting for the payment. |
| `paid` | A status check said paid with the order's exact amount; credits granted once. |
| `expired` | The provider said expired. A payment that still arrives later grants (flagged `late`). |
| `cancelled` | The provider said cancelled. A payment that still arrives later with the order's amount grants once (flagged `late` when after the expiry): the money arrived. With another amount it fails with `amount_mismatch`, as a pending order would. |
| `failed` | The provider refused the charge, or a paid amount did not match (`amount_mismatch`). |

| Flag | Set when |
|---|---|
| `late` | Paid after the order's expiry. |
| `amount_mismatch` | A paid status reported another amount (even by Rp1); no grant, the payment is listed unmatched. |
| `unconfirmed` | A webhook said paid but the status check did not (yet). |
| `webhook_missed` | Paid, found by the reconciliation job or an admin, with no webhook seen. |
| `needs_review` | Three unknown status answers; the job stops checking it. |

`unmatched` is not an order flag: it is a row of `payment_unmatched_payments`, a payment the provider reported that grants nothing (reason `unknown_reference`: no order has that reference; or `amount_mismatch`). The buyer sees a failed order with `amount_mismatch` as `unmatched`.

**Audit.** Every status change and flag of an order is a row of `payment_order_changes` (event, status before and after, source `checkout`/`webhook`/`reconcile`/`admin`, the admin's id and reason), written in the same transaction as the change. Admin actions also write `admin_audit_log` rows. Every verified webhook is a row of `payment_webhook_events` with the SHA-256 of its raw body (the body itself is not kept); a call that does not verify is refused with 401 and not recorded.

## 3. Flow

1. **Checkout** `POST /api/v1/payments/checkout` (signed-in session), body `{ "offer": "package", "packageId" }` or `{ "offer": "top_up_pack", "packId" }`. In order:
   1. The kill switch (503 "Payments are paused; use an invitation code") and the pilot allow-list (403).
   2. The offer's current version from the catalog: a package must be one-time (Starter, Pro; D23); a top-up pack needs a package (D36: an active subscription or a bought package), else 403.
   3. The limits' settings (503 naming one that is not set).
   4. The rate quote (RNX-53), **before any transaction**: no rate, or one older than 7 days, is a 503 with nothing written and no provider call.
   5. One short transaction under a lock: today's (Jakarta day) pending and paid totals are summed, the limits checked (422 naming the limit: the provider's minimum or maximum, `paymentsMaxPerPaymentRupiah`, `paymentsMaxPerAccountPerDayRupiah`, `paymentsMaxPlatformPerDayRupiah`), and the pending order inserted with its price snapshotted.
   6. The provider's `createCharge`, outside any transaction. The answer is the order with its payment code and expiry.
2. **The buyer's order** `GET /api/v1/payments/orders/:id`: pending (with expiry and payment code), paid, expired, cancelled, failed or unmatched. Another user's order is 404. Credits never appear from a pending order.
3. **Webhook** `POST /api/v1/webhooks/payments` (public; the signature is checked in the handler on the raw body). Verified, recorded, then a status check of the order through the settlement path. **A webhook alone never grants.**
4. **Settlement** (the one path, shared by the webhook, the job and the admin): `getStatus` outside any transaction, then
   - `paid` with exactly the order's amount: **one grant transaction** — the order moves to `paid` once (a conditional update from `pending` or `expired`; a second caller finds it paid and stops), the purchase snapshot is written with the provider reference as its payment id and the order's quoted price, and one ledger entry (`plan_grant` for a package, `top_up` for a pack, the snapshot's credits, reference = the provider reference, the same value as the snapshot's payment id) with the idempotency key `payment:<provider>:<providerRef>`. A failure in any write rolls all of them back;
   - `paid` with another amount: `failed` + `amount_mismatch`, listed unmatched, no grant;
   - `expired` / `cancelled`: a pending order closes so;
   - `pending`: after a webhook that said paid, flagged `unconfirmed`;
   - `unknown` (or a thrown check): counted; at 3, `needs_review`.

## 4. The reconciliation job

Every `paymentsReconcileEveryMinutes` (a one-minute tick runs it when that many minutes have passed on the instance; not set: it does not run). It claims the provider's pending orders that are past their expiry or were named by a webhook, not in review, up to 100 per run, and checks each through the settlement path: a paid one grants (flagged `webhook_missed` if no webhook came, `late` if paid after expiry); expired or cancelled ones close; a pending one past its expiry counts as unknown. A check that throws is logged (the error's class only) and counted as `error`, and the run goes on with the next order.

**Several instances (Cloud Run).** Rows are claimed with `FOR UPDATE SKIP LOCKED` and a claim time (5 minutes, released after the check), so two runs check disjoint orders. Even if two checks of one order overlap (the job and a webhook), the grant's conditional update and the ledger idempotency key give exactly one grant.

## 5. Daily reconciliation routine (back office, API only for now)

Each morning, for yesterday's Jakarta day:

1. `GET /api/v1/admin/payments/orders?day=YYYY-MM-DD` (`credits:read`): the counts (pending, paid, late, expired, cancelled, failed, unmatched, amount_mismatch, unconfirmed, webhook_missed, needs_review), the orders, and the unmatched payments. `&state=<one of them>` lists only those.
2. `GET /api/v1/admin/payments/orders/export?day=YYYY-MM-DD` (`credits:read`, audited): the CSV (`orderId, providerRef, amountRupiah, createdAt, expiresAt, paidAt, lastWebhookAt, status, flags`), one line per order then one per unmatched payment. Compare it, order by order, with the GoPay Merchant app's transaction history (Riwayat) for the same day.
3. For an order still `pending` (or `needs_review`) that the merchant app shows as paid: `POST /api/v1/admin/payments/orders/:id/confirm` with `{ "reason" }` (`credits:adjust`, re-authenticated within 2 minutes). It asks the provider again and applies the answer through the same settlement path: a settlement with the order's amount grants once.
4. For an unmatched payment refunded to the buyer outside the API: `POST /api/v1/admin/payments/unmatched/:id/refunded` with `{ "note" }` (`credits:adjust`, re-authenticated).
5. A payment seen in the GoPay Merchant app but **unknown to the provider** (no order, no unmatched row): no new code. Use RNX-227's adjustment, `POST /api/v1/admin/credits/adjustments` (`credits:adjust`, re-authenticated), with the buyer as `target`, the credits the buyer paid for, a `reason`, the GoPay transaction id as `paymentReference`, and `gopay:<transaction id>` as the `idempotencyKey` so the same payment cannot be credited twice.
6. Note the day's **webhook-missed rate**: the `webhook_missed` count over the paid count. Above 5% of paid orders in a day is stop signal D6 of R-20a: one such day, keep checkout to the pilot allow-list; two days, turn payments off (`paymentsEnabled` false) and reconcile by hand.

No new staff permission (decision 81, D264): reads use `credits:read`, writes `credits:adjust`, set in one place, `apps/api/src/app/payments/config/admin-payment-permissions.ts`. Every action writes an `admin_audit_log` row (who, when, why).

## 6. Settings

Typed platform settings (registry `apps/api/src/app/offers/config/platform-settings.ts`), changed through `PUT /api/v1/admin/settings/:name` (RNX-226) without a deploy. **No value is set in code beyond "off"**; the values are the Tech Lead's (the R-20 proposals are only test values).

| Setting | Type | Not set |
|---|---|---|
| `paymentsEnabled` | boolean | off: checkout 503, webhooks recorded but nothing checked or granted, the job does not run |
| `paymentsMaxPerPaymentRupiah` | rupiah, ≥ 1 | checkout refused (503) |
| `paymentsMaxPerAccountPerDayRupiah` | rupiah, ≥ 1 | checkout refused (503) |
| `paymentsMaxPlatformPerDayRupiah` | rupiah, ≥ 1 | checkout refused (503) |
| `paymentsOrderExpiryMinutes` | minutes, ≥ 1 | checkout refused (503) |
| `paymentsReconcileEveryMinutes` | minutes, ≥ 1 | the job does not run |
| `paymentsAllowedUserIds` | list of user ids | everyone (an empty list too) |

Daily caps count the pending and paid orders created in the current Asia/Jakarta day. Environment: `PAYMENTS_FORCE_OFF=true` turns payments off whatever `paymentsEnabled` says; turning payments on again lets the job complete the orders whose webhooks came while they were off.

## 7. Invitation codes

Codes keep working. A credits-only (`topup`) code is redeemed only by an account with a package (an active subscription or a bought package, D36); a free account gets 403 and nothing is granted or used up.

## 8. The AutoGoPay provider (RNX-229)

`AutoGoPayProvider` (`apps/api/src/app/payments/providers/autogopay.provider.ts`): a dynamic QRIS per order through AutoGoPay's API (`https://v1-gateway.autogopay.site`, QRIS only, D240). **Fixtures only until the account exists:** no test calls the service; the adapter is tested over a fake transport answering recorded fixtures written from the documented shapes (`apps/api/test/autogopay-fixtures.ts`) with a dummy key. The first real call is the Tech Lead's pilot.

**Environment.**

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `autogopay` |
| `PAYMENT_PROVIDER_API_KEY` | The API key from the AutoGoPay dashboard. Sent as `Authorization: Bearer <key>` and also the webhook signing key. Required at boot when `PAYMENT_PROVIDER=autogopay` (missing, empty or blank: refuses to boot). Never logged, never in an error message or a response. |

**Calls** (JSON POST, Bearer key; never retried by the adapter):

| Call | Request | Read from the answer |
|---|---|---|
| `createCharge` | `POST /qris/generate` `{ amount }` (the order's exact rupiah amount; Rp1 to Rp10.000.000) | `transaction_id` → the provider reference, `qr_string` → the payment code, `expiry_time` → the expiry. `checkout_url` is read but not surfaced (the buyer is shown the QR string). Any non-2xx answer, a body without these fields, or an expiry without a time-zone offset throws: the order fails. |
| `getStatus` | `POST /qris/status` `{ transaction_id }` | `transaction_status`, `amount`, `paid_at` (null when absent). A non-2xx answer or a failed call throws (counted as `unknown`); a body it cannot read is `unknown`. |
| `cancel` | `POST /qris/cancel` `{ transaction_id }` | A non-2xx answer throws. |

**Status mapping.** `settlement` → `paid`, `pending` → `pending`, `expire` → `expired`, `cancel` → `cancelled`; anything else → `unknown`. A `settlement` without an amount is `unknown` too (it cannot be checked against the order; the next check retries it). The webhook's own `PAID` also maps to `paid` (only a reason to check; it never grants). A correctly signed webhook body that is not the expected shape is refused (401) and logged as one line, without the body.

**Webhook.** `POST /api/v1/webhooks/payments` with `X-Signature` = the hex HMAC-SHA256 of the **raw** body bytes, keyed with the API key, compared in constant time (the other documented headers, `X-Callback-Event: transaction.received` and `User-Agent: AutoGopay-Callback/1.0`, are not relied on). A missing or wrong signature, a body that differs by one byte (re-serialised JSON included), or a signed body that is not the documented shape (`transaction { transaction_id, status, amount }`) is not verified (401). AutoGoPay asks for a 200 within 10 s.

**Timeouts.** 10 s total per call (`AbortSignal.timeout`, the body read included); on the webhook path the status check gets 5 s (`WEBHOOK_STATUS_TIMEOUT_MS`, D280), so the webhook answers within AutoGoPay's 10 s. A check that times out there counts as `unknown` (the webhook still answers 200) and the reconciliation job completes the order with its own 10 s. The ticket's 5 s connect limit is not enforced separately: Node's built-in fetch exposes no connect timeout without adding the `undici` package, so the 10 s total bounds the connect as well.

**Shapes still to confirm in the pilot.** The docs show the field names but not every detail; these are assumed in the code and marked there: the answers are not wrapped (fields at the top level); `expiry_time` and `paid_at` are ISO 8601 date-times with an offset; `/qris/status` reports `transaction_status`, `amount` and `paid_at`; the status and cancel requests send `transaction_id`; amounts are whole-rupiah numbers; the signature is lowercase or uppercase hex; the generate request takes no merchant reference (the order id is not sent).

### What the provider can access (for the Tech Lead)

From R-20 sections 3 and 6 (an inference: AutoGoPay's docs do not say how a GoPay account is connected). AutoGoPay most likely holds a login session to the GoPay Merchant (GoBiz) account it is connected to and polls that account's transactions; the money is paid into that GoPay Merchant wallet and stays there until it is paid out, AutoGoPay does not hold it. What Renovix gives AutoGoPay is that connection; what AutoGoPay gives Renovix is the API key, which also signs the webhooks, so a leaked key could forge a "paid" webhook (harmless for credits: a webhook never grants without a status check, but the key must be rotated).

- **Rotate:** the API key (regenerate it in the AutoGoPay dashboard, put the new one in `PAYMENT_PROVIDER_API_KEY`, redeploy).
- **Cut it off:** set `PAYMENTS_FORCE_OFF=true` (checkout 503, nothing granted, webhooks still recorded), then revoke the API key and end AutoGoPay's session to the merchant account (log in again on the merchant's own device, change the login, disconnect the provider in the AutoGoPay dashboard). Reconcile afterwards with section 5.

No account detail (phone number, e-mail, merchant id, key) belongs in the repository, a log or a ticket.

## Known follow-ups

- Buying Starter or Pro writes the purchase snapshot and the `plan_grant`, but no entitlement row yet (docs/credits.md section 7): the agent and workspace gates still read `user_subscriptions`. The top-up pack check (D36) already counts a bought package.
