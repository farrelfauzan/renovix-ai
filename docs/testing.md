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

## `bun run check`

One command for the local check set (`scripts/check.ts`). It runs every step, prints a PASS/FAIL table, and exits 1 if any step failed (naming them), otherwise 0.

1. `bun run prisma:generate` and `bunx prisma validate` (a dummy `DATABASE_URL` is used if none is set).
2. `nx run api:test --skip-nx-cache`, with a test database in one of two modes (it prints which):
   - `TEST_DATABASE_URL` set: used as given, nothing is started.
   - Not set: starts its own compose project (`renovix-check-<pid>-<random>`, free port on 127.0.0.1) from `docker-compose.test.yml` and always runs `down -v` on it afterwards, also on failure and Ctrl-C (the cleanup runs in its own process group, so a group-wide Ctrl-C cannot kill it). Without Docker this step fails.
3. Typecheck of `apps/api/tsconfig.app.json`, `apps/api/tsconfig.spec.json`, and the chat, dashboard and landing `tsconfig.json`. The same programs run in a temporary clean worktree of `origin/main` (after `git fetch origin main`, removed at the end); the baseline is the tip of `origin/main` at run time, so a branch behind main may need main merged or rebased to compare fairly. Errors are compared by file, TS code and message (not line numbers): those already in main are printed under "baseline (not failing)", any other fails the step and is printed under "NEW". Once main has no type errors, any error fails. (`apps/landing/tsconfig.spec.json` is not checked: it does not compile on its own.)
   While a tsc program has ordinary type errors, tsc stops reporting declaration-emit errors for it. When a type-error baseline reaches 0, re-run `bun run check` once to surface any hidden declaration-emit errors.

`docker build` is not part of it; run it separately when a Dockerfile or its inputs change.

## Safety rule

Tests only use `TEST_DATABASE_URL`, and only if the **database name ends in `_test`**. Anything else is refused before migrating or connecting. During tests `DATABASE_URL` is always overwritten: with `TEST_DATABASE_URL`, or with an address where nothing listens. `resetDatabase` checks `current_database()` again before it truncates.

## Database tests

```ts
import { createTestModule, createFastifyApp } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser, createPlan } from "../../../test/factories";

let moduleRef: TestingModule;
let prisma: PrismaService;

beforeAll(async () => {
  ({ moduleRef, prisma } = await createTestModule({ providers: [CodesService] }));
});
beforeEach(() => resetDatabase(prisma));
afterAll(() => moduleRef?.close());
```

- `createTestModule(metadata, override?)` builds a Nest testing module with the real `PrismaService` (on the test database) plus your `metadata`. `override` receives the builder for `overrideProvider` / `overrideGuard`.
- `createFastifyApp(moduleRef)` starts it as a Fastify app for `app.inject(...)`; close it with `app.close()`.
- `resetDatabase(prisma)` truncates every table except `_prisma_migrations`. This also removes the three plans the migrations seed; create the plans a test needs with `createPlan`.
- Files run one at a time (`maxWorkers: 1`) because they share one database.
- Modules that import `CombinedAuthGuard` or `SessionGuard` load better-auth, which is ESM-only; mock it in the spec: `jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }))`. JWTs signed with `process.env.JWT_SECRET` still go through the real guard.

Examples: `codes/codes.service.db.spec.ts` (service), `guards/api-key.guard.spec.ts` (guard), `codes/codes.controller.spec.ts` (controller via Fastify `inject`).

## Factories

`apps/api/test/factories.ts`: `createUser`, `createPlan`, `createSubscription({ userId, planId })`, `createAgent({ userId })`, `createWorkspace({ ownerId })`. Each fills the required fields with unique values; pass any field to override it.

## Fake LLM provider

Tests never call OpenRouter. `FakeProviderAdapter` replays scripted turns (text, tool calls, token usage), one per call, and records requests in `fake.requests`:

```ts
const fake = new FakeProviderAdapter([
  { toolCalls: [{ name: "calculator", arguments: { expression: "2+2" } }] },
  { content: "It is 4.", usage: { prompt_tokens: 20, completion_tokens: 4 } },
]);
const { moduleRef } = await createTestModule({ imports: [ProvidersModule] }, (b) => withFakeProvider(b, fake));
```

`withFakeProvider` replaces `OpenRouterAdapter`, so `ProviderRouter`'s `"openrouter"` adapter is the fake and no real adapter (or API key) is created. Its output has the same shape as the real adapter: `chat` returns tool calls on `choices[0].message.tool_calls`; `chatStream` yields the JSON payload of each SSE `data:` line (no `[DONE]`): content deltas, tool-call deltas (`id` and name first, then argument fragments), a `finish_reason` chunk, and OpenRouter's final usage chunk. Running out of turns throws. Example: `providers/provider-router.fake.spec.ts`.

## Running the API with the fake LLM provider

`LLM_PROVIDER=fake` (RX-88) runs the whole API without a model provider: every LLM call goes to the canned `FakeProviderAdapter` (`apps/api/src/app/providers/fake.adapter.ts`), whatever provider name the model row has. Only the environment selects it; no header, query parameter, body field or database setting can.

