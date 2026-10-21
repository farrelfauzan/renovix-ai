# Credits: ledger, tier rates and locked-state rules

Status: reviewed design for RX-19 (Notion ticket RX-19, PRD 02). No code and no migration in this document. Read on 2026-10-14 against main `d612bb9`.

**Purpose.** Credits are the single meter for everything a user does on Renovix AI. This document fixes what a credit is, how a model call turns into credits, what a ledger entry holds, and how reserve, settle and release work, so that RX-20, RX-21, RX-22, RX-29, RX-30, RX-31, RX-58, RX-86 and RX-121 build one thing. The ledger's shape is hard to undo once it holds money, so it is reviewed here before any code.

## What you are approving

These are the choices that are hard to change once the ledger holds real money. Everything else in the document follows from them or from a decision already made.

1. **The ledger entry fields and the eight invariants** (section 2), including "balance = sum of entries" and "a balance is read from one row, never by summing entries".
2. **The meaning of the rates** (section 1): a tier rate is an absolute number of credits per 1,000,000 tokens of one token kind (new input, cached input, output). Standard is 1 / 1 / 1. The usage mix in the credit definition sets the dollar cost of a credit, not the number of credits.
 3. **The rounding rule** (section 2.3): amounts are exact multiples of 0.000001 credit; each model call is rounded once, up, on the sum of its three token kinds. Decided (D115), item 3.
 4. **Reserve, settle and release** (section 3): a reservation is a hold on the account row, not a ledger entry; every model call writes exactly one usage entry; a provider error is charged 0. Decided (D115), items 4 and 5.
 5. **The peer-agent run numbers** (section 13): one hold per run of min(per-run cap, available balance), the pre-run estimate formula, the budget-stop test before each model call, the default cap of 10 credits and a floor of 1 credit. Decided (D115), item 7.
6. **The Frontier rates** (sections 1 and 14): the proposed table uses 29 / 29 / 42 (new / cached / output), recomputed with R-5's method; PRD 02 has 17 / 17 / 25. Open item 1.

## Open items

Items 1 to 10 are questions this document needed answered; each stated a recommendation, marked PROPOSED, until the Tech Lead approved — items 1 to 10 were approved on D115 (confirmed on D120). Items 11 to 14 are the open decisions D1, D2, D18 and D27: this document gives them **no value** anywhere.

| # | Question | Options | Recommendation | Tickets that wait |
|---|---|---|---|---|
| 1 | Frontier rates (D112 item 38, R-5). | (a) PRD 02: 17 / 17 / 25 (new / cached / output). (b) Recomputed with R-5's method: 29 / 29 / 42. (c) The review report's method on today's prices: 14 / 7 / 17. | (b). D111 puts every tier on every paid package by default, so the PRD's zero-Frontier margin assumption no longer holds, and at 17 / 17 / 25 a Frontier credit costs $0.1993 to serve against about $0.12 planned (section 14). The Tech Lead's approval of this document settles the rate, and RX-21 seeds what he approves. If he keeps 17 / 17 / 25, only the Frontier rows of the tier table and the Frontier example in section 1.5 change; the ledger examples use no Frontier model. | RX-21, RX-22, RX-86 (allowed tiers), RX-47 (model copy) |
| 2 | Rate shape. Standard charges every token kind the same, and in Advanced and Premium a cached input token costs more than a new one (6 > 5, 20 > 10). So the cost of serving one credit depends on a request's mix (section 1.5). | (a) Keep the PRD 02 shape in v1. (b) Cost-shaped rates (Standard rates proportional to provider prices, then tier multipliers). | (a) for v1, because it is the decided text and RX-21 seeds it. Revisit with the pilot's measured mix (RX-45). The estimate rule in section 3 already uses max(new rate, cached rate) so the cached > new case cannot under-reserve. | RX-21, RX-45 |
| 3 | Precision and rounding. | (a) Micro-credits (0.000001), each call rounded once, up, on the sum (section 2.3). (b) Round per token kind. (c) Round at settle only. | (a). One rounding per call keeps every usage entry exact, and the balance moves by exactly the entry's amount, which removes the 0.000001 drift QA saw (D106). | RX-20, RX-21, RX-22 |
| 4 | Reservation as a hold on the account row, not as ledger entries. | (a) Hold (`held` column and a reservation row). (b) Reserve and release written as ledger entries. | (a). One ledger entry per model call instead of three per request, and statements show only real money movements. | RX-20, RX-22 |
| 5 | What a provider error costs. | (a) Charge 0, before the first token and mid-stream; record the reported tokens as `uncharged`. (b) Charge the tokens the provider reports for a partial answer. | (a). It follows RX-22's "release on failure" and today's full refund on provider failure; the platform's cost stays visible in `uncharged`. | RX-22, RX-23 |
| 6 | Warning trigger. RX-19's Scope still says "low-credit thresholds at 20%, 10% and 5%" (D9, D42); D45 and D47 (later) replace percentages with a projected run-out date. | (a) Projection only (section 12). (b) Keep percentages as well. | (a). D45 says "instead of a percentage of an arbitrary base", D47 approved the projection rules, and RX-30 was rewritten for them. Record that D9's percentages are superseded and correct the RX-19 Scope line. | RX-30, RX-59, RX-86 |
| 7 | Per-run credit cap and the run hold. | Default cap 10 credits (PRD 10 Q5 recommendation), floor 1 credit, hold = min(cap, available), estimate formula in section 13. | Accept as written. PRD 10 section 11 lists the 10-credit default as assumed (no usage data yet); it is a platform setting and can move. | RX-22, RX-86, RX-121 |
| 8 | "Seats" in the fair-share formula (pool grant ÷ seats, RX-31). | (a) Active members at the time the bar is computed. (b) The contract's seat limit. | (a). With (b), a company that uses 10 of 100 seats would see every bar at a tenth of its real share. | RX-31, RX-38 |
| 9 | Free weekly wallet and paid wallet in one request. | (a) A reservation draws from one wallet: the weekly wallet when the request is eligible for it and it covers the estimate, otherwise the paid wallet. (b) Split one request across both wallets. | (a). One conditional update per reservation; the cost is that a weekly remainder smaller than one request's estimate waits for the weekly reset. | RX-22, RX-58 |
| 10 | "Cheapest model" for the demo agent (D43, RX-21). | Every Standard model charges the same credits, so "cheapest" must mean provider cost. | The active Standard model with the lowest provider cost per 1M tokens at the definition mix (section 1.2), recomputed when RX-21 refreshes prices. | RX-21, RX-39 |
| 11 | D1: Enterprise shape and final credit amounts. | Open. | No value here. | RX-45, RX-53, RX-86, RX-32, RX-101, RX-60 |
| 12 | D2: per-member hard cap in Enterprise. | Open. | No value here. | RX-31, RX-38, RX-30, RX-86, RX-32, RX-101, RX-60 |
| 13 | D18: who can top up an Enterprise account. | Open. | No value here. | RX-60, RX-111, RX-56, RX-86, RX-32 |
| 14 | D27: Enterprise grace period before freezing. | Open. | No value here. | RX-60, RX-98, RX-101, RX-86, RX-32, RX-91 |

Where the tickets for items 11 to 14 come from: the Decision log rows D1 ("final numbers from the pilot (RX-45), now to be set in rupiah (RX-53)"), D18 ("(RX-60)"), D23 ("Follow-ups: D26, D27 (RX-60)") and D62 (the matrix ticket RX-111 "answers D18"), and a search of the Development Board on 2026-10-14 for "D1", "D2", "D18" and "D27": RX-86 ("fields for D1, D2, D18 and D27 have no defaults"), RX-32 and RX-60 ("no values are assumed for D1, D2, D18 or D27"), RX-101 ("Open decisions D1 (bundles), D2 (cap policy) and D27 (grace)"), RX-31 ("D2 (hard caps) stays open"), RX-38 ("the hard-cap switches follow D2 once it is decided"), RX-30 ("per-member projections wait for D2"), RX-56 ("the second admin keeps ownership transfer and the D18 top-up"), RX-98 ("grace period (D27)"), RX-91 (Out of scope: "Choosing offer values (RX-53, D1, D25, D27)"). RX-31, RX-60, RX-30 and RX-86 were read in full; the others from the board search results.

## Terms

Each term is used only in this meaning.

