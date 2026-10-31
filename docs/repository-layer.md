# Repository layer: rules and decisions

Decision record of RX-132 (2026-10-14). It states what the Tech Lead decided, shows each rule on the pilot module (`apps/api/src/app/codes/`), and records what was measured about the soft delete filter. The short rule for new code is in `AGENTS.md`, section "Repositories".

Decided by the Tech Lead: the rules on 2026-10-10 (plan decisions 16, 17, 18 and 26), the transaction helper and the import rule on 2026-10-14 (Decision log D92, D93, D94). RX-148 (2026-10-16) split the pilot's one repository into one per table and states four rules on top (Decision log D100, D101, D103).

## State after RX-132

Later change: RNX-251 dropped the legacy plan and subscription tables and their two repositories named below; the tables and examples here record the state when each rule was decided.

- One module, `codes`, reaches the database only through its repository.
- 40 other files still import `PrismaService` or the generated client. They are listed in `scripts/prisma-import-exceptions.ts`; the list may only shrink. Each is moved by its module's ticket (RX-133 to RX-141, and the tickets that rewrite a module: RX-18, RX-22, RX-23 to RX-26); RX-142 deletes the list.
- The dynamic query builder comes last, inside the repositories (RX-143). Until then a repository calls `PrismaService` directly.

## Where repositories live (RX-148: D100, D101, D103)

Four rules, each with its example in the code.

**(1) One repository per table, not per module (D100).**
`apps/api/src/app/<module>/repository/<table>.repository.ts`: an injectable class named for its table. It takes `PrismaService` in its constructor for the methods that run without a transaction; `TransactionRepository` has only methods that need `tx`, so its constructor takes nothing. The codes module reaches six tables through six repositories:

| Table | Repository | File | Owner module | Public methods |
|---|---|---|---|---|
| `invitation_codes` | `InvitationCodeRepository` | `codes/repository/invitation-code.repository.ts` | codes | 7: `findCodeWithPlan`, `findCodeById`, `listCodes`, `countCodes`, `createCode`, `updateCode`, `claimRedemption` |
| `code_redemptions` | `CodeRedemptionRepository` | `codes/repository/code-redemption.repository.ts` | codes | 3: `findRedemption`, `findRedemptionsByUser`, `createRedemption` |
| `user_subscriptions` | `UserSubscriptionRepository` | `billing/repository/user-subscription.repository.ts` | billing | 3: `findSubscriptionByUserId`, `createSubscription`, `updateSubscription` |
| `subscription_plans` | `SubscriptionPlanRepository` | `billing/repository/subscription-plan.repository.ts` | billing | 1: `findPlanById` |
| `transactions` | `TransactionRepository` | `billing/repository/transaction.repository.ts` | billing | 1: `createTopupTransaction` |
| `users` | `UserRepository` | `auth/repository/user.repository.ts` | auth | 8 (RX-138): `findUserByEmail`, `createUser`, `updateLastLogin`, `findProfileOrThrow`, `updateApiKey`, `updateProfile`, `findPortalUser`, `incrementUserBalance`; codes uses `incrementUserBalance` |

A method that also reads a second table (an `include`) belongs to the table it is called on: `findCodeWithPlan`, `listCodes` and `createCode` (with the plan) are in `InvitationCodeRepository`, `findRedemptionsByUser` (with the code text and type) is in `CodeRedemptionRepository`. A service injects every repository it uses: `CodesService` takes the six above and `TransactionService`.

**(2) Prisma stays inside the repositories (D101, D103).**
No value import of the generated Prisma client outside the repositories and the Prisma module (`import type` is allowed, rule (a) and the import check below). Services write enum values as strings: `CodesService` checks `code.type === "topup"` and passes `status: "active"`, and `TransactionRepository.createTopupTransaction` writes `type: "topup", status: "success"`. A repository turns a Prisma error into one of the app's error classes, which are Nest's HTTP exceptions (D103). Example: `AdminUserRepository.updateRole` (`admin-auth/repository/admin-user.repository.ts`): a `PrismaClientKnownRequestError` with code `P2003` (no role with that name) becomes `BadRequestException("Unknown role")`. Of the six repositories above only `UserSubscriptionRepository` maps one (RX-181): `createSubscription` turns `P2002` (the user has a subscription already) into a `ConflictException`.

