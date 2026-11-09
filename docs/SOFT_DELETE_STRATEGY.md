# Soft Delete Strategy

## Overview

Adopt a consistent soft delete strategy in the service layer so records can be hidden from normal product flows without being physically removed immediately.

This is especially important for the upcoming workspace feature because workspaces, memberships, agents, memory, knowledge, and invites will all have relationships that should remain restorable and auditable for some time after deletion.

The goal is to make deletion safe, reversible, and predictable.

## What is built (RNX-124: agents)

The rest of this page is the original proposal. For `Agent` it is built as follows; restore is RX-126/RNX-126 and purge
RX-127. KnowledgeBase, Conversation and Channel are built by RNX-145 (next section).

- Schema: `agents.deleted_at` (timestamptz) and `agents.deleted_by_id` (the user who deleted it; a plain column, no
  foreign key to `users`). `status` keeps its `draft | active | archived` meaning; deletion is only `deletedAt`.
  `reminders.deleted_by_id` was added next to the existing `reminders.deleted_at`: `DELETE /reminders/:id` sets both
  (and pauses the reminder).
- Reminders of a deleted agent (`reminder.repository.ts`): the list, the read, the owner lookup of update and delete,
  and the scheduler's due reminders all carry `agent: LIVE_AGENT`, so such a reminder is not listed, its routes answer
  404 and it never fires. The reminder row is not changed, and it is back when the agent is.
- Delete: `DELETE /agents/:id` (owner only, 204 as before) sets `deletedAt` and `deletedById` in one transaction with
  erasing the agent's `agent_integrations` rows (decision 25: a deleted agent keeps no credentials). Every other child
  row stays: tools, knowledge base links, channels (`agent_channels`), runs and messages, agent links, channel links.
  Usage rows (`usage_logs`, `credit_ledger_entries.agent_id`, `channel_messages.agent_id`) are not touched.
- Reads: `Agent` is on `PrismaService`'s default filter (`VISIBLE_ONLY`), so every top-level read of `agents` hides
  a deleted agent; the routes then answer 404 as for an agent that does not exist, and the plan quota
  (`countAgentsByUser`) does not count it. Reads the filter does not reach carry the condition by hand, each with a
  test: a channel's agent links and their `_count` (`channel.repository.ts`), the channel-agent lookups
  (`channel-agent.repository.ts`), the WhatsApp webhook's channel lookup (`agent-channel.repository.ts`), agent links
  and callable agents (`agent-link.repository.ts`), the workspace's agent `_count` (`workspace.service.ts`) and the
  run history routes (`agent-run.service.ts`). Writes by id (`updateAgent`, `updateAgentStatus`, `softDeleteAgent`)
  name `deletedAt: null` themselves.
- A live row that points at a deleted agent through a required relation (a channel's `channel_agents` row, a
  WhatsApp `agent_channels` row) is left out whole, with no "deleted" mark, and comes back if the agent comes back.
- Uniqueness: the slug key is a partial unique index, `agents_userId_slug_key` on `(userId, slug) WHERE deleted_at IS
  NULL`, so a deleted agent's slug can be used again at once (no tombstone suffix). Prisma leaves a partial index out
  of the client's unique keys, so the slug lookups use `findFirst`.

## What is built (RNX-145: knowledge bases, conversations, channels)

- Schema: `knowledge_bases`, `conversations` and `channels` each get `deleted_at` (timestamptz) and `deleted_by_id`
  (the user who deleted it; a plain column, no foreign key to `users`). No data change and no new index.
- Delete: `DELETE /v1/knowledge/bases/:id` and `DELETE /chat/portal/knowledge/:id` (a personal knowledge base),
  `DELETE /channels/:channelId/workspace/knowledge/:kbId` (a workspace knowledge base, the workspace owner only),
  `DELETE /conversations/:id` and `DELETE /chat/portal/conversations/:id`, and `DELETE /channels/:id` set
  `deletedAt` and `deletedById`; the answers and the permission checks are as before (a channel with a workspace still
  answers 409, RX-144, and the soft delete itself names `workspace: null`, where the hard delete had the foreign key of
  RNX-202). Every child row stays: chunks, agent links (`agent_knowledge_bases`), messages, rooms, room
  messages, the channel's agent links and its reminders. Usage rows are not touched.
