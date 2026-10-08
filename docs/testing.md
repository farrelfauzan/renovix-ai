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
   - Not set: starts its own compose project (`renovix-check-<pid>-<random>`, free port on 127.0.0.1) from `docker-compose.test.yml` and always runs `down -v` on it afterwards, also on failure and Ctrl-C. Without Docker this step fails.
3. Typecheck of `apps/api/tsconfig.app.json`, `apps/api/tsconfig.spec.json`, and the chat, dashboard and landing `tsconfig.json`. The same programs run in a temporary clean worktree of `origin/main` (after `git fetch origin main`, removed at the end). Errors are compared by file, TS code and message (not line numbers): those already in main are printed under "baseline (not failing)", any other fails the step and is printed under "NEW". Once main has no type errors, any error fails. (`apps/landing/tsconfig.spec.json` is not checked: it does not compile on its own.)

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

## Notes

- The Prisma client is generated as CommonJS (`moduleFormat = "cjs"`, RX-64); `jest.config.js` maps its `@generated/prisma/*.js` alias and the `.js` suffixes of its relative imports.
- Spec files stay out of `tsconfig.app.json`; `tsconfig.spec.json` type-checks them with Jest types. Its errors in non-spec files are the app's own (see `tsc -p apps/api/tsconfig.app.json`).
