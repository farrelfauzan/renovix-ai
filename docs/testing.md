# API tests

Jest 30 with ts-jest. Spec files live next to the code (`apps/api/src/**/*.spec.ts`); the shared tooling is in `apps/api/test/`.

## Run

```bash
# 1. Start the test database (Postgres 16 + pgvector, host port 55432, named volume)
docker compose -f docker-compose.test.yml -p renovix-test up -d --wait

# 2. Run every API test
TEST_DATABASE_URL=postgresql://renovix:renovix_test@localhost:55432/renovix_test npx nx run api:test

# 3. Type-check the specs and the test tooling
npx tsc --noEmit -p apps/api/tsconfig.spec.json

# When done (removes the container and its volume)
docker compose -f docker-compose.test.yml -p renovix-test down -v
```

Port 55432 taken? Start with `TEST_DB_PORT=55433` and use that port in `TEST_DATABASE_URL`.

`prisma migrate deploy` runs once per test run (Jest `globalSetup`). Without `TEST_DATABASE_URL` the unit tests still run and the database tests fail with a hint.

**Recreating the test database.** RX-90 replaced the migration history with one baseline (`prisma/migrations/20261014200000_baseline`). A test database migrated before that still lists the old migrations and `migrate deploy` refuses it; remove its volume and start it again: `docker compose -f docker-compose.test.yml -p renovix-test down -v`, then step 1. `bun run check` always starts a fresh one.

## `bun run check`

One command for the local check set (`scripts/check.ts`). It runs every step, prints a PASS/FAIL table, and exits 1 if any step failed (naming them), otherwise 0.

1. Module layout (`scripts/check-module-layout.ts`, RX-128): fails and names any source file that lies directly in a feature module folder of `apps/api/src/app/` (only the `*.module.ts` file may; layout in AGENTS.md).
2. Helper rule (`scripts/check-helper-rule.ts`, RX-130, RX-131): fails and names any class method in a service, controller, guard or scheduler of `apps/api/src` that never uses `this`, and any function written outside a class at the top level of those files, unless `scripts/helper-rule-exceptions.ts` lists it with its reason; a list entry that matches nothing any more also fails (rule in AGENTS.md).
3. Prisma imports (`scripts/check-prisma-imports.ts`, RX-132): fails and names any source file of `apps/api/src` outside a repository (`<module>/repository/*.repository.ts`) and the Prisma module that imports PrismaService or the generated Prisma client (`import type` is allowed), unless `scripts/prisma-import-exceptions.ts` lists it. The list may only shrink: an entry that no longer has such an import fails, and so does an entry the list on `origin/main` does not have (rule in AGENTS.md). When that list cannot be read (the base ref is not in the checkout, or it has no list), the step fails and says which (RX-133); `PRISMA_IMPORTS_BASE=<ref>` names another base.
4. Request bodies (`scripts/check-request-bodies.ts`, RNX-28): fails and names any `@Body()` parameter of a controller in `apps/api/src` that is not typed `unknown`, is never passed to a `.safeParse(` of a schema imported from a `dto/` folder, or whose method never calls `createInvalidBodyException` (the one 400 shape for an invalid body). No exception list; the rule is in the header of the script.
5. `bun run prisma:generate` and `bunx prisma validate` (a dummy `DATABASE_URL` is used if none is set).
6. `nx run api:test --skip-nx-cache`, with a test database in one of two modes (it prints which):
   - `TEST_DATABASE_URL` set: used as given, nothing is started.
   - Not set: starts its own compose project (`renovix-check-<pid>-<random>`, free port on 127.0.0.1) from `docker-compose.test.yml` and always runs `down -v` on it afterwards, also on failure and Ctrl-C (the cleanup runs in its own process group, so a group-wide Ctrl-C cannot kill it). Without Docker this step fails.
7. Typecheck of `apps/api/tsconfig.app.json`, `apps/api/tsconfig.spec.json`, and the chat, dashboard and landing `tsconfig.json`. The same programs run in a temporary clean worktree of `origin/main` (after `git fetch origin main`, removed at the end); the baseline is the tip of `origin/main` at run time, so a branch behind main may need main merged or rebased to compare fairly. Errors are compared by file, TS code and message (not line numbers; a file git sees as renamed since `origin/main` is compared under its new path): those already in main are printed under "baseline (not failing)", any other fails the step and is printed under "NEW". Once main has no type errors, any error fails. (`apps/landing/tsconfig.spec.json` is not checked: it does not compile on its own.)
   While a tsc program has ordinary type errors, tsc stops reporting declaration-emit errors for it. When a type-error baseline reaches 0, re-run `bun run check` once to surface any hidden declaration-emit errors.

`docker build` is not part of it; run it separately when a Dockerfile or its inputs change.