- Env: `LLM_PROVIDER=fake`, no `OPENROUTER_API_KEY` (also not in `.env`), `NODE_ENV` not `production`. The API refuses to start otherwise (`LLM_PROVIDER=fake is not allowed in production`; `... refuses to start while OPENROUTER_API_KEY is set ...`), and also on any `LLM_PROVIDER` other than unset, `openrouter` or `fake`. At startup it logs `LLM provider: FAKE — no real model calls. Never use in production.`
- Reply: always `This is a canned reply from the fake LLM provider. No real model was called.` Streamed, it comes one word per chunk, then a `finish_reason: "stop"` chunk and a usage chunk.
- Tool call: when the last user message contains `[[fake:tool]]` and the request offers tools, the reply is one call to the first offered tool with `{}` as arguments. The next call (its last message is the tool result) gets the canned text, so the agent loop ends.
- Usage: `prompt_tokens` = characters of all messages / 4, `completion_tokens` = characters of the reply (or tool name) / 4, rounded up, at least 1. Metering and billing see these numbers.
- Embeddings are fake too: `EmbeddingService` returns a 1024-dimension vector (the `vector(1024)` column) derived from SHA-256 of the text: same text, same vector; no network, no key.

## Auth and ownership map

Current behaviour, characterized in RX-15 (paths under `apps/api/src/app/`). A `test.failing` marked `HOLE (RX-15)` asserts the secure behaviour: it passes while the hole exists and fails once it is fixed; then turn it into a normal test.

| Guard | Accepts | Rejects | Spec |
|---|---|---|---|
| `CombinedAuthGuard` (guards/combined-auth.guard.ts:26) | `Bearer` JWT signed with `JWT_SECRET` (`exp` checked, no DB lookup, payload shape not checked); else a Better Auth session from the cookie (expiry is `getSession`'s job) | 401: no credential, expired, other secret, `alg: none`, API key, `bearer`/`Basic`, no session | guards/combined-auth.guard.spec.ts |
| `SessionGuard` (guards/session.guard.ts:16) | Better Auth session only. Not used by any route | 401 otherwise | guards/session.guard.spec.ts |
| `ApiKeyGuard` (guards/api-key.guard.ts:18) | `Bearer sk_live_…` matching `users.apiKey` (no expiry; `user.status` not checked) | 401: no header, JWT, wrong prefix/scheme, unknown or replaced key | guards/api-key.guard.spec.ts |
| `PortalGuard` (portal/portal.guard.ts:31) | Always allows when `X-Portal-Session` is set; user from a valid JWT, else the cookie session; anything else is anonymous (free tier) | 400 without `X-Portal-Session`. Routes needing a user answer 400 "Authentication required", not 401 | portal/portal.guard.spec.ts |

| Resource | Routes | Guard | Ownership / role check | Spec |
|---|---|---|---|---|
| Agents | `/agents/:id…` | Combined | `where: { id, userId }` in agent/agent.service.ts:108, :133, :201; `verifyOwnership` :639 → 404. **Hole:** `parentAgentId` not checked on update/create unless `sub_agent` | agent/agent.ownership.spec.ts |
| Channels | `/channels/:id…` | Combined | `where: { id, userId }` in channel/channel.service.ts:60, :86, :117, :129; `resolveChannelAgent` :325 → 404. Public active agents of others may be added (by design) | channel/channel.ownership.spec.ts |
| Workspaces | `/workspaces/:id…` | Combined | `getById` workspace/workspace.service.ts:88 (active member, else 404); `requireMembership` :155 / `requireRole` :133 (403). Read: any active member. PATCH workspace, members, invites: owner, admin. Archive: owner | workspace/workspace.ownership.spec.ts |
| Workspace via channel | `/channels/:channelId/workspace…` | Combined | `resolveWorkspace` workspace/workspace-channel.controller.ts:41 (channel owner or active member, else 403) + `requireRole`; KB scoped by workspace-knowledge.service.ts:43 (404). KB create/delete: owner, admin; add chunks: owner, admin, member | workspace/workspace.ownership.spec.ts |
| Conversations | `/conversations/:id` | ApiKey | `where: { id, userId }` chat/conversation.service.ts:225, :289 → 404 | chat/conversation.ownership.spec.ts |
| Conversations (portal) | `/chat/portal/conversations/:id` | Portal | same service → 404 | portal/portal.ownership.spec.ts |
| Knowledge | `/v1/knowledge/bases/:id…` | ApiKey | `getKnowledgeBase` knowledge/knowledge.service.ts:47 (`kb.userId`) → 403. **Hole:** a workspace KB stays readable by its creator after removal from the workspace | knowledge/knowledge.ownership.spec.ts |
| Knowledge (portal) | `/chat/portal/knowledge/:id…` | Portal | same service → 403 | portal/portal.ownership.spec.ts |

## Notes

- The Prisma client is generated as CommonJS (`moduleFormat = "cjs"`, RX-64); `jest.config.js` maps its `@generated/prisma/*.js` alias and the `.js` suffixes of its relative imports.
- Spec files stay out of `tsconfig.app.json`; `tsconfig.spec.json` type-checks them with Jest types. Its errors in non-spec files are the app's own (see `tsc -p apps/api/tsconfig.app.json`).
