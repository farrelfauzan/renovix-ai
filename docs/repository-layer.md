# Repository layer: rules and decisions

Decision record of RX-132 (2026-10-14). It states what the Tech Lead decided, shows each rule on the pilot module (`apps/api/src/app/codes/`), and records what was measured about the soft delete filter. The short rule for new code is in `AGENTS.md`, section "Repositories".

Decided by the Tech Lead: the rules on 2026-10-10 (plan decisions 16, 17, 18 and 26), the transaction helper and the import rule on 2026-10-14 (Decision log D92, D93, D94).

## State after RX-132

- One module, `codes`, reaches the database only through its repository.
- 40 other files still import `PrismaService` or the generated client. They are listed in `scripts/prisma-import-exceptions.ts`; the list may only shrink. Each is moved by its module's ticket (RX-133 to RX-141, and the tickets that rewrite a module: RX-18, RX-22, RX-23 to RX-26); RX-142 deletes the list.
- The dynamic query builder comes last, inside the repositories (RX-143). Until then a repository calls `PrismaService` directly.

## Where repositories live

`apps/api/src/app/<module>/repository/<name>.repository.ts`: an injectable class that takes `PrismaService` in its constructor, listed in its module's `providers`. Pilot: `codes/repository/codes.repository.ts`, class `CodesRepository`, provided by `CodesModule`.

A repository belongs to the module whose service calls it. The pilot keeps every query of the codes module in one repository, including the balance and subscription writes of a redemption; when the credit service (RX-22) owns the balance, those two writes move to its repository and the redemption passes its transaction on.

In tests, `createTestModule` (`apps/api/test/test-module.ts`) provides every repository, so a test lists the service it tests and nothing else. A new repository is added to the list in that file.

## The rules (decision 17)

Each rule is given as approved, then one example from the pilot.

**(a) Only repositories, the Prisma module, the seed and tests import `PrismaService` or the generated Prisma client. Controllers, guards and schedulers import services only, never repositories.**
Pilot: `codes.repository.ts` is the only file of the codes module that imports `PrismaService`. `codes.service.ts` imports `CodesRepository`, and from the Prisma module only `TransactionService`. `codes.controller.ts` imports `CodesService` only. Held by the step "prisma imports" of `bun run check` (below).

**(b) A repository holds queries only. The scope (user id, workspace id) is a required argument, never optional. Methods are named for the operation, not a generic `findMany(where)`, so services never build query conditions. Who may do what stays in services.**
Pilot: `findRedemption(codeId, userId, tx?)` and `findRedemptionsByUser(userId, tx?)` take the user as a required argument; the service calls `this.codes.findRedemption(code.id, userId)` and writes no `where`. The checks (code not found, deactivated, expired, used up, already redeemed) stay in `CodesService.redeemCode`. The admin methods (`listCodes(skip, take)`, `countCodes()`, `findCodeById(id)`, `updateCode(id, data)`) have no user argument because an invitation code belongs to no user; the admin check stays on the route.

**(c) Repositories return Prisma's generated types, with no mapping layer.**
Pilot: `findCodeWithPlan(code)` returns what `invitationCode.findUnique({ where: { code }, include: { plan: true } })` returns. The repository's return types are inferred, not declared, so they are exactly Prisma's; the service reads `code.plan?.slug` and `code.creditAmount` (a Prisma `Decimal`) from that type.

**(d) One helper lets a service run several repositories in one transaction. The transaction is passed as an explicit argument, the helper joins a transaction that is already open, and a transaction is never held open across a model call or a stream.**
Pilot, `CodesService.redeemCode` (shortened):

```ts
const result = await this.transactions.run(async (tx) => {
  await this.codes.incrementUserBalance(userId, code.creditAmount, tx);
  await this.codes.createTopupTransaction(userId, code.creditAmount, `code:${code.code}`, tx);
  // ... the subscription, when the code grants one
  await this.codes.incrementTimesRedeemed(code.id, tx);
  await this.codes.createRedemption(code.id, userId, { creditsGranted, planGranted, daysGranted }, tx);
  return { creditsGranted, planGranted, daysGranted };
});
```

The six writes of a redemption take `tx` as a required argument and have no fallback to the normal client. The two reads before the transaction run without one.

**(e) Raw SQL lives only in repositories.**
Pilot: the codes module has no raw SQL, so the pilot has no example. The first one comes with the knowledge slice (RX-137); a repository method that runs raw SQL takes the transaction the same way (`(tx ?? this.prisma).$queryRaw`).

## Transactions (D92)

In `apps/api/src/app/prisma/`:

- `DbTransaction`: the type of an open transaction (Prisma's transaction client). Services name it only to pass it on.
- `TransactionService.run(work, options?, tx?)`: runs `work(tx)` in one transaction. `PrismaModule` is global and exports it.

The seven points as decided:

1. A repository method takes the transaction as its optional last argument and runs on the normal client without it. A method that changes a balance or writes a ledger or redemption row takes it as a required argument, so the compiler refuses a call outside a transaction.
2. Join: when the caller passes `tx`, `run` uses that transaction and opens nothing. An error that reaches the outer `run` rolls back the whole outer transaction. An error of a joined `run` that the outer work catches undoes nothing: the inner writes stay and are committed, so never catch one and go on. No nested transaction, no savepoint.
3. No transaction across a model call or a stream. The helper has no begin and commit handle, so it cannot be kept open that way. For the credit service (RX-22) this means reserve, each ledger line and settle are separate short transactions, and a killed request is undone by a `release` call, not by a rollback.
4. `options` may hold `isolationLevel`, `timeout` and `maxWait`. They are passed to Prisma only when `run` opens the transaction. Given together with `tx` they cannot be honoured, so `run` throws.
5. No retry. A ticket that chooses a stricter isolation level adds it, in the helper.
6. Callback form only. The one array-form use (`workspace/service/workspace-invite.service.ts`) stays until its slice (RX-135). Prisma 8 removes the array form, so the helper is the one place to adapt.
7. Services import `TransactionService` and `DbTransaction` from the Prisma module and nothing else from it.

## The import check (D94)

Step "prisma imports" of `bun run check` (`scripts/check-prisma-imports.ts`).

- Forbidden outside `apps/api/src/app/prisma/` and `<module>/repository/*.repository.ts`: a value import of `PrismaService` or of the generated Prisma client.
- Allowed everywhere: `import type` from the generated client, because a service has to name the row types a repository returns (rule c) and a type cannot reach the database. `Decimal` from `@prisma/client/runtime/client` is not the generated client and stays allowed.
- The list `scripts/prisma-import-exceptions.ts` may only shrink. The check fails on a file that has such an import and is not listed, on a listed file that no longer has one, and on a list entry that the list on `origin/main` does not have (a renamed file keeps its entry).
- Not read: spec files, `apps/api/test/`, the seed, `require()`, `import x = require()` and dynamic `import()` (none exist in `apps/api/src`), and `@prisma/client` itself. Not seen at all: a service that runs a query on the `tx` it gets from `run`; it needs no import, so only review catches it.
- A path with a file suffix (`prisma.service.js`, `.ts`) counts like the bare path.

## PrismaService and the default filter (decision 26, D93)

Decision 26: the soft delete filter lives in `prisma.service.ts`. RX-132 puts the mechanism in place with no model on it; RX-124 adds the models. Until then no query changes.

### How PrismaService is provided

- `PrismaService` (`apps/api/src/app/prisma/prisma.service.ts`) is an abstract class: the injection token and the type, never constructed. `PrismaModule` provides the client that `PrismaService.create()` builds: a `PrismaClient` with the query extension that adds the default condition, and with the connect and disconnect hooks added as a client extension.
- Nothing that injects it changed: the 40 files that still import it, the 10 `$transaction` uses in 8 files, the test factories and `resetDatabase`.
- The map of models is empty (`VISIBLE_ONLY`). `create()` takes the map as a parameter only so the database test can put a model on it.
- Why this form (measured): a class that extends `PrismaClient` and calls `$extends` inside itself is injected without the extension; a factory alone gives the extension but Nest then calls no lifecycle hook and connections stay open; a constructor that returns the extended client works but rests on Prisma internals.
- A direct form would get a client without the filter, so it does not compile: `new PrismaService()` (TS2511), `providers: [PrismaService]` and `useClass: PrismaService` (TS2322).

Costs, all known when the form was chosen or found while building it:

- The declared type stays the plain client's. The true type of an extended client is not assignable to `PrismaClient`, and using it would change the type of every `tx` parameter, of the test factories and of `resetDatabase`.
- `$on` is in the type but does not exist at run time on an extended client. Nothing uses it.
- A transaction of an extended client cannot be enumerated or printed: `Object.keys(tx)`, `util.inspect(tx)`, `"$on" in tx` and `JSON.stringify` of an object that holds a `tx` throw a `TypeError` ("'ownKeys' on proxy: trap result did not include '$on'"). The client itself is not affected, and queries on `tx` work. This comes with any `$extends`, also an empty one (Prisma 7.8.0), so it is a cost of decision 26 in every form. No code in `apps/api` does this today. In practice: do not log a `tx`, and a failing Jest matcher that has to print a `tx` shows this error in place of its diff.
- Three clients are built without the filter and stay so: the sign-in library's own client in `apps/api/src/lib/auth.ts`, and the two seed scripts (`prisma/seed.ts`, `prisma/seed-agents.ts`).

### What the filter reaches (measured)

Measured on 2026-10-13 with Prisma 7.8.0 and `@prisma/adapter-pg`, by a throwaway database test of 42 cases on `Reminder.deletedAt` and `Agent.status` (kept with the RX-132 pull request, not in the repository). The parts that matter for the product are kept as a permanent test in `apps/api/src/app/prisma/prisma.service.db.spec.ts`.

| Kind of call | Default applied? |
|---|---|
| `findMany`, `findFirst`, `findFirstOrThrow` | yes |
| `findUnique`, `findUniqueOrThrow` (null, or P2025, for a hidden row) | yes |
| `count`, `aggregate`, `groupBy` | yes |
| The same reads inside `$transaction`, callback form | yes |
| The same reads inside `$transaction`, array form | yes |
| Both transaction forms still roll back as one transaction | yes |
| A condition the caller writes on the same column (to read deleted rows on purpose) | the caller's wins. A key left `undefined` does not count as a condition (the default stays); `{}` reads every row |
| The caller's condition on that column inside `OR` | not seen: the default is still added |
| Rows loaded through `include` or `select` of a relation, in either direction | **no** |
| The fluent form (`agent.findUnique(...).reminders()`) | **no** |
| `_count` of a relation | **no** |
| Relation filters (`some`, `every`, `none`, `is`) | **no** |
| Child rows of a hidden parent, read from the child's model | **no** |
| Raw SQL (`$queryRaw`, `$executeRaw`) | **no** |
| Every write: `update`, `updateMany`, `upsert`, `delete`, `deleteMany` act on a hidden row | **no** |
| The second Prisma client in `apps/api/src/lib/auth.ts` (the sign-in library's own) | **no** |

Cost of the filter: none measured. One `findMany` is one SQL statement with and without it, with one more condition.

So the sentence behind decision 26, "it hides deleted rows even when a repository method forgets the condition", holds for a plain top-level read. For every kind marked **no** the repository method writes the condition by hand, and its ticket tests it. The hand-written forms were tried and work: `include: { reminders: { where: { deletedAt: null } } }`, `_count: { select: { reminders: { where: { deletedAt: null } } } }`, `some: { deletedAt: null }`, and the same condition in the `where` of a write.

### Where a hand-written condition is needed (D93)

The four models that get soft delete are Agent, KnowledgeBase, Conversation and Channel (plan decision 20). Counted on main at 4b375dd in `apps/api/src`, spec files and the generated client left out. The counts come from text searches, so they are upper bounds to size the work with, not a list of defects; each slice checks its own calls.

| Kind | Count today | How counted |
|---|---|---|
| Top-level reads on the four models (covered by the default) | 50 | `.agent.`, `.knowledgeBase.`, `.conversation.`, `.channel.` followed by a read operation |
| Lines that name a relation to one of the four models in an `include`, `select` or `_count` | 43, in 6 files | the keys `agent`, `agents`, `subAgents`, `parentAgent`, `channel`, `channels`, `knowledgeBase`, `knowledgeBases`, `conversation`, `conversations` followed by `true` or `{` |
| `_count` selections, all models | 18, in 8 files | the key `_count:` |
| Relation filters (`some`, `every`, `none`, `is`, `isNot`) | 2, both on workspace members | those keys followed by `{` |
| Raw SQL calls | 18, in 6 files | `$queryRaw`, `$executeRaw` and their `Unsafe` forms |
| Writes on the four models (`update`, `updateMany`, `delete`, `deleteMany`, `upsert`) | 11, in 5 files | the four model names followed by a write operation |
| Second client | 1 | `apps/api/src/lib/auth.ts` |

Limits of these counts: the 43 lines include join-table relations (an agent's `knowledgeBases` are `AgentKnowledgeBase` rows) and two `_count` lines that the next row counts again; a relation filter written without `some` or `is` (`where: { agent: { userId } }`) is not told apart from an include by the search; `knowledge_bases` and `conversations` named inside raw SQL text are counted as raw SQL calls, not per table.

Child rows of a hidden parent are not counted as calls, because any read of a child model can be one. The child models are: `Message` (of Conversation); `KnowledgeChunk`, `AgentKnowledgeBase` (of KnowledgeBase); `AgentIntegration`, `AgentTool`, `AgentKnowledgeBase`, `AgentChannel`, `AgentRun`, `ChannelAgent`, `Reminder`, `GuardrailViolation`, `GuardrailConfig`, and sub-agents through `parentAgent` (of Agent); `ChannelAgent`, `ChannelChatRoom`, `Reminder`, `Workspace` (of Channel).

One form has no place for the condition: the `include` of a required to-one relation (a reminder's `agent`, a channel-agent link's `agent`) accepts `select`, `omit` and `include` but no `where`; an optional to-one relation (`parentAgent`) and every to-many relation accept `where`. Read from the generated types of Prisma 7.8.0, not run. For a required to-one relation the condition goes into the top-level `where` as a relation filter (`where: { agent: { deletedAt: null } }`, which leaves the whole row out), or the service checks the loaded row.

RX-124 and RX-145 write and test these conditions per repository; a count per model is on those two tickets.

## Not decided here

- The soft delete filter's models and marker columns (RX-124, RX-145), restore (RX-126) and purge (RX-127).
- The query builder and the unified client of the Tech Lead's `index.ts` draft (RX-143).
- Retry and isolation level for the credit service (RX-22 decides; the helper already passes the options through).