**In CI** (RX-149): `.github/workflows/check.yml` runs `bun run check` on every pull request to main and every push to main, with Bun 1.3.11 and Node 22, after `bun install --frozen-lockfile`. On a pull request `origin/main` is fetched first. The check starts its own test database on the runner; no secret is used. The Docker image builds are not part of it (`ci.yml`, which builds them, stays switched off). Every push to main gets its own run. On a push to main the comparison base is the pushed commit itself (the workflow pins `origin/main` to it), so the typecheck baseline and the "added to the list" rule of the Prisma import check only guard pull requests; they cannot fail on a push.

## Safety rule

Tests only use `TEST_DATABASE_URL`, and only if the **database name ends in `_test`**. Anything else is refused before migrating or connecting. During tests `DATABASE_URL` is always overwritten: with `TEST_DATABASE_URL`, or with an address where nothing listens. `resetDatabase` checks `current_database()` again before it truncates.

## Database tests

```ts
import { createTestModule, createFastifyApp } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createPackageSnapshot } from "../../../../test/factories";

let moduleRef: TestingModule;
let prisma: PrismaService;

beforeAll(async () => {
  ({ moduleRef, prisma } = await createTestModule({ providers: [CodesService] }));
});
beforeEach(() => resetDatabase(prisma));
afterAll(() => moduleRef?.close());
```