- Reads: the three models are on `PrismaService`'s default filter (`VISIBLE_ONLY`), so every top-level read hides a
  deleted row; the routes then answer 404 as for a row that does not exist, and the lists and their totals (the
  conversation list `total`, the knowledge base lists) leave it out. The writes by id (`softDeleteKnowledgeBase`,
  `updateKnowledgeBase`, `softDeleteConversation`, `updateConversationTitle`, `softDeleteChannel`, `updateChannel`)
  name `deletedAt: null` themselves and answer 404 on a deleted row.
- Reads the filter does not reach carry the condition by hand, each with a test:
  - the vector search SQL: `kb.deleted_at IS NULL` in the personal search and the search of one base
    (`knowledge-chunk.repository.ts`, which now joins `knowledge_bases` for the one-base search) and in the workspace
    search (`workspace-knowledge.service.ts`);
  - an agent's knowledge base links, `where: { knowledgeBase: LIVE_KNOWLEDGE_BASE }`: the agent list and read, the
    agent of a run, the agent returned after a change (`agent.repository.ts`), the link lookup of the unlink route
    (`agent-knowledge-base.repository.ts`), the agent of a channel room chat (`channel-agent.repository.ts`) and of
    the WhatsApp webhook (`agent-channel.repository.ts`);
  - reminders, `channel: LIVE_CHANNEL` (`reminder.repository.ts`): the list, the read, the owner lookup of update
    and delete, and the scheduler's due reminders.
- A live row that points at a deleted knowledge base or channel through a required relation (an agent's knowledge
  base link, a reminder of the channel) is left out whole, with no "deleted" mark, and comes back if the marker is
  cleared.
- A knowledge base of a deleted workspace (RNX-125) is not on the default filter; it stays hidden as RNX-125 hides it:
  the channel's workspace routes (its knowledge bases, their chunks and search) answer 404 "Workspace not found", and
  the personal routes and the personal search serve only bases without a workspace.
- The channel of a deleted workspace is written by hand: `LIVE_CHANNEL` (`channel/config/live-channel.ts`) is
  `deletedAt: null` and not a channel whose workspace is deleted (a channel without a workspace matches). It is not
  listed (`listUserChannels`), every room chat in it is refused with 404 before any model call
  (`ChannelService.resolveChannelAgent`, whatever the agent), and its reminders are hidden and never fire
  (`reminder.repository.ts`). Its workspace routes still answer "Workspace not found" (RNX-125). All of it comes back
  when the workspace marker is cleared.

## Why Soft Delete

Hard delete is simple but creates product and operational risks:

- accidental deletions are irreversible
- auditability is lost
- related records can become difficult to investigate
- recovery of agents, memory, and workspace configuration becomes impossible
- future compliance or restore workflows become harder

Soft delete keeps data hidden in the application while preserving recovery and operational traceability.

## Principle

Deletion in the API should usually mean:

- mark record as deleted
- exclude it from normal reads
- preserve it for restore or purge

Physical deletion should be reserved for:

- short-lived tokens or ephemeral rows
- explicit purge jobs
- legal or retention-driven cleanup

## Recommended Pattern

Use the same cross-cutting fields for soft-deletable entities:

```prisma
status      String   @default("active") // "active" | "archived" | "deleted"
deletedAt   DateTime? @map("deleted_at") @db.Timestamptz()
deletedById String?   @map("deleted_by_id")
```

Where attribution matters, also add:

```prisma
deleteReason String? @map("delete_reason")
```

### Why keep both `status` and `deletedAt`

- `status` is convenient for product lifecycle filtering
- `deletedAt` gives an unambiguous deletion timestamp for audit and retention jobs
- `deletedById` gives operational traceability

This is better than using only `status = deleted` because retention and purge logic becomes much easier.

## Entities That Should Support Soft Delete

### High priority