| Term | Meaning |
|---|---|
| credit | The ledger's unit. 1 credit = the charge for 1,000,000 Standard-tier tokens (section 1). |
| micro-credit | 0.000001 credit. Every amount in the ledger is a whole number of micro-credits. |
| new input | Input tokens the provider did not serve from its prompt cache. |
| cached input | Input tokens the provider served from its prompt cache. |
| output | Tokens the model generated. |
| rate | Credits per 1,000,000 tokens of one token kind for one tier. Three per tier: new, cached, output. |
| tier | Standard, Advanced, Premium or Frontier. Each model has one tier (RX-21). |
| account | Who owns credits: one user (individual) or one company (Enterprise). |
| wallet | One balance of an account. A user account has a `paid` wallet and a `weekly_free` wallet; a company account has a `paid` wallet only, which is the **pool**. |
| balance | The credits in a wallet: the sum of its ledger entries. |
| held | The part of the balance set aside by open reservations. |
| available | balance − held. New reservations draw only on this. |
| reservation | A hold of credits for one request or one run, made before the first model call. Not a ledger entry. |
| request | One unit of work started by a person: a chat message, an API call, or an agent run. Has a `requestId`. |
| model call | One call to a model provider. Has a `callId`. Writes exactly one usage entry. |
| settle | The end of a request: every model call has its usage entry and the unused part of the hold is released. |
| release | Removing (part of) a hold without charging it. |
| run | An agent run (PRD 10 R3): everything the root agent and the agents it calls do for one message. Has a `runId`. |
| runner | The person who started the run. Their spending source pays (PRD 10 R7). |
| hop | One call from one agent to another inside a run (`call_agent`). |
| pool | The `paid` wallet of a company account (Enterprise). |
| collaborator | An Enterprise member who runs the workspace's agents (PRD 10, D77 Q15). |

## Today's code and what this replaces

Read in `prisma/schema.prisma` and `apps/api/src/app/billing/` on `d612bb9`.

- `User.balance Decimal(12, 6)` (schema line 39) holds a balance that is changed by raw SQL. `Transaction` (line 86: `amount Decimal(12, 6)`, `type` "topup" | "deduction" | "refund") is written in a second statement after the balance update, not in the same transaction (`billing.service.ts` `reserveCredits`, report finding A5). `adjustBalance` takes extra cost with no balance check, so a balance can go negative.
- The agents path does not use the balance. It counts raw tokens on `UserSubscription.tokensUsed` (line 452) and `messagesUsed` (line 451) against `SubscriptionPlan.maxTokensPerMonth` (line 418), whatever the model (finding S17).
- Cost today is `(input × inputPrice + output × outputPrice) × creditMultiplier` in dollars (`billing/utils/calculate-actual-cost.ts`, `AiModel` lines 108 to 113). There is no cached-input kind. `UsageLog` (line 68) has `inputTokens`, `outputTokens` and `cost Decimal(12, 6)`, with no cached tokens and no agent, run or request column.
- `InvitationCode.creditAmount` and `CodeRedemption.creditsGranted` (lines 471, 505) grant dollar credit.

This design replaces `User.balance`, `Transaction` and the token counters on `UserSubscription` with one credit ledger (PRD 02 requirement 1). RX-20 removes them; there is nothing to convert (section 8).

The older documents `docs/QUOTA_STRATEGY.md` and `docs/OPENROUTER_PRICING_ANALYSIS.md` describe dollar balances, monthly token quotas and other tier names; where they disagree with PRD 02 or the Decision log, PRD 02 and the Decision log win and their numbers are not used here. `docs/billing-direction.md` agrees with this document.

---

## 1. The credit, the formula and the four tier tables

Follows: D10 (Chinese models set the base price; separate input, output and cached multipliers), PRD 02 "Credit definition", the review report "Pricing and credits" and its margin calculator, D111 (tiers per package), D112 (Frontier recompute, see section 14).

### 1.1 Definition

**1 credit = 1,000,000 tokens on the Standard tier.** PRD 02 adds "at 90% input, 60% of input served from cache, 10% output". That mix is read as: of every 1,000,000 tokens, 900,000 are input and 100,000 output; 60% of the input (540,000) is cached and the rest (360,000) is new. So the mix per token is **0.36 new input, 0.54 cached input, 0.10 output**.

### 1.2 What the rates mean (decided by the sources)

PRD 02's table gives Standard "1× / 1× / 1×" and the other tiers as multiples. The review report's margin calculator settles what they multiply. Its code holds the table as `B = { S: [1,1,1], A: [5,4,6], B: [10,11,20], C: [17,25,17] }` (order: input, output, cached) and computes the credits for one token at the mix as `st = shM * mu[0] + shC * mu[2] + shO * mu[1]`, where `shM`, `shC`, `shO` are the new, cached and output shares. So:

- each number in the table **is** a rate: credits per 1,000,000 tokens of that token kind;
- a tier's multiplier for a kind multiplies the Standard rate **of the same kind**, and the Standard rate of every kind is **1 credit per 1,000,000 tokens**;
- because all three Standard rates are 1, the mix does not change the number of credits for Standard tokens. The mix sets the **dollar cost of a credit** (the calculator's `raw`), which is what the PRD's "about $0.12 per credit" is.

Check that this is the reading the PRD's numbers rest on: with these rates and the calculator's price constants, the calculator reproduces every margin in PRD 02's package table (49 / 43 / 59 / 49 / 44 / 32 / 29 / 26 / 37% typical, 2 / −10 / 22 / 2 / −9 / −31 / −37 / −44 / −22% worst case) and the "about $0.12" and "about $0.23" cost per credit (`build/recompute.py`, part 2). Those package figures are illustrative (to be set from the pilot, RX-45, and the rupiah list, RX-53), and no rule here depends on them.

Standard at the mix, the exact definition:

| Kind | Tokens in 1,000,000 | Rate | Micro-credits |
|---|---|---|---|
| new input | 360,000 | 1 | 360,000 |
| cached input | 540,000 | 1 | 540,000 |
| output | 100,000 | 1 | 100,000 |
| total | 1,000,000 | | 1,000,000 = 1.000000 credit |

### 1.3 Formula

```
credits = (new input × new rate + cached input × cached rate + output × output rate) ÷ 1,000,000
```

computed exactly and rounded once per model call (section 2.3). Rates are read from the model's tier at the time of the call and copied onto the usage entry.

### 1.4 The four tier tables (credits per 1,000,000 tokens)

Columns are in the order new input, cached input, output. PRD 02 prints them as Input, Output, Cached.

**Standard** (PRD 02 examples: DeepSeek V4.1 Flash, GLM 5.3 Flash, Qwen 3.8 Flash)

| new input | cached input | output | credits per 1M tokens at the mix |
|---|---|---|---|
| 1 | 1 | 1 | 1.00 |

**Advanced** (DeepSeek V4 Pro, Kimi K2.6, GLM 5.3 FlashX, Gemini 3 Flash, GPT-5.6 Luna)

| new input | cached input | output | credits per 1M tokens at the mix |
|---|---|---|---|
| 5 | 6 | 4 | 5.44 |

**Premium** (Claude Sonnet 5.5, GPT-5.6 Sol, GLM 5.3 Prime, Kimi K3)

| new input | cached input | output | credits per 1M tokens at the mix |
|---|---|---|---|
| 10 | 20 | 11 | 15.50 |

**Frontier** (Claude Opus 5.5, Claude Opus 5, GPT-5.5) — **Decided (D115), item 1**

| | new input | cached input | output | credits per 1M tokens at the mix |
|---|---|---|---|---|
| **Proposed (R-5 method, section 14)** | **29** | **29** | **42** | 30.30 |
| PRD 02 (the current decided text) | 17 | 17 | 25 | 17.80 |

The example model lists are PRD 02's; R-5 (2026-10-14) shows newer models for several providers, and which models the catalog carries is RX-21 and RX-86's job. Claude Fable 5.1, GPT-6 Astra and Gemini 4 Argon stay out of the catalog until a tier above Frontier is priced (D112 item 37); this document sets no rate for a fifth tier. Which tiers a package may use is a back-office setting; by default every tier on every paid package, free users on the cheapest tier only (D111 option C; sections 6 and 9).

### 1.5 Worked examples, one per tier

All four recompute in `build/recompute.py`, part 1. A product of tokens and an integer rate is already a whole number of micro-credits.

**Standard**, DeepSeek V4.1 Flash: 18,437 new, 27,906 cached, 3,215 output.

```
18,437 × 1 = 18,437
27,906 × 1 = 27,906
 3,215 × 1 =  3,215
sum        = 49,558 micro-credits
```
= **0.049558 credits**

**Advanced**, DeepSeek V4 Pro: 9,871 new, 14,263 cached, 2,047 output.

```
 9,871 × 5 = 49,355
14,263 × 6 = 85,578
 2,047 × 4 =  8,188
sum        = 143,121 micro-credits
```
= **0.143121 credits**

**Premium**, Claude Sonnet 5.5: 6,529 new, 21,874 cached, 1,388 output.

```
 6,529 × 10 =  65,290
21,874 × 20 = 437,480
 1,388 × 11 =  15,268
sum         = 518,038 micro-credits
```
= **0.518038 credits**

**Frontier** (proposed rates), Claude Opus 5.5: 4,183 new, 15,742 cached, 2,961 output.

```
 4,183 × 29 = 121,307
15,742 × 29 = 456,518
 2,961 × 42 = 124,362
sum         = 702,187 micro-credits
```
= **0.702187 credits**

The same Frontier call at PRD 02's 17 / 17 / 25, kept on record: 4,183 × 17 = 71,111; 15,742 × 17 = 267,614; 2,961 × 25 = 74,025; sum 412,750 = 0.412750 credits.

**What the rate shape means for cost (open item 2).** The cost of serving one credit depends on the request's mix, because the rates are flat per kind while provider prices are not. With the review report's typical prices (2026-10-08), a Standard credit at the definition mix costs about $0.12; the same tokens with no cache hit cost more per credit, and in Advanced and Premium a cached token earns more credits than a new one although it costs the provider a fraction. No rule below depends on this; the estimate in section 3.1 guards the reservation against it.

## 2. Ledger entries and invariants

Follows: PRD 02 requirement 1 and its acceptance criteria ("balance equals the sum of entries", "concurrent requests cannot take the balance below zero", "a duplicate payment webhook creates one grant"), RX-20 Scope, D8 (credits never expire), D92 (transactions), D106 (the 0.000001 difference), PRD 10 R7 (D81: `agentId`, `runId`, `parentCallId` and the runner on every model call).

### 2.1 Rows

Three kinds of rows. Field names are proposals for RX-20; the column types are RX-20's choice, but every amount must hold whole micro-credits exactly (no floating point).

**Credit account row** (one per account and wallet; the balance is read here, in one row read):

| Field | Meaning |
|---|---|
| `id` | Account-wallet id. |
| `ownerType`, `ownerId` | `user` + user id, or `company` + company id. |
| `wallet` | `paid` or `weekly_free` (section 6). |
| `balance` | Sum of this wallet's ledger entries. |
| `held` | Sum of the open reservations' remaining holds. |
| `frozen` | Company pool only: true while an Enterprise renewal is unpaid (D23). |
| `lastSeq` | `seq` of the newest entry. |

**Ledger entry** (append-only; never updated or deleted):

| Field | Meaning | Filled when |
|---|---|---|
| `id` | Entry id. | always |
| `accountId`, `wallet` | The wallet the entry changes. | always |
| `seq` | 1, 2, 3, … per wallet, no gaps. | always |
| `type` | `plan_grant` (package purchase, package code, Enterprise period credits), `top_up` (top-up pack), `bonus` (credits-only code, promotion), `weekly_reset` (free allowance, RX-58), `usage` (one model call), `refund` (D24), `adjustment` (back office, RX-99). | always |
| `amount` | Signed credits, whole micro-credits. Positive adds, negative removes. `usage` is ≤ 0. | always |
| `balanceAfter` | The wallet balance right after this entry. | always |
| `uncharged` | Credits a model call consumed that were not charged: provider error, demo overage, estimate overrun (section 3). 0 otherwise. | always (0 if none) |
| `memberUserId` | The person behind the entry: the runner for usage, the buyer for a purchase, the admin for an adjustment. On a company pool this is how spend is attributed (section 5). | always |
| `requestId` | The request. | `usage` |
| `callId` | The model call. Unique among `usage` entries. | `usage` |
| `runId`, `agentId`, `parentCallId` | The run, the agent that made the call, and the caller's model call that started this hop (null for the root agent's calls). | `usage` in an agent run; `agentId` null in home chat |
| `modelId`, `tier`, `rateNew`, `rateCached`, `rateOut` | The model and the rates used, copied at the time of the call. | `usage` |
| `tokensNew`, `tokensCached`, `tokensOut` | Token counts from the provider's response. | `usage` (0 when the provider reported none) |
| `outcome` | `completed`, `provider_error` or `client_cancel`. | `usage` |
| `reference` | What caused a non-usage entry: purchase snapshot id (package version, section 9), top-up pack version, code redemption id, Xendit payment or refund id, back-office action id. | all types except `usage`, `weekly_reset` |
| `idempotencyKey` | Unique per wallet: the `callId` for usage, the Xendit callback id for a payment, the redemption id for a code. A second write with the same key is a no-op. | always |
| `createdAt` | Time of the write. | always |

**Reservation row** (one per request or run):

| Field | Meaning |
|---|---|
| `id`, `accountId`, `wallet` | The hold and the wallet it is on. |
| `requestId`, `runId` | What it is for. |
| `amountHeld` | Credits set aside at the start. |
| `consumed` | Credits of the usage entries charged against the hold so far. |
| `status` | `open`, `settled`, `released` (nothing charged) or `expired` (released by the sweep). |
| `expiresAt` | Start + 10 minutes: above the provider call timeout (300 s, CHAT_TIMEOUT_MS) and the per-run limit (5 minutes, D77 Q5), plus a margin. The 60 s per call of D77 Q5 is a peer-run limit, not the hold's expiry. |

Cost: every model call writes one ledger entry and one usage row (PRD 10 R7) and updates one account row; the rates and token counts on the entry add a few columns per row, and in return any entry can be recomputed later without knowing the rates of that day.

### 2.2 Invariants

| # | Invariant |
|---|---|
| I1 | For every wallet: `balance` = sum of `amount` over its entries, exactly. |
| I2 | For every entry: `balanceAfter` = previous entry's `balanceAfter` + `amount` (the first entry's previous value is 0), and the newest entry's `balanceAfter` = the account row's `balance`. This makes the I1 check one row read per wallet instead of a sum. |
| I3 | Every `usage` entry has a `requestId` and a `callId`, and a `callId` appears on at most one `usage` entry. |
| I4 | `held` = sum of (`amountHeld` − `consumed`) over the wallet's `open` reservations; 0 ≤ `consumed` ≤ `amountHeld`. |
| I5 | `balance` ≥ 0 and `available` = `balance` − `held` ≥ 0 at all times. No path makes a balance negative, including demo overage (D43) and estimate overrun. |
| I6 | For a settled reservation: sum of −`amount` of its usage entries = `consumed` + any overrun charged from `available`, and the released part = `amountHeld` − `consumed`. |
| I7 | Entries are never updated or deleted. A correction is a new `adjustment` entry with a reason. |
| I8 | One external event (payment callback, code redemption, renewal payment) creates at most one entry (`idempotencyKey`). |

How the invariants are kept without read-then-write on a balance (each step is one short transaction, D92 item 3; none spans a model call or a stream):

- **Reserve:** one conditional update, `held = held + E` where `balance − held ≥ E` and the wallet is not frozen; zero rows updated means `CREDITS_EXHAUSTED` (HTTP 402, RX-22). Then insert the reservation row, same transaction.
- **Usage entry:** one conditional update on the account row, `balance = balance − A, held = held − h` (h = the part taken from the hold), returning the new `balance` and `lastSeq`, then insert the entry with those values and add h to the reservation's `consumed`. The account row's lock orders entries per wallet, so `seq` and `balanceAfter` cannot interleave.
- **Release:** `held = held − r` and the reservation's status, same transaction.
- **Reading a balance** reads the account row. Nothing sums ledger entries in a request path; the I1/I2 check is a test and a periodic job.

Cost: on an Enterprise pool every collaborator's model call updates the same account row, so pool writes are serialised on that row; each is one short statement, which is acceptable at 100 seats and at most 30 model calls per run (PRD 10 Q5).

### 2.3 Precision and rounding (Decided (D115), item 3)

- **Unit.** Every ledger amount, balance, hold and estimate is a whole number of micro-credits (0.000001 credit). Today's `Decimal(12, 6)` columns have the same scale.
- **When.** Each model call is rounded **once**, on the exact sum of its three products, when its usage entry is written. Nothing else rounds: settle, release and every sum are additions of whole micro-credits.
- **Direction.** Up (ceiling) to the next micro-credit. The most a call can gain from rounding is less than 0.000001 credit.
- **Rates.** With integer rates, as in all four tier tables, a token × rate product is already whole, so rounding never changes the amount. A rate with decimals (allowed, because rates are admin-editable, RX-21) is where the rule matters.
- **Display.** Screens may round for display (RX-30); the ledger never does.
- **D106.** QA saw a balance and a ledger row differ by 0.000001. Under this rule the amount is computed once, in integers, and the same number is written to the entry and subtracted from the balance, so they cannot differ.

**Example where the rule bites.** A hypothetical tier with rates 2.5 / 0.25 / 7.5 (not a real or proposed tier; only to show the rule). One call: 1,234 new, 566 cached, 89 output.