- `createTestModule(metadata, override?)` builds a Nest testing module with the real `PrismaService` (on the test database), every repository (it imports `RepositoriesModule`, `apps/api/src/app/prisma/repositories.module.ts`, as `AppModule` does; a new repository is added there), the global `AccessGuard` registered as in `AppModule` (RX-114: a route without `@Access` answers 403) plus your `metadata`. `override` receives the builder for `overrideProvider` / `overrideGuard`.
- `createFastifyApp(moduleRef)` starts it as a Fastify app for `app.inject(...)`; close it with `app.close()`.
- `resetDatabase(prisma)` truncates every table except `_prisma_migrations`. The migrations insert no packages; give a test user a package with `createPackageSnapshot`. The truncate also removes the five built-in back-office roles (RX-96): `seedAdminRoles(prisma)` in `apps/api/test/admin-auth.ts` runs the baseline migration's own INSERT again (`createAdmin` there calls it).
- Files run one at a time (`maxWorkers: 1`) because they share one database.
- Every test and every hook has a 30 s timeout (`testTimeout` in `apps/api/jest.config.js`; Jest's default is 5 s), RNX-204. Unloaded, `resetDatabase` (one `TRUNCATE` of every table) takes about 0.1 s and no hook takes more than 0.5 s. Under CPU load in both the Docker VM and the host, such as several sessions running checks at once, the same `TRUNCATE` measured 6 to 10 s, and hooks crossed 5 s ("Exceeded timeout of 5000 ms for a hook") in suites that passed when run alone. A hook or test that never ends still fails, after 30 s.
- The guards load better-auth, which is ESM-only; `apps/api/test/setup-env.ts` mocks it for every spec (no session) and sets `JWT_SECRET`, a fake 32-byte `MCP_ENCRYPTION_KEY` and a fake 32-byte `LLM_KEY_ENCRYPTION_KEY` (all three required, no fallback: RX-110, RX-177; `NODE_ENV` is `test`, so test values need not be 32 characters). A spec that needs a session mocks it itself: `jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))` (the path is relative to the spec's folder; this one is for a spec in a module's layer folder). JWTs signed with `process.env.JWT_SECRET` still go through the real guard.

Examples: `codes/service/codes.service.db.spec.ts` (service), `guards/api-key.guard.spec.ts` (guard), `codes/controller/codes.controller.spec.ts` (controller via Fastify `inject`).

### Race tests

A plain `Promise.all` over the callers does not show a race. Each caller usually finishes before the next one starts on the event loop, so the test passes on broken code on most runs. D83 needs red on every run, so a race test must force the callers to overlap.

Use a held-callers spy. `jest.spyOn` the method that every caller reaches after the checks that can race and before the guarded write. Count the callers as they arrive. Release all of them once N have arrived. Later calls of the same method (inside the transaction) pass straight through, because the promise is already resolved. `afterEach(() => jest.restoreAllMocks())` removes the spy.

```ts
const holdCallersAtRedemptionCheck = (callers: number) => {
  const repository = moduleRef.get(CodeRedemptionRepository);
  const findRedemption = repository.findRedemption.bind(repository);
  let arrived = 0;
  let releaseAll!: () => void;
  const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
  const heldFindRedemption = async (...args: Parameters<typeof findRedemption>) => {
    arrived += 1;
    if (arrived === callers) releaseAll();
    await allArrived;
    return findRedemption(...args);
  };
  jest
    .spyOn(repository, "findRedemption")
    .mockImplementation(heldFindRedemption as typeof findRedemption);
};
```

Hold at the point after every read that decides whether the write is allowed, and before the transaction that writes. Then every caller has passed the checks on the same state before any of them writes, which is the race. Hold inside the transaction instead and the first caller's row lock makes the others wait, so the test proves nothing about the checks. In RX-147 the held method is `findRedemption`: every caller reaches it after the limit check and before `transactions.run` in `codes.service.ts`.

The RX-147 race tests are in `codes/service/codes.service.db.spec.ts`:

- "RX-147: lets two users redeem a multi-use credit code, one ledger row each"
- "RX-147: grants a two-use code to exactly two of three users redeeming at the same moment"
- "RX-147: grants once when the same user redeems one code twice at the same moment (201 and 409, never 500)"

The RX-181 race tests are in the same file. Two of them hold inside the transaction on purpose: the two callers redeem different codes, so they lock different code rows and both reach the hold. "a user with no subscription redeeming two plan codes at once ..." holds both callers at `createSubscription` (`holdSubscriptionCreates`); "a user with an active subscription redeeming two plan codes at once ..." holds both right after `findSubscriptionByUserId` (`holdCallersAfterSubscriptionRead`). The deactivated and expired tests run the admin's change while the caller is held at `findRedemption` (`changeCodeAfterPreChecks`).

These tests rely on Postgres READ COMMITTED, the default isolation level of `TransactionService.run` (`apps/api/src/app/prisma/transaction.service.ts`), which sets no isolation level unless `options` are passed. Under READ COMMITTED a conditional `updateMany` re-reads the row after a concurrent commit, which is why `claimRedemption` is safe.

A race-fix PR shows D83 evidence:

- Red on the old code on every run (at least 3 runs).
- Green after the fix on every run (at least 3 runs).
- Two planted faults, each turning its test red before the code is restored:
  - (a) Remove the guard: the `timesRedeemed: { lt: ... maxRedemptions }` condition of `claimRedemption` in `invitation-code.repository.ts`.
  - (b) Wrong order: move `findRedemption(code.id, userId, tx)` before `claimRedemption` in `codes.service.ts`.

## Factories

`apps/api/test/factories.ts`: `createUser`, `createPackageSnapshot(prisma, { userId })` (a package, its version and the user's purchase snapshot, which `EntitlementService` reads), `createAgent({ userId })` (RNX-117: without a `workspaceId` the agent goes into its user's default workspace, created if needed, as in production), `createWorkspace({ ownerId })`, `createProvider({ createdByAdminId })` (RX-177: an `openai_compatible` provider record of the fake provider, its obviously fake key sealed with the test `LLM_KEY_ENCRYPTION_KEY`; `apiKey` sets the plaintext), `createModel({ providerRecordId })` (RX-177: an active standard-tier model on that provider), `createApiKey(prisma, userId, { apiKey?, revokedAt?, expiresAt? })` (RNX-18: stores the key as the API does, prefix and HMAC under the test `API_KEY_HASH_SECRET`, and returns the plaintext; `testApiKey(seed)` gives a fixed well-formed `rnx_live_` key for a spec constant). Each fills the required fields with unique values; pass any field to override it. The migrations and the seed write no provider or model (RX-177): create them with these factories. A chat call resolves its slug to the model's provider record (RX-178), so a test whose code calls a model needs one on an active provider: `createResolvableModel(prisma, { slug, ..., provider: { baseUrl, apiKey } })` (`apps/api/test/provider-model.ts`: a fresh admin, an active `createProvider`, a `createModel` on it; then `ModelRegistryService.refresh()`). A test that calls the adapter or router directly passes `testConnection({ baseUrl, apiKey })` as the request's `connection`.

Credits (RX-22): the chat, portal and grant paths read and write only the credit ledger, never `User.balance`. Fund a user with `fundPaidWallet(prisma, userId, amount)` (`apps/api/test/credit-funding.ts`, one `bonus` entry through the real `CreditLedgerService`), and check I1/I2 with `assertCreditLedgerInvariants(prisma)` (`apps/api/test/credit-ledger-invariants.ts`) after a test that writes. `realPromptTuning()` (`apps/api/test/real-prompt-tuning.ts`) gives the real PromptTuningService and the knowledge services it calls (dummy S3 and embedding settings), so a test can spy on `EmbeddingService.embedSingle` (RX-22 review B1).

## Fake LLM provider

Tests never call OpenRouter. `FakeProviderAdapter` replays scripted turns (text, tool calls, token usage), one per call, and records requests in `fake.requests`:

```ts
const fake = new FakeProviderAdapter([
  { toolCalls: [{ name: "calculator", arguments: { expression: "2+2" } }] },
  { content: "It is 4.", usage: { prompt_tokens: 20, completion_tokens: 4 } },
]);
const { moduleRef } = await createTestModule({ imports: [ProvidersModule] }, (b) => withFakeProvider(b, fake));
```

`withFakeProvider` replaces `OpenRouterAdapter`, so `ProviderRouter`'s `"openrouter"` adapter is the fake and no real adapter (or API key) is created. Its output has the same shape as the real adapter: `chat` returns tool calls on `choices[0].message.tool_calls`; `chatStream` yields the JSON payload of each SSE `data:` line (no `[DONE]`): content deltas, tool-call deltas (`id` and name first, then argument fragments), a `finish_reason` chunk, and OpenRouter's final usage chunk. Running out of turns throws. A turn's `usage.cached_tokens` is reported as `prompt_tokens_details.cached_tokens` (and as `cachedTokens` by `chat`); a turn with `error: { code, message }` makes `chat` throw a `ProviderHttpError` with that status and `chatStream` end with OpenRouter's mid-stream error chunk (top-level `error`, `finish_reason: "error"`, no usage chunk) (RX-22). Example: `providers/provider-router.fake.spec.ts`. A provider test (RX-177, `testConnection`) is answered with success unless the test calls `fake.setTestResult({ isSuccessful: false, reason })`; each call is recorded in `fake.testRequests`.

## Running the API with the fake LLM provider

`LLM_PROVIDER=fake` (RX-88) runs the whole API without a model provider: every LLM call goes to the canned `FakeProviderAdapter` (`apps/api/src/app/providers/fake.adapter.ts`), whatever provider name the model row has. Only the environment selects it; no header, query parameter, body field or database setting can.

- Env: `LLM_PROVIDER=fake`, no `OPENROUTER_API_KEY`, `LLM_API_KEY` or `EMBEDDING_API_KEY` (also not in `.env`), `NODE_ENV` not `production`. The API refuses to start otherwise (`LLM_PROVIDER=fake is not allowed in production`; `... refuses to start while OPENROUTER_API_KEY is set ...`, likewise for the other two keys, RX-160), and also on any `LLM_PROVIDER` other than unset, `openrouter` or `fake`. At startup it logs `LLM provider: FAKE — no real model calls. Never use in production.`
- Reply: always `This is a canned reply from the fake LLM provider. No real model was called.` Streamed, it comes one word per chunk, then a `finish_reason: "stop"` chunk and a usage chunk.
- Tool call: when the last user message contains `[[fake:tool]]` and the request offers tools, the reply is one call to the first offered tool with `{}` as arguments. The next call (its last message is the tool result) gets the canned text, so the agent loop ends.
- Usage: `prompt_tokens` = characters of all messages / 4, `completion_tokens` = characters of the reply (or tool name) / 4, rounded up, at least 1. Metering and billing see these numbers.
- Embeddings are fake too: `EmbeddingService` returns a 1024-dimension vector (the `vector(1024)` column) derived from SHA-256 of the text: same text, same vector; no network, no key.

## Auth and ownership map

Current behaviour, characterized in RX-15 (paths under `apps/api/src/app/`). Since RX-114 a route declares `@Access` and the one global `AccessGuard` (`apps/api/src/common/guards/access.guard.ts`) runs these guards as the checks behind its methods: `jwt` and `session` (`CombinedAuthGuard`), `apiKey` (`ApiKeyGuard`), `portal` (`PortalGuard`); a valid credential of a method the route does not list is 403 (`common/guards/access.guard.spec.ts`). A `test.failing` marked `HOLE (RX-15)` asserts the secure behaviour: it passes while the hole exists and fails once it is fixed; then turn it into a normal test.

| Guard | Accepts | Rejects | Spec |
|---|---|---|---|
| `CombinedAuthGuard` (guards/combined-auth.guard.ts:26) | `Bearer` JWT signed with `JWT_SECRET` (`exp` checked, no DB lookup, payload shape not checked); else a Better Auth session from the cookie (expiry is `getSession`'s job) | 401: no credential, expired, other secret, `alg: none`, API key, `bearer`/`Basic`, no session | guards/combined-auth.guard.spec.ts |
| `ApiKeyGuard` (guards/api-key.guard.ts:19) | `Bearer rnx_live_…` (RNX-18): looked up in `api_keys` by prefix, HMAC-SHA256 compared in constant time, not revoked, not expired; records `lastUsedAt` (`user.status` not checked) | 401: no header, JWT, wrong prefix/scheme (`sk_live_` included), unknown, wrong (valid prefix), revoked or expired key | guards/api-key.guard.spec.ts, auth/controller/api-key.controller.spec.ts |
| `PortalGuard` (portal/guard/portal.guard.ts:31) | Always allows when `X-Portal-Session` is set; user from a valid JWT, else the cookie session; anything else is anonymous (free tier) | 401 without `X-Portal-Session` (RX-114; was 400). Routes needing a user answer 400 "Authentication required", not 401 | portal/guard/portal.guard.spec.ts |

| Resource | Routes | Guard | Ownership / role check | Spec |
|---|---|---|---|---|
| Agents | `/agents/:id…` | Combined | `where: { id, userId }` in agent/service/agent.service.ts:108, :133, :201; `verifyOwnership` :639 → 404. The `parentAgentId` hole was fixed by RX-112; RNX-118 removed `parentAgentId` (ignored when sent) | agent/controller/agent.ownership.spec.ts |
| Agent links (RNX-118) | `/agents/:id/links…` | Combined | `AgentLinkService.findOwnedAgent` (agent/service/agent-link.service.ts): only the agent's workspace owner (`workspace.ownerId`) → else 403 (collaborator, other user; another user's API key is 403 at the guard); callee in another workspace → 403; itself → 400. At run time `call_agent` is offered only to an agent with links run by its workspace owner or a current collaborator (R17: a public agent stands alone for anyone else) | agent/controller/agent-link.routes.spec.ts, agent/service/agent-run.agent-links.spec.ts, channel/service/channel-chat.agent-links.spec.ts |
| Channels | `/channels/:id…` | Combined | `where: { id, userId }` in channel/service/channel.service.ts:60, :86, :117, :129; `resolveChannelAgent` :325 → 404. Public active agents of others may be added (by design) | channel/controller/channel.ownership.spec.ts |
| Workspaces | `/workspaces/:id…` | Combined | `getById` workspace/service/workspace.service.ts:88 (active member, else 404); `requireMembership` :155 / `requireRole` :133 (403). Read: any active member. PATCH workspace, members, invites: owner, admin. Archive: owner | workspace/controller/workspace.ownership.spec.ts |
| Workspace via channel | `/channels/:channelId/workspace…` | Combined | `resolveWorkspace` workspace/controller/workspace-channel.controller.ts:41 (channel owner or active member, else 403) + `requireRole`; KB scoped by workspace-knowledge.service.ts:43 (404). KB create/delete: owner, admin; add chunks: owner, admin, member | workspace/controller/workspace.ownership.spec.ts |
| Conversations | `/conversations/:id` | ApiKey | `where: { id, userId }` chat/service/conversation.service.ts:225, :289 → 404 | chat/controller/conversation.ownership.spec.ts |
| Conversations (portal) | `/chat/portal/conversations/:id` | Portal | same service → 404 | portal/controller/portal.ownership.spec.ts |
| Knowledge | `/v1/knowledge/bases/:id…` | ApiKey | `getKnowledgeBase` knowledge/service/knowledge.service.ts:47 (`kb.userId`) → 403. **Hole:** a workspace KB stays readable by its creator after removal from the workspace | knowledge/controller/knowledge.ownership.spec.ts |
| Knowledge (portal) | `/chat/portal/knowledge/:id…` | Portal | same service → 403 | portal/controller/portal.ownership.spec.ts |

## Run-loop scenario index (RNX-16)

Where each run-loop scenario is characterized (current behaviour, fake provider), per entry point. Paths are under `apps/api/src/app/`; test names are quoted as written (`%s` and `%i` are `it.each` titles). The tests named "RNX-16 …" were added by RNX-16, each shown red with a planted fault in the source (D83). "Gap" means the scenario applies but no test covers it. `sseEvents(body)` (`apps/api/test/sse-client.ts`) parses an SSE body into its ordered events, for exact-sequence assertions.

Entry points:

- **AR**, agent run: `POST /agents/:id/chat` (agent/controller/agent-run.controller.ts) and the GoWA webhook (channel/controller/gowa.webhook.controller.ts:94), both `AgentRunService.chat` (agent/service/agent-run.service.ts).
- **CH**, channel chat: `POST /channels/:id/agents/:agentId/chat` (channel/controller/channel.controller.ts), `ChannelChatService.chat` (channel/service/channel-chat.service.ts).
- **PO free**, **PO paid**: `POST /chat/portal/completions` (portal/controller/portal.controller.ts, `handleFreeRequest` and `handlePaidRequest`): one streamed model call, no tools, no output guardrail.
- **CC**: `POST /chat/completions` (chat/service/chat.service.ts): one model call per request; no agent, no tool loop (the request schema has no tools), no guardrail.
- **RM**: the reminder scheduler loop (reminder/scheduler/reminder.scheduler.ts): an agent tool loop, metered as a run; no guardrail, no call_agent.

| Scenario | AR | CH | PO free | PO paid | CC | RM |
|---|---|---|---|---|---|---|
| Plain reply | agent/controller/agent-run.run-loop.spec.ts "RNX-16 plain reply (AR): the exact SSE events are status, one content chunk, session info, [DONE]; the stored assistant message has the call's total tokens and no cost" | channel/controller/channel.run-loop.spec.ts "RNX-16 plain reply (CH): the exact SSE events are status, one content chunk, {done: true}, [DONE]; the stored assistant message has the call's total tokens and no cost" | portal/controller/portal.controller.spec.ts "uses the cheapest standard-tier model, then answers 429 free_limit_reached at the per-IP cap" (the reply, not the event list) | portal/controller/portal.run-loop.spec.ts "RNX-16 plain reply (PO paid): the exact SSE events are two statuses, the provider's chunks as streamed, the conversation id, [DONE]; the usage entry has the reported tokens and the answer is saved" | chat/controller/chat.stream.spec.ts "AC1: text/event-stream, chat.completion.chunk events whose deltas join to the answer, then [DONE]; one completed entry, settled, held 0" | Gap: no test asserts the stored reply (the AC4 run below ends in a final answer; only its ledger is asserted) |
| Tool call and follow-up | agent/service/agent-run.run-loop.db.spec.ts "RNX-16 tool call and follow-up (AR): only the user message and the final answer are stored (no tool messages), and the ledger has one usage entry per model call" | channel/service/channel-chat.run-loop.db.spec.ts "RNX-16 tool call and follow-up (CH): only the user message and the final answer are stored (no tool messages), and the ledger has one usage entry per model call"; channel/service/channel-chat.ledger.db.spec.ts "AC4: a channel chat is charged through the ledger, one entry per model call" | Does not apply: no tools | Does not apply: no tools | Does not apply: no tool loop | reminder/scheduler/reminder.scheduler.ledger.db.spec.ts "AC4: a reminder run is charged through the ledger, one entry per model call" (ledger only) |
| Agent call, one hop | agent/service/agent-run.ledger.db.spec.ts "root call, sub-agent hop, root answer: three usage entries with the agent, the run, the parent call and the runner"; agent/service/agent-run.agent-links.spec.ts "the owner runs A: B runs (positive control)" | channel/service/channel-chat.agent-links.spec.ts "the workspace owner, with A -> B: call_agent is offered, B is listed, and the call runs B (positive control)" | Does not apply: no agent | Does not apply: no agent | Does not apply: no agent | Does not apply: call_agent is never offered (no `injectCallAgent`, `linkedAgents: []`, reminder.scheduler.ts:169-174, :190) |
| Refused cycle | Not possible: a called agent gets no tools, so it cannot call back (agent-run.service.ts:511-528; RNX-121) | Not possible: same (channel-chat.service.ts:498-511; RNX-121) | Does not apply | Does not apply | Does not apply | Does not apply: no call_agent |
| Budget stop | agent/service/agent-run.ledger.db.spec.ts "a run that reaches the cap stops before the next call (a hop), settles what ran, and nothing more is charged" and "RNX-16 budget stop (AR): the stored assistant message holds the budget-stop text after the user message, with 0 tokens (the call that ran is not counted) and no cost"; agent/service/agent-run.mcp-cleanup.db.spec.ts "budget stop: the stop message, closed once, what ran settled"; agent/service/agent-run.output-guardrail.db.spec.ts "the budget-stop message still goes through the guardrail once and is stored as returned" | channel/service/channel-chat.ledger.db.spec.ts "a channel chat that reaches the per-run cap stops, saves the stop message and settles what ran" | Does not apply: one call, no run budget | Does not apply: one call, its own reservation | Does not apply: one call, its own reservation | Gap: the loop stores the budget-stop message (reminder.scheduler.ts:198-212), no test |
| Collaborator run | agent/service/agent-run.run-policy.db.spec.ts "an Enterprise collaborator runs it with the same prompt, model, knowledge and links as the owner" and "a subscribed collaborator's run reserves on the collaborator's own paid wallet, not the owner's"; agent/service/agent-run.collaborator-credentials.db.spec.ts "the collaborator has connected it: the tool runs on the collaborator's own server, never the owner's" | channel/service/channel-chat.run-policy.db.spec.ts "a collaborator's channel chat runs the private workspace agent and reserves on the collaborator's own paid wallet (control)" | Does not apply: no agent | Does not apply: no agent | Does not apply: no agent | reminder/scheduler/reminder.scheduler.run-policy.db.spec.ts "a collaborator's reminder fires and reserves on the collaborator's own paid wallet (control)" |
| Tool not connected: an unknown tool name (neither a built-in nor an MCP tool of the run) | agent/service/agent-run.run-loop.db.spec.ts "RNX-16 unknown tool name (AR): a call to a name that is neither a built-in nor an MCP tool runs nothing; the next request carries the 'not available' tool result and the run ends with the final answer"; agent/service/agent-tool.service.spec.ts "returns 'not available' and evaluates nothing when the model calls code_exec" | channel/service/channel-chat.run-loop.db.spec.ts "RNX-16 unknown tool name (CH): a call to a name that is neither a built-in nor an MCP tool runs nothing; the next request carries the 'not available' tool result and the run ends with the final answer" | Does not apply: no tools | Does not apply: no tools | Does not apply: no tool loop | Gap: same `executeTool` default branch (reminder.scheduler.ts:263), no test |
| Tool not connected: a built-in tool the agent was not given (**current behaviour is a bug**, [BUG] on RNX-16: `executeTool` dispatches built-ins by name without checking the offered schemas, agent/service/agent-tool.service.ts:369-404) | agent/service/agent-run.run-loop.db.spec.ts "RNX-16 built-in tool not offered (AR), pins a [BUG] on RNX-16: the agent was not given calculator, yet a call to it runs (executeTool dispatches built-ins by name); flip this test when the fix lands" | channel/service/channel-chat.run-loop.db.spec.ts "RNX-16 built-in tool not offered (CH), pins a [BUG] on RNX-16: the agent was not given calculator, yet a call to it runs (executeTool dispatches built-ins by name); flip this test when the fix lands" | Does not apply: no tools | Does not apply: no tools | Does not apply: no tool loop | Gap: same `executeTool` (reminder.scheduler.ts:263), no test |
| Public agent run by a non-member | agent/service/agent-run.agent-links.spec.ts "a non-member runs A: no call_agent is offered, B is not listed, and a call to B never runs"; agent/service/agent-run.run-policy.db.spec.ts "an outsider running the public agent: no workspace memory in the prompt, no extraction call, no fact written" | channel/service/channel-chat.agent-links.spec.ts "R17: someone outside the workspace runs the public A: no call_agent, B not listed, and a call to B never runs"; channel/service/channel-chat.run-policy.db.spec.ts "AC5: an outsider's channel chat with the public agent: no workspace memory in the prompt, no extraction, no fact written" | Does not apply: no agent | Does not apply: no agent | Does not apply: no agent | reminder/scheduler/reminder.scheduler.run-policy.db.spec.ts "AC2: the public agent is unpublished before the fire time of an outsider's reminder: the fire is skipped, nothing charged" (the refusal only; a fire that runs is a gap) |
| Guardrail block, input | agent/controller/agent-run.run-loop.spec.ts "RNX-16 input guardrail block (AR): only the classifier calls the model; the decline is streamed as the content chunk and stored after the user message; nothing is reserved" | channel/controller/channel.run-loop.spec.ts "RNX-16 input guardrail block (CH): only the classifier calls the model; the decline is streamed as the content chunk and stored after the user message; nothing is reserved" | portal/controller/portal.run-loop.spec.ts "RNX-16 input guardrail block (PO free): the decline is the only content chunk, then [DONE]; no model call; checked with the portal session id; the blocked message still counts against the session's free requests" | portal/controller/portal.run-loop.spec.ts "RNX-16 input guardrail block (PO paid): the decline is the only content chunk, then [DONE]; no model call, no reservation, no usage entry, nothing saved" | Does not apply: no guardrail | Does not apply: no guardrail |
| Guardrail block, output | agent/controller/agent-run.run-loop.spec.ts "RNX-16 output guardrail block (AR): the streamed reply and the stored assistant message are the sanitized text; the raw answer is in no stored message and memory is not called"; agent/service/agent-run.output-guardrail.db.spec.ts (RNX-275, AC1 to AC4) | channel/controller/channel.run-loop.spec.ts "RNX-16 output guardrail block (CH): the streamed reply, the stored assistant message and the memory input are the sanitized text; the raw answer is in no stored message" | Does not apply: no output guardrail (deltas are streamed as they come) | Does not apply: no output guardrail | Does not apply: no guardrail | Does not apply: no guardrail |
| Quota failure | agent/service/agent-run.ledger.db.spec.ts "no available credits: 402 CREDITS_EXHAUSTED before any write or model call"; agent/controller/agent-run.refuse-before-sse.spec.ts "AC1: a subscribed user with 0 ledger credits → HTTP 402 CREDITS_EXHAUSTED, no SSE header, no model call (classifier included), nothing saved" | channel/controller/channel.refuse-before-sse.spec.ts "AC1: a user with 0 ledger credits → HTTP 402 CREDITS_EXHAUSTED, no SSE header, no model call (classifier included), no message" | portal/controller/portal.controller.spec.ts "uses the cheapest standard-tier model, then answers 429 free_limit_reached at the per-IP cap" and "RX-138: a session already at today's 20 requests answers 429 free_limit_reached and counts nothing" | portal/controller/portal.stream-error.spec.ts "AC: 402 CREDITS_EXHAUSTED before the stream opens when the paid wallet cannot cover the estimate; nothing written, no provider call" | chat/controller/chat.stream.spec.ts "AC3 (negative): 0 credits + stream:true → HTTP 402 CREDITS_EXHAUSTED JSON, no SSE header, no provider or embedding call" | reminder/scheduler/reminder.scheduler.ledger.db.spec.ts "an owner without ledger credits: the reminder run is refused with 402 before any model call" |
| Provider error, retry and fallback | agent/service/agent-run.ledger.db.spec.ts "a provider error on the root call is charged 0 (outcome provider_error) and the hold is released"; agent/service/agent-run.run-loop.db.spec.ts "RNX-16 router fallback (AR): the first attempt answers 503, the fallback model answers, and exactly one provider_error usage entry is written for the failed attempt" | channel/controller/channel.provider-error.spec.ts "AC6: provider answers 400 → SSE error event naming 400, response ends, health answers"; channel/service/channel-chat.run-loop.db.spec.ts "RNX-16 router fallback (CH): the first attempt answers 503, the fallback model answers, and exactly one provider_error usage entry is written for the failed attempt" | portal/controller/portal.stream-error.spec.ts "AC1: free tier, provider answers 400 → SSE error event naming 400, response ends, health answers" and "AC2: the provider answers %i → SSE error event naming it, the env fallback receives 0, health answers"; fallback to a fallback model: gap | portal/controller/portal.stream-error.spec.ts "AC5: paid tier, provider answers 400 → SSE error event naming 400 with the no-charge note, hold released, health answers"; portal/controller/portal.run-loop.spec.ts "RNX-16 router fallback (PO paid): the first attempt answers 503, the answer streams from the fallback model, and exactly one provider_error usage entry is written for the failed attempt" | chat/controller/chat.fallback.spec.ts "AC1: P1 answers 503 → P2 receives model y with P2's key; the client gets P2's answer" and "regression: a 503 on a model without a fallback writes exactly one provider_error entry and releases the hold"; chat/controller/chat.provider-error.spec.ts "AC7: provider answers 400 → HTTP 500 JSON, a provider_error entry of 0, the hold released, balance unchanged, health answers" | Gap: no provider-error or fallback test |

The fake provider's `chatStream` reports a scripted `error` as a mid-stream chunk, which never falls over; the PO paid fallback test makes the first `chatStream` call throw a 503 before its first payload with a `jest.spyOn(fake, "chatStream").mockImplementationOnce(...)`.

### AR and CH differences RNX-23 must choose between

Lines are in agent/service/agent-run.service.ts (AR), channel/service/channel-chat.service.ts (CH) and their controllers.

- **Loop limit.** AR: 15 iterations (:32), and a call_agent counts 3 (`iterations += 2` at :403, then `iterations++` at :431). CH: 30 (:20), a call_agent counts 1 (:364). The max-steps texts differ: AR "I've reached the maximum number of processing steps. Here's what I have so far." (:444), CH "I've completed as much as I could, …" (:435).
- **`finish_reason: "length"`.** CH asks the model to continue and joins the parts (:369-386); AR takes the cut answer as final (:432-438).
- **Tool results.** CH (and RM, reminder.scheduler.ts:277) cut a tool result to 4,000 characters plus "\n...[truncated]" (:349-351); AR passes it whole (:415-419).
- **A response without a choice.** AR throws `BadRequestException("No response from LLM")` (:388-389); CH ends the loop (`break`, :314-315) and so saves and returns its max-steps text.
- **Hop failures (call_agent).** Missing agent: AR "Error: Missing agent. Provide the name or id of a callable agent." (:472), CH "Error: Missing agent." (:465). Callee model not available: AR `Error: ${MODEL_UNAVAILABLE_MESSAGE}` (:501), CH `Error: Sub-agent model "<slug>" unavailable.` (:481, names the slug). A failed callee model call: AR returns `Error: Sub-agent LLM call failed (<status>): <message>` (:536); CH lets it reach the tool call's catch, `Error: <message>` (:356-360). An empty callee answer: AR "Sub-agent completed without output." (:541), CH "Sub-agent returned empty response." (:515).
- **Gate order.** AR's `chat` checks the input guardrail (:94-115) before the subscription gate and the credit pre-check (:119-120); on the route the pre-check `assertRunCanStart` runs first (agent-run.controller.ts:62), but the GoWA webhook calls `chat` directly (gowa.webhook.controller.ts:94). CH checks the subscription gate (:92) before the input guardrail (:95). On both routes the document-intent classifier calls the model before the guardrail (agent-run.controller.ts:66, channel.controller.ts:285), so an input block still makes one model call (none when the request names an `output_format`).
- **SSE.** AR: classifier, then the headers (agent-run.controller.ts:66, :69); `{status}`, one content chunk, `{sessionId, runId}` (:154), `[DONE]` (:157); an error event is followed by `[DONE]` (:169-171). CH: the headers before the classifier (channel.controller.ts:265, :285), a `: heartbeat` comment every 15 s (:275-279); `{status}`, one content chunk, `{done: true}` (:381), `[DONE]` (:384); an error event ends the stream without `[DONE]` (:397-399).
- **Cost and tokens.** AR's loop never sets `totalCost` (:349, returned at :437 and :446), so the stored assistant message has no cost and the reply's `usage.cost` is undefined (an input block answers `cost: "0"`, :113); CH stores no cost either. A budget stop stores tokens 0 on AR (:301) and none (null) on CH (:249-253).
- **Memory.** AR does not memorise an answer the output guardrail blocked (RNX-275, :159-165); CH memorises the sanitized text (:413-418). CH saves (and memorises) nothing for an empty answer (:402, :427); AR saves an empty assistant message.

## Notes

- The Prisma client is generated as CommonJS (`moduleFormat = "cjs"`, RX-64); `jest.config.js` maps its `@generated/prisma/*.js` alias and the `.js` suffixes of its relative imports.
- Spec files stay out of `tsconfig.app.json`; `tsconfig.spec.json` type-checks them with Jest types. Its errors in non-spec files are the app's own (see `tsc -p apps/api/tsconfig.app.json`).