- `Workspace`
- `WorkspaceMember`
- `WorkspaceInvite`
- `WorkspaceMemory`
- `Agent`
- `KnowledgeBase`
- `UserMemory`

### Medium priority

- `AgentIntegration`
- `AgentChannel`
- `Channel`
- `ChannelChatRoom`

### Usually hard delete is acceptable

- `AgentMessage`
- `ChannelMessage`
- one-time invite tokens after expiry if not needed for audit
- temporary extraction candidates or caches

For message tables, retaining immutable records is often preferable to soft delete unless the product specifically allows message deletion.

## Current Schema Implication

The schema already uses `status` on several models, including `UserMemory`, `Agent`, and `AgentChannel`, but it does not yet define a consistent deletion contract.

That means current code risks becoming inconsistent:

- some services may archive instead of delete
- some queries may include deleted rows accidentally
- restore behavior is undefined
- uniqueness constraints may block recreation after soft delete

The strategy should standardize all of that.

## Service-Layer Contract

Every soft-deletable service should implement the same contract.

### Create

- create with `status = active`
- `deletedAt = null`
- `deletedById = null`

### Read

- default queries must exclude deleted rows
- admin or explicit audit queries can opt in to include deleted rows
- deleted parent entities should not be considered visible in child list endpoints

### Update

- reject updates to deleted records unless the operation is restore
- optionally allow internal maintenance updates only

### Delete

- set `status = deleted`
- set `deletedAt = now()`
- set `deletedById`
- do not physically remove row in normal service method

### Restore

- set `status = active`
- clear `deletedAt`
- clear `deletedById`
- validate parent entities are still restorable and visible

### Purge

- permanent delete only from scheduled maintenance jobs or privileged admin flows
- allowed only after retention window passes

## Query Rules

The most important part of soft delete is not the schema field. It is consistent query filtering.

Default repository or service queries must always add:

```ts
where: {
  status: { not: 'deleted' }
}
```

For models using `deletedAt`, equivalent filtering can be:

```ts
where: {
  deletedAt: null
}
```

Recommended rule:

- use `deletedAt: null` as the canonical filter where supported
- keep `status` for user-facing lifecycle states such as `active` and `archived`

That gives cleaner semantics:

- `active` = usable
- `archived` = hidden from normal write flows but still intentionally retained
- `deletedAt != null` = deleted

## Suggested Schema Pattern by Model

### Workspace

```prisma
status      String    @default("active") // "active" | "archived" | "deleted"
deletedAt   DateTime? @map("deleted_at") @db.Timestamptz()
deletedById String?   @map("deleted_by_id")
```

### Agent

Add:

```prisma
deletedAt   DateTime? @map("deleted_at") @db.Timestamptz()
deletedById String?   @map("deleted_by_id")
```

Keep `status` for `draft | active | archived`, but treat deletion separately through `deletedAt`.

### UserMemory and WorkspaceMemory

Prefer:

```prisma
status      String    @default("active") // "active" | "archived"
deletedAt   DateTime? @map("deleted_at") @db.Timestamptz()
deletedById String?   @map("deleted_by_id")
```

Avoid mixing `deleted` into `status` if possible once the migration is introduced. Deletion is better represented by `deletedAt`.

## Uniqueness Strategy

Soft delete often breaks unique constraints. Example:

- workspace slug is unique
- agent slug is unique per owner or workspace
- invite code is unique

If a deleted row still holds the unique value, recreation fails.

Recommended approaches:

### Preferred

Change unique constraints to include lifecycle where possible.

Examples:

```prisma
@@unique([workspaceId, slug, deletedAt])
@@unique([ownerId, slug, deletedAt])
```

This approach depends on database behavior and Prisma support expectations for nullable fields.

### Safer application-level approach

- keep current unique constraint where needed for canonical identifiers such as slug
- do not allow immediate reuse of critical slugs after soft delete unless restore window has expired
- for reusable identifiers, mutate deleted records on delete, for example append a tombstone suffix internally

Example:

- before soft delete agent with slug `support-bot`
- update slug to `support-bot__deleted__<uuid>` during delete transaction