```
1,234 × 2.5  = 3,085.0
  566 × 0.25 =   141.5
   89 × 7.5  =   667.5
exact sum    = 3,894.0 micro-credits → 0.003894 credits (ceiling of a whole number changes nothing)
```

Rounding each kind up first would give 3,085 + 142 + 668 = 3,895 = 0.003895 credits, one micro-credit more; the rule forbids it. With 1,235 new tokens the exact sum is 3,896.5, and the charge is the ceiling, 3,897 = 0.003897 credits.

## 3. Reserve, settle and release for streaming requests; provider errors

Follows: PRD 02 requirement 3, RX-22 Scope and acceptance criteria, D92 item 3 (no transaction across a model call or a stream; a killed request is handled by a separate release call), PRD 10 R7 (D81). Holds instead of reserve entries: Decided (D115), item 4. Provider-error charge: Decided (D115), item 5.

### 3.1 Rules

1. **Estimate** one model call: `E = I × max(new rate, cached rate) + M × output rate`, rounded up to a micro-credit, where I is the counted input tokens of the prompt and M is the call's `max_tokens`. The max of the two input rates is needed because cached input costs more than new input in Advanced and Premium; with it, a call that respects `max_tokens` cannot cost more than its estimate. (How I is counted is RX-22's; today's code uses characters ÷ 4.)
2. **Reserve** E before the call (section 2.2). If `available` < E: HTTP 402 `CREDITS_EXHAUSTED`, nothing else happens. A run reserves once for the whole chain (section 13).
3. **Stream.** No transaction is open while the model streams.
4. **Usage entry** when the call ends: compute A from the provider's reported new, cached and output tokens (section 1.3). Take A from the hold; if A exceeds the remaining hold (the count of I was low), take the excess from `available` in the same conditional update; if `available` cannot cover it, charge what it covers and record the rest in `uncharged`. Balance never goes negative (I5).
5. **Settle**: release the remaining hold (`amountHeld` − `consumed`) and mark the reservation `settled`.
6. **Provider error** (Decided (D115), item 5): the call is charged 0, whether the error comes before the first token or mid-stream. The usage entry is still written (every model call has one, PRD 10 R7) with `amount` 0, `outcome` `provider_error`, the token counts the provider reported (0 if none), and `uncharged` = what those tokens would have cost. The hold is released. A retry on a fallback provider (D58) is a new model call under the same reservation, charged normally.
7. **Client cancel** (the user stops the stream): charged for the tokens the provider reports for the partial answer, `outcome` `client_cancel`.
8. **Killed request** (process died, no usage entry and no settle): a sweep releases every `open` reservation past `expiresAt` and marks it `expired` (RX-22 acceptance: "A killed request releases its reservation"). The sweep reads only expired open reservations through an index on (`status`, `expiresAt`), in batches. A provider charge for a call whose usage entry was never written is lost to the platform.

### 3.2 Example (a): a normal streamed request

A Pro user, home chat, Claude Sonnet 5.5 (Premium: 10 / 20 / 11). Account `acc_u_7f3a`, wallet `paid`. Amounts in the ledger before are example amounts, not catalog values.

Ledger entries before the request:

| Field | e1 | e2 |
|---|---|---|
| seq | 1 | 2 |
| type | plan_grant | usage |
| amount | 25.000000 | -1.812570 |
| balanceAfter | 25.000000 | 23.187430 |
| uncharged | 0.000000 | 0.000000 |
| memberUserId | usr_7f3a | usr_7f3a |
| requestId | null | req_0991 |
| callId | null | call_0991_1 |
| runId / agentId / parentCallId | null / null / null | null / null / null |
| modelId / tier | null / null | claude-sonnet-5.5 / Premium |
| rateNew / rateCached / rateOut | null | 10 / 20 / 11 |
| tokensNew / tokensCached / tokensOut | null | 52,312 / 61,200 / 5,950 |
| outcome | null | completed |
| reference | purchase snapshot ps_pro_v1_7f3a | null |
| idempotencyKey | xendit:pay_5521 | call_0991_1 |
| createdAt | 2026-10-14T08:02:11Z | 2026-10-14T08:40:57Z |

e2: 52,312 × 10 + 61,200 × 20 + 5,950 × 11 = 523,120 + 1,224,000 + 65,450 = 1,812,570 micro-credits.

The request: counted input 30,145 tokens, `max_tokens` 4,096. Estimate E = 30,145 × max(10, 20) + 4,096 × 11 = 602,900 + 45,056 = 647,956 micro-credits = 0.647956. The provider reports 8,412 new, 21,733 cached (30,145 input in all), 1,957 output: A = 84,120 + 434,660 + 21,527 = 540,307 micro-credits = 0.540307.

| Step | Ledger change | balance | held | available | Σ entries |
|---|---|---|---|---|---|
| before | — | 23.187430 | 0.000000 | 23.187430 | 25.000000 − 1.812570 = 23.187430 |
| reserve 0.647956 (reservation rsv_a, open) | none | 23.187430 | 0.647956 | 22.539474 | 23.187430 |
| usage entry e3: −0.540307, 0.540307 from the hold | +e3 | 22.647123 | 0.107649 | 22.539474 | 22.647123 |
| settle: release 0.107649 (rsv_a settled, consumed 0.540307) | none | 22.647123 | 0.000000 | 22.647123 | 22.647123 |

Entry e3: seq 3, type usage, amount −0.540307, balanceAfter 22.647123, uncharged 0.000000, memberUserId usr_7f3a, requestId req_1002, callId call_1002_1, runId / agentId / parentCallId null, modelId claude-sonnet-5.5, tier Premium, rates 10 / 20 / 11, tokens 8,412 / 21,733 / 1,957, outcome completed, reference null, idempotencyKey call_1002_1, createdAt 2026-10-14T09:00:14Z.

### 3.3 Example (b): provider errors

Same wallet, after example (a). DeepSeek V4.1 Flash (Standard: 1 / 1 / 1).

**(b1) Error before the first token.** Counted input 2,918, `max_tokens` 2,048: E = 2,918 + 2,048 = 4,966 micro-credits = 0.004966. The provider returns HTTP 502 before any token and reports no usage.

| Step | Ledger change | balance | held | available | Σ entries |
|---|---|---|---|---|---|
| before | — | 22.647123 | 0.000000 | 22.647123 | 22.647123 |
| reserve 0.004966 (rsv_b1) | none | 22.647123 | 0.004966 | 22.642157 | 22.647123 |
| usage entry e4: amount 0.000000, outcome provider_error | +e4 | 22.647123 | 0.004966 | 22.642157 | 22.647123 |
| release 0.004966 (rsv_b1 released) | none | 22.647123 | 0.000000 | 22.647123 | 22.647123 |

**(b2) Error mid-stream.** Counted input 15,377, `max_tokens` 4,096: E = 15,377 + 4,096 = 19,473 micro-credits = 0.019473. The stream breaks after part of the answer; the provider reports 3,208 new, 12,169 cached, 611 output, which would cost 3,208 + 12,169 + 611 = 15,988 micro-credits = 0.015988. Charged 0; the 0.015988 goes to `uncharged`.

| Step | Ledger change | balance | held | available | Σ entries |
|---|---|---|---|---|---|
| before | — | 22.647123 | 0.000000 | 22.647123 | 22.647123 |
| reserve 0.019473 (rsv_b2) | none | 22.647123 | 0.019473 | 22.627650 | 22.647123 |
| usage entry e5: amount 0.000000, uncharged 0.015988, outcome provider_error | +e5 | 22.647123 | 0.019473 | 22.627650 | 22.647123 |
| release 0.019473 (rsv_b2 released) | none | 22.647123 | 0.000000 | 22.647123 | 22.647123 |

| Field | e4 (b1) | e5 (b2) |
|---|---|---|
| seq | 4 | 5 |
| type | usage | usage |
| amount | 0.000000 | 0.000000 |
| balanceAfter | 22.647123 | 22.647123 |
| uncharged | 0.000000 | 0.015988 |
| memberUserId | usr_7f3a | usr_7f3a |
| requestId | req_1003 | req_1004 |
| callId | call_1003_1 | call_1004_1 |
| runId / agentId / parentCallId | null / null / null | null / null / null |
| modelId / tier | deepseek-v4.1-flash / Standard | deepseek-v4.1-flash / Standard |
| rateNew / rateCached / rateOut | 1 / 1 / 1 | 1 / 1 / 1 |
| tokensNew / tokensCached / tokensOut | 0 / 0 / 0 | 3,208 / 12,169 / 611 |
| outcome | provider_error | provider_error |
| reference | null | null |
| idempotencyKey | call_1003_1 | call_1004_1 |
| createdAt | 2026-10-14T09:05:02Z | 2026-10-14T09:07:45Z |

