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

1. Module layout (`scripts/check-module-layout.ts`, RX-128): fails and names any source file that lies directly in a feature module folder of `apps/api/src/app/` (only the `*.module.ts` file may; layout in AGENTS.md).
2. Helper rule (`scripts/check-helper-rule.ts`, RX-130): fails and names any class method in a service, controller, guard or scheduler of `apps/api/src` that never uses `this`, unless `scripts/helper-rule-exceptions.ts` lists it with its reason; a list entry that matches no such method any more also fails (rule in AGENTS.md).
3. Prisma imports (`scripts/check-prisma-imports.ts`, RX-132): fails and names any source file of `apps/api/src` outside a repository (`<module>/repository/*.repository.ts`) and the Prisma module that imports PrismaService or the generated Prisma client (`import type` is allowed), unless `scripts/prisma-import-exceptions.ts` lists it. The list may only shrink: an entry that no longer has such an import fails, and so does an entry the list on `origin/main` does not have (rule in AGENTS.md).
4. `bun run prisma:generate` and `bunx prisma validate` (a dummy `DATABASE_URL` is used if none is set).
5. `nx run api:test --skip-nx-cache`, with a test database in one of two modes (it prints which):
   - `TEST_DATABASE_URL` set: used as given, nothing is started.
   - Not set: starts its own compose project (`renovix-check-<pid>-<random>`, free port on 127.0.0.1) from `docker-compose.test.yml` and always runs `down -v` on it afterwards, also on failure and Ctrl-C (the cleanup runs in its own process group, so a group-wide Ctrl-C cannot kill it). Without Docker this step fails.
6. Typecheck of `apps/api/tsconfig.app.json`, `apps/api/tsconfig.spec.json`, and the chat, dashboard and landing `tsconfig.json`. The same programs run in a temporary clean worktree of `origin/main` (after `git fetch origin main`, removed at the end); the baseline is the tip of `origin/main` at run time, so a branch behind main may need main merged or rebased to compare fairly. Errors are compared by file, TS code and message (not line numbers; a file git sees as renamed since `origin/main` is compared under its new path): those already in main are printed under "baseline (not failing)", any other fails the step and is printed under "NEW". Once main has no type errors, any error fails. (`apps/landing/tsconfig.spec.json` is not checked: it does not compile on its own.)
   While a tsc program has ordinary type errors, tsc stops reporting declaration-emit errors for it. When a type-error baseline reaches 0, re-run `bun run check` once to surface any hidden declaration-emit errors.

`docker build` is not part of it; run it separately when a Dockerfile or its inputs change.

**In CI** (RX-149): `.github/workflows/check.yml` runs `bun run check` on every pull request to main and every push to main, with Bun 1.3.11 and Node 22, after `bun install --frozen-lockfile`. On a pull request `origin/main` is fetched first. The check starts its own test database on the runner; no secret is used. The Docker image builds are not part of it (`ci.yml`, which builds them, stays switched off). Every push to main gets its own run. On a push to main the comparison base is the pushed commit itself (the workflow pins `origin/main` to it), so the typecheck baseline and the "added to the list" rule of the Prisma import check only guard pull requests; they cannot fail on a push.

## Safety rule

Tests only use `TEST_DATABASE_URL`, and only if the **database name ends in `_test`**. Anything else is refused before migrating or connecting. During tests `DATABASE_URL` is always overwritten: with `TEST_DATABASE_URL`, or with an address where nothing listens. `resetDatabase` checks `current_database()` again before it truncates.

## Database tests

```ts
import { createTestModule, createFastifyApp } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createPlan } from "../../../../test/factories";

let moduleRef: TestingModule;
let prisma: PrismaService;

beforeAll(async () => {
  ({ moduleRef, prisma } = await createTestModule({ providers: [CodesService] }));
});
beforeEach(() => resetDatabase(prisma));
afterAll(() => moduleRef?.close());
```

- `createTestModule(metadata, override?)` builds a Nest testing module with the real `PrismaService` (on the test database), every repository (the list `REPOSITORIES` in `apps/api/test/test-module.ts`; add a new repository there), the global `AccessGuard` registered as in `AppModule` (RX-114: a route without `@Access` answers 403) plus your `metadata`. `override` receives the builder for `overrideProvider` / `overrideGuard`.
- `createFastifyApp(moduleRef)` starts it as a Fastify app for `app.inject(...)`; close it with `app.close()`.
- `resetDatabase(prisma)` truncates every table except `_prisma_migrations`. This also removes the three plans the migrations seed; create the plans a test needs with `createPlan`. The same goes for the five built-in back-office roles (RX-96): `seedAdminRoles(prisma)` in `apps/api/test/admin-auth.ts` runs the migration's own INSERT again (`createAdmin` there calls it).
- Files run one at a time (`maxWorkers: 1`) because they share one database.
- The guards load better-auth, which is ESM-only; `apps/api/test/setup-env.ts` mocks it for every spec (no session) and sets `JWT_SECRET` and a fake 32-byte `MCP_ENCRYPTION_KEY` (both required, no fallback: RX-110; `NODE_ENV` is `test`, so test values need not be 32 characters). A spec that needs a session mocks it itself: `jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))` (the path is relative to the spec's folder; this one is for a spec in a module's layer folder). JWTs signed with `process.env.JWT_SECRET` still go through the real guard.