This is often the most practical approach in Prisma services.

## Cascading Behavior

Soft delete should cascade logically in service code, not by database `onDelete` rules.

### Example: deleting a workspace

Do not hard delete children. Instead:

1. soft delete workspace
2. soft delete workspace memberships
3. soft delete workspace invites
4. archive or soft delete workspace agents
5. archive or soft delete workspace memory
6. archive or soft delete workspace knowledge bases

Use a transaction where possible so the workspace never ends in a partially deleted state.

## Authorization Rules

Deletion and restore should be permissioned explicitly.

Examples:

- owner can delete or restore workspace
- admin can delete workspace memory and agents but not the workspace itself
- member cannot delete shared workspace entities unless explicitly allowed

Service methods should accept the actor identity and write it into `deletedById`.

## API Semantics

Recommended endpoint behavior:

- `DELETE /resource/:id` performs soft delete
- `POST /resource/:id/restore` restores
- `DELETE /resource/:id/purge` permanently deletes, admin-only or internal-only

Response payloads should expose lifecycle clearly:

```json
{
  "id": "...",
  "status": "deleted",
  "deletedAt": "2026-05-20T10:00:00.000Z"
}
```

## Service Implementation Pattern

### Base helper methods

Create a shared pattern or utility for soft-deletable services.

```ts
function assertNotDeleted<T extends { deletedAt: Date | null }>(entity: T) {
  if (entity.deletedAt) {
    throw new NotFoundException('Resource not found');
  }
}
```

```ts
async function softDeleteEntity(params: {
  model: string;
  id: string;
  actorId: string;
}) {
  return prisma[params.model].update({
    where: { id: params.id },
    data: {
      status: 'deleted',
      deletedAt: new Date(),
      deletedById: params.actorId,
    },
  });
}
```

If you do not want a generic helper, keep the pattern explicit in each service but enforce the same field contract.

## Read Path Enforcement

Every list and get-by-id service method should follow one of these rules:

### User-facing list

```ts
where: {
  deletedAt: null,
}
```

### User-facing detail

- fetch by id
- ensure actor has access
- reject if `deletedAt != null`

### Admin or audit list

- optional flag `includeDeleted`
- default false

Never make `includeDeleted` the default path.

## Migration Plan

### Phase 1

Add `deletedAt` and `deletedById` to target models without changing behavior.

### Phase 2

Update service queries to exclude deleted rows by default.

### Phase 3

Update delete endpoints to soft delete instead of hard delete.

### Phase 4

Add restore endpoints for key entities.

### Phase 5

Add purge job for rows older than retention threshold.

## Retention Policy

Suggested default retention windows:

- workspace entities: 30 to 90 days before purge
- invites: 7 to 30 days after deletion or expiry
- memory records: 30 days before purge unless compliance requires longer
- billing or audit-critical entities: retain longer, often no purge without explicit policy

Retention should be configurable if this becomes a commercial workspace feature.

## Risks and Failure Modes

### Risk: deleted rows still show up

Mitigation:

- centralize query filters
- add tests for list and detail endpoints
- review all Prisma calls for target models

### Risk: unique collisions after delete

Mitigation:

- decide reuse policy per identifier
- mutate unique fields on delete when necessary
- document restore implications

### Risk: partial cascade state

Mitigation:

- perform multi-entity soft delete in transactions
- log actor and timestamp
- add audit events

### Risk: restoring invalid graph

Mitigation:

- restore parent before child
- reject child restore when parent remains deleted
- validate membership and ownership relationships during restore

## Recommendation

Adopt soft delete as a service-level pattern backed by explicit schema fields.

For this codebase, the cleanest strategy is:

- keep `status` for active versus archived lifecycle
- add `deletedAt` and `deletedById` for true deletion state
- enforce `deletedAt: null` in all default reads
- make normal `DELETE` endpoints perform soft delete
- reserve hard delete for purge jobs and privileged maintenance flows

That gives you safer operations now and a cleaner foundation for workspace ownership, restore flows, and auditability later.