The rule is the same in b1 and b2 (charge 0, release all); only what the entry records differs.

## 4. One balance that never expires; warnings; the locked state

Follows: D8 (credits never expire), D3 and D9 (zero locks everything except history), D36 (top-up only with a package), D45 and D47 (warnings by projected run-out; section 12), PRD 02 "Locked state and warnings", RX-29.

- **One balance.** Package grants, top-ups, credits-only codes and Enterprise period credits all go into the same `paid` wallet. None expires (D8). There is no per-grant bucket and no expiry job. The free weekly allowance is a separate wallet that resets (section 6).
- **Low-credit warnings.** The trigger is the projected run-out date (section 12), not a percentage. The Scope line's "20%, 10% and 5%" (D9) is superseded by D45 and D47; open item 6 asks the Tech Lead to record that.
- **Locked.** An account is locked when it has no credits it may spend: the `paid` balance is 0 and the `weekly_free` balance is 0 (or the request is not eligible for it). Locked uses `balance`, not `available`: a run's own hold can bring `available` to 0 for a few minutes (section 13.3) without locking the account. Locked is computed, not stored. A request whose estimate exceeds the available balance is refused with HTTP 402 `CREDITS_EXHAUSTED` even when the balance is above 0 (RX-22); the locked screen is shown when the balance is 0 (RX-29).
- **Blocked when locked** (PRD 02, RX-29): home chat, agent and channel chat, creating or editing agents and prompts, knowledge uploads, MCP connect or change, web search, document generation, public API requests (402 `CREDITS_EXHAUSTED`), and scheduled reminders that would run an agent (paused, owner notified).
- **Open when locked** (D3, D36, RX-29): reading history (conversations, agent runs, channel messages, generated documents), sign in and out, profile, redeem a code, and billing: buy a package, or top up if the account has a package. A free account is offered a package or a code and the next weekly reset time, never a top-up.
- **Frozen pool** (D23): a company pool whose renewal is unpaid is frozen: reservations on it are refused, history stays readable, the credits are kept, and paying unfreezes it (RX-60).

## 5. Enterprise: company pool, member attribution, fair-share bar

Follows: PRD 04 requirement 3, D7 (100 seats per company across workspaces), D23 (freeze), D44 (seats and members are Enterprise only), D77 and D78 (PRD 10 Q6, Q16, Q17), RX-31. Open: D2 (member hard caps), D18 (who tops up). Seat count in the bar: Decided (D115), item 8.

- **Pool.** The company account's `paid` wallet is the pool. When a collaborator runs a workspace agent, the reservation and every usage entry are on the pool, with `memberUserId` = the collaborator (D77 Q16, RX-31). A collaborator's personal balance is never touched by workspace agents; an empty or frozen pool refuses the run with the "ask your admin" message (PRD 10 Q16, RX-60).
- **Attribution.** Per member and per period, a counter row (`companyAccountId`, `memberUserId`, `periodStart`, `spent`) is incremented in the same transaction as each usage entry on the pool. The bar and the company owner's member table read these rows, never the ledger. Cost: one extra row update per model call on Enterprise.
- **Fair share.** `share(member) = period grant ÷ seats` (RX-31), adjustable per member by the company admin (review report). Decided (D115, item 8): seats = active members when the bar is computed. The period grant is the Enterprise bundle's credits for the period, whose value is D1 (open). The bar shows `spent(member, period) ÷ share(member) × 100`.
- **Over the share.** A member above 100% is not stopped; only a per-member hard cap would stop them, and that is D2 (open). The contract record has a cap-policy field with no default (section 9).
- **Who sees what** (D78 Q17): each person sees their own usage; only the company owner sees the pool balance, spend this period, one credit total per member and the run-out warnings; billing admins and workspace owners do not see per-member totals.
- **Who tops up the pool:** D18 (open). Extra credits go to the pool as `top_up` entries with the payer in `memberUserId`.
- **Renewal** (D23): the paid renewal adds the new period's credits as one `plan_grant` entry on the pool (idempotent on the Xendit callback, I8); unused credits carry over (D8). The freeze starts when the period ends unpaid plus the grace period, whose value is D27 (open).

## 6. Account states: free and package

Follows: D36 (no credits-only state; top-up requires a package), D5 (2 credits a week), D43 (demo agent), D111 option C (tiers), RX-58. Wallet choice per request: Decided (D115), item 9.

| State | How you get there | Wallets that can be spent | Top-up | Credits-only code | Model tiers |
|---|---|---|---|---|---|
| Free | Sign up | `weekly_free` only (home chat, Standard tier, and the onboarding demo agent, D43) | No (D36) | No (D36) | The cheapest tier only (D111) |
| Package: Starter or Pro | Buy it, or redeem a code that grants it | `paid`; also `weekly_free` for home chat on Standard (RX-58: "spent before paid credits") | Yes, any time (D37) | Yes | Every tier by default; a back-office setting per package (D111) |
| Package: Enterprise | Sales-assisted activation (D12) | The company pool for workspace agents (section 5); the member's own wallets for their own use | Pool: D18 (open) | Yes | Every tier by default; the contract's allowed tiers (D111, RX-86) |

- A **weekly reset** (RX-58) writes one `weekly_reset` entry with `amount = max(allowance, held) − balance`, computed in the same conditional update, so the wallet ends at the allowance with no carry-over and never below what its open reservations hold (I5). The amount is negative when the balance is above the allowance (the allowance setting was lowered); if an open hold is larger than the new allowance, the wallet stays at the held amount and reaches the allowance at the next reset after the hold is settled. RX-58 tests that case: a reset with an open hold larger than the new allowance. The allowance is a platform setting; its value is 2 credits a week (D5). Paid credits are never touched by the reset.
- A request draws from **one wallet** (open item 9): the `weekly_free` wallet when the request is eligible (home chat on a Standard model, or the demo agent) and its available covers the estimate; otherwise the `paid` wallet.
- A free account cannot buy a top-up pack or redeem a credits-only code; checkout (RX-35) and redemption refuse it on the server, with a negative test each.

## 7. Starter and Pro unlock their limits permanently; credits are separate

Follows: D37 (settles D26), D36, RX-20 Scope.

- Buying Starter or Pro creates an **entitlement** with no end date that points at the purchase snapshot of the package version (section 9). The package's limits (agents, connected tools, API access, channels) come from that snapshot and stay unlocked for good.
- The purchase also writes one `plan_grant` entry on the `paid` wallet with the snapshot's credits (`reference` = the snapshot id). Spending those credits does not touch the entitlement: an account at 0 keeps its limits and is locked only for spending (section 4).
- Top-ups can be bought any time while the account has a package (D36, D37).
- A later price or limit change creates a new version; earlier buyers keep their snapshot (RX-86 acceptance criterion).

## 8. No conversion of existing balances or token quotas

Follows: D49 (production is dead; no production data), D50 (RX-19 and RX-20 simplified; D38 obsolete).

Removed from the Scope by D49 and D50. There is no production data, so nothing is converted: no `User.balance`, no `Transaction` rows and no `UserSubscription` token counters are carried over. RX-20 removes those columns and tables, and the ledger starts empty. D38 (which subscriptions to convert) is obsolete.

## 9. Offer catalog, versions, purchase snapshots, contracts and platform settings (design for RX-86)

Follows: D46 (offers are managed in the back office; values open), D47 (back-office model approved), D37, D111 option C (allowed tiers), D7. No values for D1, D2, D18 or D27.