**(3) A table used by several modules: its repository sits in the module that owns the table; one global module provides them all (D103).**
Owners: `invitation_codes` and `code_redemptions` belong to codes; `user_subscriptions`, `subscription_plans` and `transactions` to billing; `users` to auth; `portal_sessions` (`PortalSessionRepository`, 8 methods) and `anonymous_usage_counters` (`AnonymousUsageCounterRepository`, 2) to portal (RX-138); `agents`, `agent_tools`, `agent_integrations`, `agent_knowledge_bases`, `agent_channels` and `agent_links` (RNX-118, `AgentLinkRepository`) to agent; `channels`, `channel_agents`, `channel_messages` and `channel_chat_rooms` to channel; `conversations`, `messages`, `prompt_templates` and `system_prompts` to chat (RX-136); `reminders` to reminder; `knowledge_bases` to knowledge (RX-133); `user_memories` to memory; `workspaces` and `workspace_memories` to workspace (RX-141). `RepositoriesModule` (`apps/api/src/app/prisma/repositories.module.ts`) is `@Global()` and lists every repository of the API in its `providers` and `exports`; `AppModule` imports it once. No feature module lists a repository in its `providers`, and a feature module never imports another module to get a repository: `CodesModule` imports nothing to use the billing and auth repositories, and `AdminAuthModule` no longer imports `AdminAuditModule`, which it did only for `AdminAuditLogRepository`. A new repository is added to the list in `repositories.module.ts`.

In tests, `createTestModule` (`apps/api/test/test-module.ts`) imports `RepositoriesModule` as `AppModule` does, so a test lists the service it tests and nothing else.

**(4) "Fewer than 10 public methods" is a number the pull request reports, not a hard limit (D103).**
The pull request that adds or grows a repository gives each one's count, and a reason for any count above 10. RX-148: the largest, `InvitationCodeRepository`, has 7 (table above).

RX-133 moved `agent/service/agent.service.ts` and `agent/service/agent-tool.service.ts` the same way:

| Table | Repository | File | Owner module | Public methods |
|---|---|---|---|---|
| `agents` | `AgentRepository` | `agent/repository/agent.repository.ts` | agent | 13: `findAgentBySlug`, `findUserAgent`, `findUserAgentType`, `findAgentDetail`, `findAgentWithRelations`, `listTopLevelAgents`, `listPublicAgents`, `findPublicTemplate`, `countAgentsByUser`, `createAgent`, `updateAgent`, `updateAgentStatus`, `deleteAgent` (above 10: one method per distinct query of the service, so each stayed exactly as it was) |
| `agent_tools` | `AgentToolRepository` | `agent/repository/agent-tool.repository.ts` | agent | 4: `findAgentTool`, `createAgentTool`, `createAgentTools`, `deleteAgentTool` |
| `agent_integrations` | `AgentIntegrationRepository` | `agent/repository/agent-integration.repository.ts` | agent | 4: `findAgentIntegration`, `countAgentIntegrations`, `createAgentIntegration`, `deleteAgentIntegration` |
| `agent_knowledge_bases` | `AgentKnowledgeBaseRepository` | `agent/repository/agent-knowledge-base.repository.ts` | agent | 3: `findAgentKnowledgeBase`, `createAgentKnowledgeBase`, `deleteAgentKnowledgeBase` |
| `agent_channels` | `AgentChannelRepository` | `agent/repository/agent-channel.repository.ts` | agent | 4: `findAgentChannel`, `createAgentChannel`, `updateAgentChannelConfig`, `deleteAgentChannel` |
| `user_subscriptions` | `UserSubscriptionRepository` | `billing/repository/user-subscription.repository.ts` | billing | 6: adds `findSubscriptionWithPlan`, `createSubscriptionWithPlan`, `updateSubscriptionWithPlan`; reuses `findSubscriptionByUserId` |
| `subscription_plans` | `SubscriptionPlanRepository` | `billing/repository/subscription-plan.repository.ts` | billing | 2: adds `findPlanBySlug` |
| `channel_chat_rooms` | `ChannelChatRoomRepository` | `channel/repository/channel-chat-room.repository.ts` | channel | 2: `findChatRoomByName`, `createChatRoom` |
| `reminders` | `ReminderRepository` | `reminder/repository/reminder.repository.ts` | reminder | 1: `createReminder` |
| `knowledge_bases` | `KnowledgeBaseRepository` | `knowledge/repository/knowledge-base.repository.ts` | knowledge | 9: adds `findKnowledgeBaseById` to RX-137's 8 |