Examples: `codes/service/codes.service.db.spec.ts` (service), `guards/api-key.guard.spec.ts` (guard), `codes/controller/codes.controller.spec.ts` (controller via Fastify `inject`).

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

Current behaviour, characterized in RX-15 (paths under `apps/api/src/app/`). Since RX-114 a route declares `@Access` and the one global `AccessGuard` (`apps/api/src/common/guards/access.guard.ts`) runs these guards as the checks behind its methods: `jwt` and `session` (`CombinedAuthGuard`), `apiKey` (`ApiKeyGuard`), `portal` (`PortalGuard`); a valid credential of a method the route does not list is 403 (`common/guards/access.guard.spec.ts`). A `test.failing` marked `HOLE (RX-15)` asserts the secure behaviour: it passes while the hole exists and fails once it is fixed; then turn it into a normal test.

| Guard | Accepts | Rejects | Spec |
|---|---|---|---|
| `CombinedAuthGuard` (guards/combined-auth.guard.ts:26) | `Bearer` JWT signed with `JWT_SECRET` (`exp` checked, no DB lookup, payload shape not checked); else a Better Auth session from the cookie (expiry is `getSession`'s job) | 401: no credential, expired, other secret, `alg: none`, API key, `bearer`/`Basic`, no session | guards/combined-auth.guard.spec.ts |
| `ApiKeyGuard` (guards/api-key.guard.ts:18) | `Bearer sk_live_…` matching `users.apiKey` (no expiry; `user.status` not checked) | 401: no header, JWT, wrong prefix/scheme, unknown or replaced key | guards/api-key.guard.spec.ts |
| `PortalGuard` (portal/guard/portal.guard.ts:31) | Always allows when `X-Portal-Session` is set; user from a valid JWT, else the cookie session; anything else is anonymous (free tier) | 401 without `X-Portal-Session` (RX-114; was 400). Routes needing a user answer 400 "Authentication required", not 401 | portal/guard/portal.guard.spec.ts |

| Resource | Routes | Guard | Ownership / role check | Spec |
|---|---|---|---|---|
| Agents | `/agents/:id…` | Combined | `where: { id, userId }` in agent/service/agent.service.ts:108, :133, :201; `verifyOwnership` :639 → 404. **Hole:** `parentAgentId` not checked on update/create unless `sub_agent` | agent/controller/agent.ownership.spec.ts |
| Channels | `/channels/:id…` | Combined | `where: { id, userId }` in channel/service/channel.service.ts:60, :86, :117, :129; `resolveChannelAgent` :325 → 404. Public active agents of others may be added (by design) | channel/controller/channel.ownership.spec.ts |
| Workspaces | `/workspaces/:id…` | Combined | `getById` workspace/service/workspace.service.ts:88 (active member, else 404); `requireMembership` :155 / `requireRole` :133 (403). Read: any active member. PATCH workspace, members, invites: owner, admin. Archive: owner | workspace/controller/workspace.ownership.spec.ts |
| Workspace via channel | `/channels/:channelId/workspace…` | Combined | `resolveWorkspace` workspace/controller/workspace-channel.controller.ts:41 (channel owner or active member, else 403) + `requireRole`; KB scoped by workspace-knowledge.service.ts:43 (404). KB create/delete: owner, admin; add chunks: owner, admin, member | workspace/controller/workspace.ownership.spec.ts |
| Conversations | `/conversations/:id` | ApiKey | `where: { id, userId }` chat/service/conversation.service.ts:225, :289 → 404 | chat/controller/conversation.ownership.spec.ts |
| Conversations (portal) | `/chat/portal/conversations/:id` | Portal | same service → 404 | portal/controller/portal.ownership.spec.ts |
| Knowledge | `/v1/knowledge/bases/:id…` | ApiKey | `getKnowledgeBase` knowledge/service/knowledge.service.ts:47 (`kb.userId`) → 403. **Hole:** a workspace KB stays readable by its creator after removal from the workspace | knowledge/controller/knowledge.ownership.spec.ts |
| Knowledge (portal) | `/chat/portal/knowledge/:id…` | Portal | same service → 403 | portal/controller/portal.ownership.spec.ts |

## Notes

- The Prisma client is generated as CommonJS (`moduleFormat = "cjs"`, RX-64); `jest.config.js` maps its `@generated/prisma/*.js` alias and the `.js` suffixes of its relative imports.
- Spec files stay out of `tsconfig.app.json`; `tsconfig.spec.json` type-checks them with Jest types. Its errors in non-spec files are the app's own (see `tsc -p apps/api/tsconfig.app.json`).