| Record | Fields | Notes |
|---|---|---|
| Package | id, name, display order, active, visible | Starter, Pro, Enterprise. |
| Package version | package id, version number, rupiah price, credits granted, billing (one-time or monthly), limits (agents, connected tools, API access, channels), allowed tiers, effective from, created by, reason | Immutable once a purchase points at it; a change creates a new version (RX-86). Allowed tiers default to every tier for paid packages (D111). |
| Top-up pack version | pack id, credits, rupiah price, active, effective from | Sold only to accounts with a package (D36). |
| Enterprise bundle version | pool credits per period, monthly rupiah price, active | Values: D1 (open). |
| Company contract | company id, bundle version, seat limit (≤ the platform's seat ceiling, D7), default member share, allowed tiers, grace days, WhatsApp on or off, cap policy, top-up roles | Filled when a proposal is accepted (RX-32, RX-101). Grace days: D27, cap policy: D2, top-up roles: D18 — no defaults (RX-86). |
| Purchase snapshot | buyer account, package or pack version id, copy of price, credits and limits at purchase, Xendit payment id | Referenced by the `plan_grant` or `top_up` entry. |
| Platform settings (typed, validated) | weekly free allowance (D5: 2 credits); demo limits (demo runs per account per week, demo runs per IP per day, D43); demo overage cap (D43, RX-22); run-out thresholds (D47: amber within 7 days, red within 2 days, floor 1 credit); peer-run limits (D77 Q5: depth 2, 5 agent calls, 30 model calls, 60 s per call, 5 minutes per run; per-run credit cap and its floor, section 13); seat ceiling (D7: 100); "not enough use yet" and "more than a year" limits for the projection (RX-30); anonymous free-tier chat requests per IP per day (`anonymousRequestsPerIpPerDay`) and across all IPs per day (`anonymousRequestsGlobalPerDay`); Enterprise grace period in days (`graceDays`, D27); repeat-offender threshold, high-severity guardrail violations within a fixed 7-day window (`repeatOffenderThreshold`, D59, PRD 09 F9) | The demo limits, the demo overage cap, the projection limits and the four settings `anonymousRequestsPerIpPerDay`, `anonymousRequestsGlobalPerDay`, `graceDays` and `repeatOffenderThreshold` (RNX-226) have no decided values and no default; the Tech Lead sets them in the seed file (RX-86) or through the admin API (RNX-226). Until then the portal still reads ANON_DAILY_IP_CAP and ANON_DAILY_GLOBAL_CAP, and contracts keep their own grace days. Every change is audited: who, why, when it takes effect. |
| Tier rates | tier, rate new, rate cached, rate out, effective from | Live with the model tiers (RX-21), not in the catalog; changing one changes the next request's charge without a deploy (PRD 02). Values: section 1.4. |

Free users stay on the cheapest tier (D111); that is a platform rule, not a package setting.

## 10. Starter and Pro are individual only; seats and members are Enterprise only

Follows: D44, D64 item 4 (no collaboration on Starter and Pro, enforced on the server), D13.

- A Starter or Pro account has one person. It has no workspace members, no invitations and no seats; the server refuses them (D64).
- Only a company account (Enterprise) has seats, collaborators and a pool. Seats count across all the company's workspaces (D7).
- Consequence for the ledger: on a user account, `memberUserId` is always the account owner, except on an `adjustment` entry, which names the back-office admin who made it (RNX-227); only a company pool has entries from several people.

## 11. The onboarding demo agent

Follows: D43 (amends D5), D47 (the Product Manager's demo proposal approved), D5, RX-39, RX-22, RX-58. "Cheapest model": Decided (D115), item 10.

- **Who may run it** (RX-39): a signed-up free account with a verified email; one demo agent per account, cloned from a goal template.
- **Model:** the cheapest active model (RX-21). Every Standard model charges 1 / 1 / 1, so "cheapest" is by provider cost: the active Standard model with the lowest provider dollar cost per 1,000,000 tokens at the definition mix (0.36 / 0.54 / 0.10), recomputed when RX-21 refreshes prices. The user cannot change it.
- **Paid from** the `weekly_free` wallet (D43). Before the run: estimate (section 13.3) and start only if the wallet's available covers it; otherwise offer Starter (RX-39).
- **Anti-farming caps** (RX-39): demo runs per account per week and demo runs per IP per day (reusing RX-10's counters). Both are platform settings without decided values.
- **Excluded for free accounts** (RX-39): scheduled runs, agent calls to other agents, API and WhatsApp, Premium and Frontier models, a second agent, changing the model.
- **Demo overage** (RX-22): a demo run that started may finish even if it costs more than the wallet holds, up to the demo overage cap (a platform setting). The wallet is charged what it holds, never below 0 (I5); the excess goes into the `uncharged` field of the demo call's own usage entry, like any overrun (rule 3.1.4). There is no separate entry for it; a demo call is known by its `agentId`, the account's demo agent. Before each model call the run checks `consumed + E_call ≤ wallet balance at start + demo overage cap`; above it the run stops.

Example, weekly wallet balance 0.037686 (Standard 1 / 1 / 1):

| Outcome | Run cost | Entries | Weekly balance after |
|---|---|---|---|
| (d1) within the balance: 21,544 new, 9,012 cached, 3,877 output | 21,544 + 9,012 + 3,877 = 34,433 micro-credits = 0.034433 | usage −0.034433 | 0.003253 |
| (d2) above the balance: 29,871 new, 10,430 cached, 4,102 output | 29,871 + 10,430 + 4,102 = 44,403 micro-credits = 0.044403 | usage −0.037686, uncharged 0.006717 (if the cap is at least 0.006717) | 0.000000 |

## 12. Run-out projection, warnings and emails

Follows: D45 (message: projected run-out date), D47 (trigger rules approved: 7-day average rate, amber within 7 days, red within 2 days, floor, emails at 7 days, 2 days and floor, none for free users), D78 Q17 (pool warnings to the company owner only), RX-30. Supersedes the percentage warnings of D9 and D42 (open item 6).

- **Spent in the last 7 days** comes from a daily counter row per wallet (`accountId`, `day`, `spent`), incremented with each usage entry. The projection reads at most 7 rows. Cost: one more row update per model call.
- **Rate** = credits spent in the last 7 days ÷ 7 (credits per day).
- **Run-out** = now + available ÷ rate, shown in the profile timezone as "At this rate your credits run out on DD/MM/YYYY HH:MM" (D45), the time rounded down to the minute.
- **Not enough use yet** with fewer than 3 days of use or a spend below a platform setting; **more than a year at your current pace** when the run-out is more than a year away (RX-30).
- **Banners:** amber when run-out is within 7 days, red within 2 days. **Floor:** always warn when the available balance is below 1 credit or below the estimate of the next scheduled run. The red state lists scheduled runs due before the run-out. Thresholds are platform settings (section 9).
- **Emails:** at the 7-day projection, the 2-day projection and the floor, each once per purchase cycle; buying credits resets them. Individual: the account owner. Enterprise pool: the company owner only (D78), and only when the run-out is within 7 days and before the renewal date. Members' own warnings stay per member; per-member projections wait for D2.
- **Free allowance:** no projection and no emails; the meter shows the weekly allowance left and the reset day.

Example: spent in the last 7 days 9.481330 credits, so rate = 1.354476 credits per day. With 11.734210 available, run-out is in 8.66 days: no banner. With 2.500000 available, run-out is in 1.85 days: red banner, and the 2-day email if not yet sent this cycle.

## 13. Peer-agent runs: numbers and formulas

Follows: D81 (PRD 10 approved) and D77 (Q5, Q6, Q7, Q16): the runner's spending source pays every hop (the company pool for a collaborator); one reservation per run; a per-run credit cap as a platform setting; a usage row and a ledger line per model call with `agentId`, `runId`, `parentCallId` and the runner. These rules are PRD 10's; this section gives the numbers and formulas (RX-19 Out of scope, D82). Numbers: Decided (D115), item 7.

### 13.1 A hop's tokens

A hop's model calls convert to credits with the same formula and the same tier rates as a root call (section 1.3): each call uses the rates of the tier of the model that the called agent runs on. Nothing is added per hop.

### 13.2 The per-run cap

- **Default: 10 credits** (Decided (D115); PRD 10 Q5 recommendation "credit cap per run as a setting (10 credits, owner may lower it)", adopted as a setting by D77; PRD 10 section 11 lists the 10 as assumed). A platform setting (D46).
- The workspace owner may lower it for their agents; never above the platform setting.
- **Floor: 1 credit** (Decided (D115)): the lowest value the owner may set. 1 credit is 1,000,000 Standard tokens, enough for the 30-model-call limit on Standard at about 33,000 tokens per call. A run whose first call alone does not fit under the cap is refused before it starts, with a message that names the cap.

### 13.3 The pre-run estimate

```
E_call(agent) = I × max(new rate, cached rate) + M × output rate          (section 3.1)
L             = min(number of agents the root agent may call, agent calls per run limit = 5)
E_run         = (L + 1) × E_call(root agent) + Σ over the root's linked agents E_call(linked agent)
```

Expected calls: one root call, one call for each linked agent, and one more root call after each linked agent returns (the caller continues and writes the reply, PRD 10 R4). For a linked agent, I is the token count of its system prompt and tool definitions plus a task allowance (a platform setting); for the root, I is the counted prompt. Deeper calls (depth 2) are not estimated; the cap bounds them.

- **Start** only if `available ≥ min(E_run, cap)`; otherwise 402 `CREDITS_EXHAUSTED` (RX-22).
- **Hold** H = min(cap, available), one reservation for the run.
- Cost: the hold can set aside up to the cap for the run's duration (at most 5 minutes, Q5), so a user's parallel requests see a smaller available balance meanwhile.

### 13.4 The budget stop

Before **every** model call in the run (root or hop): compute that call's `E_call` with its real counted input. If `consumed + E_call > H`, the call is not made and the run stops with status `budget_stopped` (RX-22: "a run stops at the per-run credit cap and settles what ran"). Calls already finished keep their usage entries; nothing that ran is undone. Settle: release `H − consumed`. The same check stops the run when the pool is frozen or empty (the reservation was refused, or H was the whole available balance).

So the per-hop ledger lines always satisfy: **Σ (−amount of the run's usage entries) = consumed ≤ H, and H = consumed + released.**

### 13.5 Example (c): a budget stop in the middle of a chain

An individual Pro runner, `usr_c41d`, wallet `paid`. Workspace agents: A (Claude Sonnet 5.5, Premium 10 / 20 / 11) with the link A → B; B (DeepSeek V4 Pro, Advanced 5 / 6 / 4) with the link B → C; C (DeepSeek V4.1 Flash, Standard 1 / 1 / 1). Depth 2 allows A → B → C. The owner has lowered the per-run cap for A to 2.000000 credits (above the 1-credit floor). Every call has `max_tokens` 4,096. For an Enterprise collaborator the rows are the same except that the account is the company pool and `memberUserId` is the collaborator.

Pre-run estimate (L = 1):

```
E_call(A) = 38,125 × 20 + 4,096 × 11 = 762,500 + 45,056 = 807,556  → 0.807556
E_call(B) = 11,000 × 6  + 4,096 × 4  =  66,000 + 16,384 =  82,384  → 0.082384   (task-size estimate)
E_run     = 2 × 0.807556 + 0.082384 = 1.697496
```

Available 37.902615 ≥ min(1.697496, 2.000000), so the run starts with H = min(2.000000, 37.902615) = 2.000000.

The calls, each with its pre-check:

| Call | Agent (depth) | Pre-check: consumed + E_call ≤ 2.000000? | Tokens new / cached / output | Charge |
|---|---|---|---|---|
| c1 | A (0) | 0.000000 + 0.807556 = 0.807556, yes (38,125 × 20 + 4,096 × 11) | 3,917 / 34,208 / 1,486 | 39,170 + 684,160 + 16,346 = 0.739676 |
| c2 | B (1), called by c1 | 0.739676 + 0.085750 = 0.825426, yes (11,561 × 6 + 4,096 × 4) | 9,384 / 2,177 / 2,318 | 46,920 + 13,062 + 9,272 = 0.069254 |
| c3 | C (2), called by c2 | 0.808930 + 0.011666 = 0.820596, yes (7,570 × 1 + 4,096 × 1) | 6,041 / 1,529 / 3,377 | 6,041 + 1,529 + 3,377 = 0.010947 |
| c4 | B (1), continues after C | 0.819877 + 0.116434 = 0.936311, yes (16,675 × 6 + 4,096 × 4) | 4,772 / 11,903 / 1,940 | 23,860 + 71,418 + 7,760 = 0.103038 |
| c5 | A (0), continues after B | 0.922915 + 1.192736 = 2.115651, **no** (57,384 × 20 + 4,096 × 11) | not called | — |

The run stops before c5 with status `budget_stopped`; consumed = 0.739676 + 0.069254 + 0.010947 + 0.103038 = 0.922915; released = 2.000000 − 0.922915 = 1.077085. A's answer to the user is not written; the run tree shows c1 to c4 and the stop (PRD 10 R9).

| Step | Ledger change | balance | held | available | Σ entries |
|---|---|---|---|---|---|
| before (Σ earlier entries = 37.902615; the newest, a top_up, has balanceAfter 37.902615) | — | 37.902615 | 0.000000 | 37.902615 | 37.902615 |
| reserve the run: 2.000000 (rsv_run_88, open) | none | 37.902615 | 2.000000 | 35.902615 | 37.902615 |
| c1 usage −0.739676 | +1 entry | 37.162939 | 1.260324 | 35.902615 | 37.162939 |
| c2 usage −0.069254 | +1 entry | 37.093685 | 1.191070 | 35.902615 | 37.093685 |
| c3 usage −0.010947 | +1 entry | 37.082738 | 1.180123 | 35.902615 | 37.082738 |
| c4 usage −0.103038 | +1 entry | 36.979700 | 1.077085 | 35.902615 | 36.979700 |
| c5 refused by the budget check | none | 36.979700 | 1.077085 | 35.902615 | 36.979700 |
| settle: release 1.077085 (rsv_run_88 settled, consumed 0.922915) | none | 36.979700 | 0.000000 | 36.979700 | 36.979700 |

The four usage entries:

| Field | c1 | c2 | c3 | c4 |
|---|---|---|---|---|
| seq | 58 | 59 | 60 | 61 |
| type | usage | usage | usage | usage |
| amount | -0.739676 | -0.069254 | -0.010947 | -0.103038 |
| balanceAfter | 37.162939 | 37.093685 | 37.082738 | 36.979700 |
| uncharged | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| memberUserId (runner) | usr_c41d | usr_c41d | usr_c41d | usr_c41d |
| requestId | req_run_88 | req_run_88 | req_run_88 | req_run_88 |
| callId | call_88_1 | call_88_2 | call_88_3 | call_88_4 |
| runId | run_88 | run_88 | run_88 | run_88 |
| agentId | agt_A | agt_B | agt_C | agt_B |
| parentCallId | null | call_88_1 | call_88_2 | call_88_1 |
| modelId / tier | claude-sonnet-5.5 / Premium | deepseek-v4-pro / Advanced | deepseek-v4.1-flash / Standard | deepseek-v4-pro / Advanced |
| rateNew / rateCached / rateOut | 10 / 20 / 11 | 5 / 6 / 4 | 1 / 1 / 1 | 5 / 6 / 4 |
| tokensNew / tokensCached / tokensOut | 3,917 / 34,208 / 1,486 | 9,384 / 2,177 / 2,318 | 6,041 / 1,529 / 3,377 | 4,772 / 11,903 / 1,940 |
| outcome | completed | completed | completed | completed |
| reference | null | null | null | null |
| idempotencyKey | call_88_1 | call_88_2 | call_88_3 | call_88_4 |
| createdAt | 2026-10-14T10:00:09Z | 2026-10-14T10:00:21Z | 2026-10-14T10:00:30Z | 2026-10-14T10:00:44Z |

Check: the entries sum to −0.922915 = −consumed; 0.922915 + 1.077085 = 2.000000 = H; and after every row, balance = 37.902615 + the sum of the new entries. With the default cap of 10 credits the same run would have gone on to c5.

## 14. Frontier rates recomputed against today's prices

Follows: D112 item 38 (RX-19 and RX-21 recompute the Frontier multipliers), D112 item 37 (Fable 5.1, GPT-6 Astra and Gemini 4 Argon stay out of the catalog), research note R-5 (2026-10-14), PRD 02 tier table, the review report's calculator. Result: Decided (D115), item 1.

### 14.1 Prices used (R-5, OpenRouter's public model list read 2026-10-14, dollars per 1,000,000 tokens)

| Model | Tier (PRD 02 / R-5) | new input | cached input | output |
|---|---|---|---|---|
| GLM 5.3 Flash (R-5's baseline) | Standard | 0.15 | 0.03 (from the review report; R-5 gives none) | 0.50 |
| DeepSeek V4.1 Flash (vendor, cache miss) | Standard | 0.15 off-peak, 0.30 peak | 0.005 on OpenRouter | 0.60 off-peak, 1.20 peak |
| Qwen 3.8 Flash | Standard | 0.15 | 0.016 | 0.47 |
| Claude Opus 5.5 | Frontier | 4 | 0.2 | 20 |
| Gemini 4 Argon | Frontier per R-5; out of the catalog (D112) | 2 until 2026-11-30, then 4 | 0.1 | 10, then 20 |
| Claude Fable 5.1, GPT-6 Astra | above Frontier; out of the catalog (D112) | 10 | 0.25 / 1.0 | 50 |

R-5 gives no current price for PRD 02's other two Frontier examples (Claude Opus 5, GPT-5.5). The review report's calculator priced GPT-5.5 at 5 / 0.5 / 30 on 2026-10-08.

### 14.2 R-5's method (the one D112 asks for)

R-5 section 3: compute each model's dollar cost for 1,000,000 tokens at the definition mix (0.36 new, 0.54 cached, 0.10 output) and divide by the same cost for GLM 5.3 Flash. A tier's own rates, blended at the same mix, must be at least that ratio, so that a credit of that tier costs no more to serve than a Standard credit.

```
GLM 5.3 Flash: 0.36 × 0.15 + 0.54 × 0.03 + 0.10 × 0.50 = 0.054 + 0.0162 + 0.05 = $0.1202
Opus 5.5:      0.36 × 4    + 0.54 × 0.2  + 0.10 × 20   = 1.44  + 0.108  + 2.00 = $3.548
ratio:         3.548 ÷ 0.1202 = 29.52
PRD Frontier blended: 0.36 × 17 + 0.54 × 17 + 0.10 × 25 = 6.12 + 9.18 + 2.5 = 17.8
scale:         29.52 ÷ 17.8 = 1.6583
proposed:      17 × 1.6583 = 28.19 → 29;  17 × 1.6583 = 28.19 → 29;  25 × 1.6583 = 41.46 → 42  (rounded up)
blended check: 0.36 × 29 + 0.54 × 29 + 0.10 × 42 = 10.44 + 15.66 + 4.2 = 30.3 ≥ 29.52
```

Proposed Frontier rates: **29 / 29 / 42** (new / cached / output). Scaling keeps PRD 02's proportions between the three kinds and rounds up, as PRD 02 says its multipliers were ("rounded up from the real cost ratio").

At PRD 02's 17 / 17 / 25 a Frontier credit served by Opus 5.5 costs 3.548 ÷ 17.8 = $0.1993; R-5's baseline Standard credit costs $0.1202. With the review report's own GPT-5.5 price (5 / 0.5 / 30) the ratio would be 42.18, above even the proposed 30.3; R-5 suggests replacing GPT-5.5 and Opus 5 with current models, which is RX-21's list.

### 14.3 The review report's method, for comparison

The calculator's worst-case constants show how the report derived 17 / 17 / 25: per token kind, `rate = ceiling(priciest tier price of that kind ÷ priciest Standard price of that kind)`, with the Standard worst case at 0.30 new, 0.03 cached, 1.20 output (DeepSeek V4.1 Flash at peak, GLM cached). This reproduces 11 of the 12 PRD values (Premium cached gives ceiling(0.56 ÷ 0.03) = 19, the PRD has 20). For Frontier the report used GPT-5.5 (5 / 0.5 / 30): 5 ÷ 0.30 = 16.67 → 17, 0.5 ÷ 0.03 = 16.67 → 17, 30 ÷ 1.20 = 25.

Applied to R-5's prices with Opus 5.5 as the priciest Frontier model left in the catalog: 4 ÷ 0.30 = 13.33 → 14; 0.2 ÷ 0.03 = 6.67 → 7; 20 ÷ 1.20 = 16.67 → 17, so **14 / 7 / 17**, lower than PRD 02.

The two methods disagree because they protect different baselines. The report's method keeps a Frontier credit below the **worst-case** Standard credit ($0.2442 at the mix: 0.36 × 0.30 + 0.54 × 0.03 + 0.10 × 1.20), and $0.1993 is below it. R-5's method keeps it below the **typical** Standard credit ($0.1202), which is what PRD 02 plans with ("typical cost about $0.12 per credit"). The Opus 5.5 price has not changed since the review (it is the calculator's typical Frontier row), so the gap comes from the method, not from a price move.

### 14.4 Result

| | new input | cached input | output | blended at the mix |
|---|---|---|---|---|
| **Proposed, used in this document's table (R-5 method)** | **29** | **29** | **42** | 30.3 |
| PRD 02 | 17 | 17 | 25 | 17.8 |
| Review report's method on today's prices | 14 | 7 | 17 | 10.52 |

The tier table in section 1.4 shows the proposed rates with PRD 02's beside them until the Tech Lead decides (open item 1). His approval of this document settles the Frontier rate, and RX-21 seeds what he approves; if he keeps 17 / 17 / 25, only the Frontier rows and the Frontier example in section 1.5 change. R-5 also notes that GLM 5.3 Prime (18.2) is above the Premium blend (15.5); Premium is not recomputed here because D112 asks only for Frontier.

### 14.5 The daily price job's planning-cost alert (RNX-185, D237)

The daily price refresh (RX-21, `apps/api/src/app/config/service/provider-price-refresh.service.ts`) checks every listed model's cost per credit with the method of section 14.2, per model instead of per tier:

```
mix cost      = 0.36 × new-input price + 0.54 × cached-input price + 0.10 × output price   (dollars per 1,000,000 tokens)
blended rate  = 0.36 × new rate + 0.54 × cached rate + 0.10 × output rate                   (the model's tier, tier_rates)
cost per credit = mix cost ÷ blended rate
```

- **Price basis:** the provider list price the job reads (OpenRouter only, D126); where the list gives no price for a kind, the price the row already holds. A model with no cached price at all has its cached share priced at its new-input price. Computed with exact decimals (`config/utils/compute-mix-cost-per-credit.ts`).
- **Thresholds (D237):** $0.14 per credit for each of Standard, Advanced, Premium and Frontier (`offers/config/tier-planning-cost-per-credit.ts`), just above the Standard baseline credit of $0.1202 (section 14.2). There is no default: a model whose tier has no threshold gets no check, and the job logs an error naming the tier and goes on with the other models.
- **Override:** the AppConfig row `tier_planning_cost_per_credit_<tier>` replaces a tier's threshold when its value is a positive dollar amount; any other value is logged as an error and ignored.
- **Alert:** a cost per credit above the threshold is logged (Logger.error) and recorded as a `catalog_changes` row (RX-21, no email: D50). The text names the model, the tier, the cost per credit, the threshold and the price basis.

Examples: GLM 5.3 Flash (0.15 / 0.03 / 0.50) on Standard 1 / 1 / 1 costs $0.1202, no alert. Opus 5.5 (4 / 0.20 / 20) on Frontier 29 / 29 / 42 costs 3.548 ÷ 30.3 = $0.1171, no alert; the old input-only formula (4 ÷ 29 = $0.1379) ignored the output and cached prices. DeepSeek V4.1 Flash at peak (0.30 / 0.03 / 1.20) on Standard costs $0.2442 and alerts.

---

## Sources

| Source | What it fixed for this document | Read |
|---|---|---|
| RX-19 ticket (Notion) | The 13 Scope items, the Out of scope text, the five acceptance criteria, the Frontier scope line (D112) | 2026-10-14 |
| PRD 02 — Credits & Billing | Credit definition, formula, tier table, locked state, free allowance, requirements and acceptance criteria; package table (illustrative) | 2026-10-14 (page edited 2026-10-08) |
| PRD 10 — Peer agents (revision 5) | R3 to R9, R16, R17; Q5 to Q7, Q16, Q17 answers; the 10-credit cap as an assumption (section 11) | 2026-10-14 (page edited 2026-10-09) |
| PRD 04 — Onboarding & Enterprise | Pool, 100 seats, member bar, demo onboarding; D2 open | 2026-10-14 |
| Decision log | The decisions cited in the text: D1, D2, D3, D5, D7, D8, D9, D10, D12, D13, D18, D23, D24, D25, D26, D27, D36, D37, D38, D42, D43, D44, D45, D46, D47, D49, D50, D58, D62, D64, D77, D78, D81, D82, D92, D106, D111, D112. Also read, with no effect on this document: D4, D6, D19, D20, D21, D22 (payments and billing fields), D109 (this ticket's criteria), D110 | 2026-10-14 (page edited 2026-10-14T03:39Z) |
| Review report "Renovix AI Revamp Plan", section "Pricing and credits" and its margin calculator (claude.ai artifact, version 1791465173-1105) | What the rates multiply (calculator code), the Standard rates 1 / 1 / 1, the cost constants, the derivation of the multipliers, the fair-share definition, the reserve-then-settle direction | 2026-10-14 |
| Research note R-5 (Notion, Research Notes) | Today's provider prices; the blended-ratio method; Opus 5.5 at 29.5 times the baseline | 2026-10-14 |
| Tickets RX-20, RX-21, RX-22, RX-29, RX-30, RX-31, RX-39, RX-58, RX-60, RX-86, RX-121 (read in full); RX-32, RX-38, RX-45, RX-53, RX-56, RX-91, RX-98, RX-101, RX-111 (board search results) | What each ticket needs from this document; where D1, D2, D18 and D27 hold work | 2026-10-14 |
| `prisma/schema.prisma`, `apps/api/src/app/billing/`, `apps/api/src/app/usage/` at `d612bb9` | What today's code does (section "Today's code") | 2026-10-14 |
| `docs/billing-direction.md`, `docs/QUOTA_STRATEGY.md`, `docs/OPENROUTER_PRICING_ANALYSIS.md` | Older inputs; superseded where they disagree with PRD 02 or the Decision log | 2026-10-14 |

Every number in sections 1, 2, 3, 11, 12, 13 and 14 is recomputed from the stated inputs by a script kept outside the repository (`build/recompute.py` in the Engineer's RX-19 notes); a reader can recompute any of them by hand from the inputs shown next to it.