The writes by id of the agent tables (`updateAgent`, `deleteAgent`, `deleteAgentTool`, ...) take no user: the service checks the owner first (`findUserAgent`), as before; changing that is RX-117. Neither service used a transaction, and none of these repositories maps a Prisma error.

RX-134 moved the agent lookups of `agent/service/agent-run.service.ts` (the agent of a run with its sub-agents and knowledge bases, the sub-agent of a delegation, the agent of the run history routes), so the soft delete filter (RX-124) has one place to apply to them. Each query stayed exactly as it was:

| Table | Repository | File | Owner module | Public methods |
|---|---|---|---|---|
| `agents` | `AgentRepository` | `agent/repository/agent.repository.ts` | agent | 15: adds `findRunnableAgent` (`chat`, `chatStream`) and `findDelegateSubAgent` (delegation to a sub-agent); reuses `findUserAgent` (`listRuns`, `getRun`, `deleteRun`) (above 10: as in RX-133, one method per distinct query) |

The knowledge bases and sub-agents come with the agent (`include`), so no other repository changed. The service handled no Prisma error around these lookups, so none is mapped. `agent-run.service.ts` stays on the import check's list: its 21 run, message and metering calls (`agentRun`, `agentMessage`, the quota check's `$transaction` and `userSubscription.update`) move with the chat engine tickets RX-23 and RX-25.

RX-136 moved the channel module (`channel/service/channel.service.ts`, `channel/service/gowa.service.ts`) and the chat module (`chat/service/conversation.service.ts`, `chat/service/prompt-template.service.ts`, `chat/service/prompt-tuning.service.ts`). Each query stayed exactly as it was:

| Table | Repository | File | Owner module | Public methods |
|---|---|---|---|---|
| `channels` | `ChannelRepository` | `channel/repository/channel.repository.ts` | channel | 8: `createChannel`, `listUserChannels`, `findUserChannel`, `findUserChannelWithAgents`, `findUserChannelWorkspace`, `findUserChannelWithWorkspace`, `updateChannel`, `deleteChannel` |
| `channel_agents` | `ChannelAgentRepository` | `channel/repository/channel-agent.repository.ts` | channel | 5: `createChannelAgent`, `findChannelAgent`, `findChannelAgentWithAgent`, `findChannelAgentIds`, `deleteChannelAgent` |
| `channel_messages` | `ChannelMessageRepository` | `channel/repository/channel-message.repository.ts` | channel | 5: `listRoomAgentMessages`, `createChannelMessage`, `updateAssistantMessage`, `deleteRoomAgentMessages`, `deleteChannelAgentMessages` |
| `channel_chat_rooms` | `ChannelChatRoomRepository` | `channel/repository/channel-chat-room.repository.ts` | channel | 2: reuses `findChatRoomByName` and `createChatRoom` (the general room) |
| `agents` | `AgentRepository` | `agent/repository/agent.repository.ts` | agent | 16: adds `findUsableAgent` (the agent a channel owner may add: their own, or a public active one) (above 10: as in RX-133, one method per distinct query) |
| `agent_channels` | `AgentChannelRepository` | `agent/repository/agent-channel.repository.ts` | agent | 5: adds `findActiveWhatsappChannels` (the GOWA webhook's channel lookup, RX-115) |
| `conversations` | `ConversationRepository` | `chat/repository/conversation.repository.ts` | chat | 7: `findUserConversation`, `findUserConversationWithMessages`, `listUserConversations`, `countUserConversations`, `createConversation`, `updateConversationTitle`, `deleteConversation` |
| `messages` | `MessageRepository` | `chat/repository/message.repository.ts` | chat | 1: `createMessages` |
| `prompt_templates` | `PromptTemplateRepository` | `chat/repository/prompt-template.repository.ts` | chat | 1: `listActivePromptTemplates` |
| `system_prompts` | `SystemPromptRepository` | `chat/repository/system-prompt.repository.ts` | chat | 1: `listActiveSystemPrompts` |

The writes by id (`updateChannel`, `deleteChannel`, `deleteChannelAgent`, `updateConversationTitle`, `deleteConversation`) take no user: the service checks the owner first, as before. The link, message and room methods take no user either; the service checks the channel's owner (`findUserChannel`, `findUserChannelWithWorkspace`) before them. None of the five services caught a Prisma error by its code, so none is mapped; the title of a conversation still catches and logs any error of its update, as before. `channel/service/channel-chat.service.ts` stays on the import check's list: it is the channel chat run path that RX-24 rewrites onto the engine, and its 3 calls (the parent agent's active sub-agents, the room history of the run, the sub-agent of a delegation) move with it.

RX-141 moved the memory module (`memory/service/user-memory.service.ts`, `memory/service/memory-extraction.service.ts`, 17 calls) and `agent/service/agent-memory.service.ts` (17 calls). The module has no HTTP route (the chat prompt reads `getRelevantMemories`, the extraction and the agent code call the rest), so its tests call the services. Each query stayed exactly as it was:

| Table | Repository | File | Owner module | Public methods |
|---|---|---|---|---|
| `user_memories` | `UserMemoryRepository` | `memory/repository/user-memory.repository.ts` | memory | 11: `listActiveMemories`, `listVisibleMemories`, `findVisibleMemory`, `createMemory`, `updateMemory`, `markAllMemoriesDeleted`, `findRelevantMemories`, `confirmMemory`, `listActiveMemoriesOfType`, `listTopActiveMemories`, `findActiveMemoryContaining` (above 10: one method per distinct query of the two services, as in RX-133; the create and the update by id are shared by both) |
| `workspace_memories` | `WorkspaceMemoryRepository` | `workspace/repository/workspace-memory.repository.ts` | workspace | 4: `listActiveWorkspaceMemories`, `findActiveWorkspaceMemoryContaining`, `updateWorkspaceMemory`, `createWorkspaceMemory` |
| `workspaces` | `WorkspaceRepository` | `workspace/repository/workspace.repository.ts` | workspace | 1: `findWorkspaceIdByChannel` (RX-135 adds the workspace module's own queries) |
| `agents` | `AgentRepository` | `agent/repository/agent.repository.ts` | agent | 17: adds `findAgentWorkspaceId` (above 10: as in RX-133) |
| `users` | `UserRepository` | `auth/repository/user.repository.ts` | auth | 9: adds `findUserWithFirstTopup` (the extraction's eligibility check) |
| `conversations` | `ConversationRepository` | `chat/repository/conversation.repository.ts` | chat | 8: adds `listRecentConversationsWithUserMessageCount` (the extraction's 5-conversation window) |
| `messages` | `MessageRepository` | `chat/repository/message.repository.ts` | chat | 2: adds `listConversationMessages` |

The soft delete marker of memory (`status: "deleted"`, RX-125) stays a string condition written in the repository: `listVisibleMemories`, `findVisibleMemory` and `markAllMemoriesDeleted` use `status: { not: "deleted" }`, the others `status: "active"`. The writes by id (`updateMemory`, `updateWorkspaceMemory`) take no user or workspace: the service finds the row first (`findVisibleMemory`, `findActiveMemoryContaining`), as before; `confirmMemory` keeps the user in its condition. `findRelevantMemories` takes the current time itself. The services caught no Prisma error by its code (the extraction catches and logs any error, as before), so no repository maps one.

When the credit service (RX-22) owns the balance, the balance write of a redemption moves to it and the redemption passes its transaction on.

## The rules (decision 17)

Each rule is given as approved, then one example from the pilot.

**(a) Only repositories, the Prisma module, the seed and tests import `PrismaService` or the generated Prisma client. Controllers, guards and schedulers import services only, never repositories.**
Pilot: in the codes module only its two repositories (`invitation-code.repository.ts`, `code-redemption.repository.ts`) and the spec files import `PrismaService`. `codes.service.ts` imports the six repositories it uses, and from the Prisma module only `TransactionService`. `codes.controller.ts` imports `CodesService` only. Held by the step "prisma imports" of `bun run check` (below).

**(b) A repository holds queries only. The scope (user id, workspace id) is a required argument, never optional. Methods are named for the operation, not a generic `findMany(where)`, so services never build query conditions. Who may do what stays in services.**
Pilot: `findRedemption(codeId, userId, tx?)` and `findRedemptionsByUser(userId, tx?)` take the user as a required argument; the service calls `this.redemptions.findRedemption(code.id, userId)` and writes no `where`. The checks (code not found, deactivated, expired, used up, already redeemed) stay in `CodesService.redeemCode`. The admin methods (`listCodes(skip, take)`, `countCodes()`, `findCodeById(id)`, `updateCode(id, data)`) have no user argument because an invitation code belongs to no user; the admin check stays on the route.

**(c) Repositories return Prisma's generated types, with no mapping layer.**
Pilot: `InvitationCodeRepository.findCodeWithPlan(code)` returns what `invitationCode.findUnique({ where: { code }, include: { plan: true } })` returns. The repository's return types are inferred, not declared, so they are exactly Prisma's; the service reads `code.plan?.slug` and `code.creditAmount` (a Prisma `Decimal`) from that type.

**(d) One helper lets a service run several repositories in one transaction. The transaction is passed as an explicit argument, the helper joins a transaction that is already open, and a transaction is never held open across a model call or a stream.**
Pilot, `CodesService.redeemCode` (shortened):

```ts
const result = await this.transactions.run(async (tx) => {
  const now = new Date();
  if (!(await this.codes.claimRedemption(code.id, now, tx))) {
    // ... read the code again and throw the 400 for its state (deactivated, expired, used up)
  }
  if (await this.redemptions.findRedemption(code.id, userId, tx)) {
    throw new ConflictException(ALREADY_REDEEMED);
  }
  // ... when the code grants credits:
  await this.users.incrementUserBalance(userId, code.creditAmount, tx);
  await this.ledger.createTopupTransaction(
    userId,
    code.creditAmount,
    `code:${code.code}:${userId}`,
    tx,
  );
  // ... when the code grants a plan: this.subscriptions.findSubscriptionByUserId(userId, tx),
  // then this.subscriptions.updateSubscription(userId, existing.currentPeriodEnd, { ... }, tx) or createSubscription(userId, { ... }, tx)
  await this.redemptions.createRedemption(
    code.id,
    userId,
    { creditsGranted, planGranted, daysGranted },
    tx,
  );
  return { creditsGranted, planGranted, daysGranted };
});
```

The six writes of a redemption (`claimRedemption`, `incrementUserBalance`, `createTopupTransaction`, `createSubscription`, `updateSubscription`, `createRedemption`) take `tx` as a required argument and have no fallback to the normal client. The two reads before the transaction (`findCodeWithPlan`, `findRedemption`) run without one.

**(e) Raw SQL lives only in repositories.**
Pilot: the codes module has no raw SQL, so the pilot has no example. A repository method that runs raw SQL takes the transaction the same way (`(tx ?? this.prisma).$queryRaw`). Example (RX-137): `KnowledgeChunkRepository` (`knowledge/repository/knowledge-chunk.repository.ts`) holds the vector search and chunk storage SQL of `knowledge_chunks`, as tagged templates, every value a query parameter; `searchPersonalChunks(userId, embedding, topK, tx?)` runs `(tx ?? this.prisma).$queryRaw`. One exception: `insertChunks(knowledgeBaseId, chunks)` keeps the array form of `$transaction` it had in the service (all rows or none), so it opens its own transaction and takes no `tx`.

## Transactions (D92)

In `apps/api/src/app/prisma/`:

- `DbTransaction`: the type of an open transaction (Prisma's transaction client). Services name it only to pass it on.
- `TransactionService.run(work, options?, tx?)`: runs `work(tx)` in one transaction. `PrismaModule` is global and exports it.

The seven points as decided:

1. A repository method takes the transaction as its optional last argument and runs on the normal client without it. A method that changes a balance or writes a ledger or redemption row takes it as a required argument (so do the free tier's counter writes `incrementFreeRequestCount` and `incrementCounterBelowCap`, which run only inside the reservation transaction, RX-138), so the compiler refuses a call outside a transaction.
2. Join: when the caller passes `tx`, `run` uses that transaction and opens nothing. An error that reaches the outer `run` rolls back the whole outer transaction. An error of a joined `run` that the outer work catches undoes nothing: the inner writes stay and are committed, so never catch one and go on. No nested transaction, no savepoint.
3. No transaction across a model call or a stream. The helper has no begin and commit handle, so it cannot be kept open that way. For the credit service (RX-22) this means reserve, each ledger line and settle are separate short transactions, and a killed request is undone by a `release` call, not by a rollback.
4. `options` may hold `isolationLevel`, `timeout` and `maxWait`. They are passed to Prisma only when `run` opens the transaction. Given together with `tx` they cannot be honoured, so `run` throws.
5. No retry. A ticket that chooses a stricter isolation level adds it, in the helper.
6. Callback form only. The array-form uses stay as they are until their slice: `workspace/service/workspace-invite.service.ts` and the chunk inserts of `workspace/service/workspace-knowledge.service.ts` (RX-135). `KnowledgeChunkRepository.insertChunks` (moved unchanged by RX-137, rule (e)) keeps the array form until Prisma 8 removes it, a recorded exception (D159). Prisma 8 removes the array form, so the helper is the one place to adapt.
7. Services import `TransactionService` and `DbTransaction` from the Prisma module and nothing else from it.

## The import check (D94)

Step "prisma imports" of `bun run check` (`scripts/check-prisma-imports.ts`).

- Forbidden outside `apps/api/src/app/prisma/` and `<module>/repository/*.repository.ts`: a value import of `PrismaService` or of the generated Prisma client.
- Allowed everywhere: `import type` from the generated client, because a service has to name the row types a repository returns (rule c) and a type cannot reach the database. `Decimal` from `@prisma/client/runtime/client` is not the generated client and stays allowed.
- The list `scripts/prisma-import-exceptions.ts` may only shrink. The check fails on a file that has such an import and is not listed, on a listed file that no longer has one, and on a list entry that the list on `origin/main` does not have (a renamed file keeps its entry). It also fails, and says which, when it cannot read that list: the base ref is not in the checkout, or it has no list (RX-133; before, it passed with "additions not checked"). The base is the first argument, else `PRISMA_IMPORTS_BASE`, else `origin/main`.
- Not read: spec files, `apps/api/test/`, the seed, `require()`, `import x = require()` and dynamic `import()` (none exist in `apps/api/src`), and `@prisma/client` itself. Not seen at all: a service that runs a query on the `tx` it gets from `run`; it needs no import, so only review catches it.
- A path with a file suffix (`prisma.service.js`, `.ts`) counts like the bare path.

## PrismaService and the default filter (decision 26, D93)

Decision 26: the soft delete filter lives in `prisma.service.ts`. RX-132 puts the mechanism in place with no model on it; RX-124 adds the models. Until then no query changes.

### How PrismaService is provided

- `PrismaService` (`apps/api/src/app/prisma/prisma.service.ts`) is an abstract class: the injection token and the type, never constructed. `PrismaModule` provides the client that `PrismaService.create()` builds: a `PrismaClient` with the query extension that adds the default condition, and with the connect and disconnect hooks added as a client extension.
- Nothing that injects it changed: the 40 files that still import it, the 10 `$transaction` uses in 8 files, the test factories and `resetDatabase`.
- The map of models holds `Provider` (`deletedAt: null`, RX-177); RX-124 adds the others (`VISIBLE_ONLY`). `create()` takes the map as a parameter only so the database test can put a model on it.
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
