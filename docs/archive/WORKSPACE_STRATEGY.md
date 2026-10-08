# Workspace Strategy

## Overview

Build a workspace layer for AI Agents so a team can invite members into a shared server-like space, interact with the same agents, and benefit from shared memory and knowledge without exposing private conversation history.

This feature should be modeled as an organization or server boundary, not as a shared chat transcript. The workspace becomes the ownership scope for agents, shared memory, shared knowledge, membership, and permissions.

## Product Goal

Enable teams to collaborate around the same AI agents while preserving private user chat history.

A workspace member should be able to:

- join a workspace through an invite
- access workspace agents
- chat with those agents privately
- benefit from shared workspace memory and workspace knowledge
- see only the histories they personally created unless a room is explicitly designed as shared

## Core Principle

Share context, not transcripts.

What is shared:

- workspace agents
- workspace knowledge base
- workspace memory
- workspace configuration and permissions

What is private by default:

- agent run history
- direct user-to-agent conversation messages
- personal user memory

## Why This Feature Makes Sense

This is a strong feature because it creates a multi-user collaboration model without forcing full message transparency.

Teams usually want:

- common instructions and knowledge for the agent
- continuity in how the agent behaves for the company
- safe member onboarding through invites
- private day-to-day conversations with the agent

They usually do not want:

- every member reading everyone else's raw chats
- private prompts leaking across the team
- accidental exposure of sensitive operational discussions

This workspace model matches that expectation.

## Success Criteria

1. A workspace owner can create a workspace and invite members.
2. Members can access workspace agents immediately after joining.
3. Workspace agents use shared workspace memory and workspace knowledge in every chat.
4. User chat histories stay private by default.
5. Workspace memory is manageable, reviewable, and permission-scoped.
6. The backend can enforce workspace authorization cleanly at the entity level.
7. Workspace membership count is capped by the AI Agent subscription tier.

## Tier and Seat Limit Strategy

Workspace membership must not be unlimited. AI Agents should enforce a maximum number of users per subscription tier.

Recommended first-version limits:

| Tier | Max workspace users | Notes |
|------|---------------------|-------|
| Starter | 3 | small team or founder use case |
| Pro | 10 | standard team collaboration |
| Enterprise | Custom | contract-driven seat allocation |

Rules:

- the owner counts as a workspace user
- only active members count against the limit
- pending invites do not consume seats until accepted
- removed members free up seats immediately
- if the subscription is downgraded below current usage, existing members remain but new invites and new acceptances are blocked until usage is within limit

For the first version, use the workspace owner's active `AgentSubscription` as the source of truth for seat limits. If you later introduce a dedicated workspace subscription, move the same enforcement logic to `WorkspaceSubscription` without changing the product rules.

## Recommended Scope Model

Use four scopes in the system:

1. User scope
   - personal chat history
   - personal memory
   - personal draft agents if needed
2. Workspace scope
   - members
   - shared agents
   - shared memory
   - shared knowledge
   - invites and roles
3. Agent scope
   - agent configuration
   - tools
   - integrations
   - linked workspace knowledge bases
4. Run scope
   - per-user chat session state and messages

The key design choice is that memory is not agent-owned. Memory is workspace-owned and retrieved by agents during execution.

## Ownership Model

### User-owned

- `UserMemory`
- personal conversations
- personal runs if using private agents

### Workspace-owned

- `Workspace`
- `WorkspaceMember`
- `WorkspaceInvite`
- `WorkspaceMemory`
- shared `KnowledgeBase`
- shared `Agent`

### Agent-linked

- `AgentKnowledgeBase`
- `AgentTool`
- `AgentIntegration`
- `AgentChannel`

## Database Strategy

### New Models

```prisma
model Workspace {
  id          String            @id @default(uuid())
  ownerId     String            @map("owner_id")
  owner       User              @relation(fields: [ownerId], references: [id])
  name        String
  slug        String
  description String?
  avatar      String?
  status      String            @default("active") // "active" | "archived" | "deleted"
  members     WorkspaceMember[]
  invites     WorkspaceInvite[]
  memories    WorkspaceMemory[]
  agents      Agent[]
  knowledgeBases KnowledgeBase[]
  createdAt   DateTime          @default(now()) @db.Timestamptz()
  updatedAt   DateTime          @updatedAt @db.Timestamptz()

  @@unique([ownerId, slug])
  @@index([ownerId, status])
  @@map("workspaces")
}

model WorkspaceMember {
  id          String    @id @default(uuid())
  workspaceId String    @map("workspace_id")
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  userId      String    @map("user_id")
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        String    @default("member") // "owner" | "admin" | "member" | "viewer"
  status      String    @default("active") // "active" | "invited" | "removed"
  joinedAt    DateTime? @map("joined_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @db.Timestamptz()

  @@unique([workspaceId, userId])
  @@index([workspaceId, status])
  @@index([userId, status])
  @@map("workspace_members")
}

model WorkspaceInvite {
  id          String    @id @default(uuid())
  workspaceId String    @map("workspace_id")
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  email       String
  emailNormalized String @map("email_normalized")
  code        String    @unique
  tokenHash   String    @unique @map("token_hash")
  role        String    @default("member")
  status      String    @default("pending") // "pending" | "accepted" | "expired" | "revoked"
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz()
  invitedById String    @map("invited_by_id")
  invitedBy   User      @relation(fields: [invitedById], references: [id])
  acceptedById String?  @map("accepted_by_id")
  acceptedAt  DateTime? @map("accepted_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @db.Timestamptz()

  @@index([workspaceId, status])
  @@index([emailNormalized, status])
  @@map("workspace_invites")
}

model WorkspaceMemory {
  id                  String    @id @default(uuid())
  workspaceId         String    @map("workspace_id")
  workspace           Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  type                String    // "fact" | "preference" | "policy" | "context" | "exclusion"
  content             String
  confidence          Float     @default(0.75)
  sourceMessageId     String?   @map("source_message_id")
  sourceRunId         String?   @map("source_run_id")
  createdById         String?   @map("created_by_id")
  lastConfirmedAt     DateTime  @default(now()) @map("last_confirmed_at") @db.Timestamptz()
  expiresAt           DateTime? @map("expires_at") @db.Timestamptz()
  isPinned            Boolean   @default(false) @map("is_pinned")
  status              String    @default("active") // "active" | "archived" | "deleted"
  visibility          String    @default("workspace") // reserve for future scope rules
  createdAt           DateTime  @default(now()) @db.Timestamptz()
  updatedAt           DateTime  @updatedAt @db.Timestamptz()

  @@index([workspaceId, status])
  @@index([workspaceId, type])
  @@map("workspace_memories")
}
```

### Subscription Source of Truth

In the initial implementation, workspace seat limits should be resolved from the workspace owner's `AgentSubscription`.

Recommended lookup contract:

1. Resolve workspace owner.
2. Load active `AgentSubscription`.
3. Read `tier` and `maxWorkspaceUsers`.
4. Count active `WorkspaceMember` rows for that workspace.
5. Allow or reject invite and acceptance operations based on available capacity.

This avoids introducing workspace billing infrastructure too early while still making seat limits enforceable.

### Existing Models to Extend

Add `workspaceId` to these models:

```prisma
model Agent {
  workspaceId String?    @map("workspace_id")
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)
  ...

  @@index([workspaceId, status])
}

model KnowledgeBase {
  workspaceId String?    @map("workspace_id")
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)
  ...

  @@index([workspaceId])
}

model AgentRun {
  workspaceId String?    @map("workspace_id")
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)
  createdById String?    @map("created_by_id")
  createdBy   User?      @relation(fields: [createdById], references: [id], onDelete: SetNull)
  visibility  String     @default("private") // "private" | "shared"
  ...

  @@index([workspaceId, createdById])
}
```

## Memory Strategy

Use two distinct memory systems:

### Personal memory

Use the existing `UserMemory` table for user-specific preferences and context.

Examples:

- prefers concise answers
- works as a backend engineer
- wants code-first replies

### Shared workspace memory

Use `WorkspaceMemory` for facts all members should benefit from.

Examples:

- team prefers NestJS and Next.js
- company naming convention is kebab-case
- customer A prefers formal language
- never mention internal pricing externally

At runtime, the agent context should be built from:

1. user-level `UserMemory`
2. workspace-level `WorkspaceMemory`
3. workspace and agent knowledge base chunks
4. current conversation messages

## History Privacy Strategy

History must stay private by default.

Recommended rule:

- `AgentRun` and `AgentMessage` belong to the user session that created them
- members cannot list or read another member's runs unless a future explicit shared-room mode is introduced
- workspace memory can be derived from runs, but only the extracted memory record is shared, not the raw transcript

This preserves trust while still giving the team shared context.

## Permission Model

### Owner

- full workspace control
- manage billing plan for the workspace if introduced later
- manage roles
- delete or archive workspace
- view audit logs

### Admin

- manage members
- manage agents
- manage workspace memory
- manage knowledge bases
- revoke invites

### Member

- use workspace agents
- create private runs
- suggest workspace memory or knowledge updates
- view active workspace memory and knowledge they are allowed to consume

### Viewer

- consume approved agents
- no write access to memory, knowledge, or configuration

## Invite Flow

Workspace invites should be email-first.

1. Owner or admin enters the invitee email and target role.
2. Backend normalizes the email, generates a single-use token, stores only its hash, and creates a `WorkspaceInvite` row.
3. System sends an email containing the invite link.
4. Invitee opens the link and is asked to sign in or register with the same email address.
5. Backend validates token, expiry, status, and email match.
6. Backend creates or activates the `WorkspaceMember` record.
7. Invite status becomes `accepted` and the member gets access immediately.

Recommended first version:

- email-only invites
- single-use invite links
- hash stored token, not raw token
- acceptance must match invited email
- invite expiration after 7 days
- revoke support
- invite creation and acceptance must both enforce tier seat limits

### Email Invite Rules

- every invite must have a target email
- emails should be normalized to lowercase and trimmed before persistence
- users cannot accept an invite for a different email than the invited email
- invite creation must fail gracefully when the workspace has reached its tier seat cap
- the email body should clearly show workspace name, inviter name, role, and expiry date
- expired or revoked invites must fail with a clear UI message and offer resend if the actor has permission
- re-inviting the same email should revoke or replace the previous pending invite for that workspace

### Email Delivery Contract

The system should send a transactional email with:

- workspace name
- inviter display name
- assigned role
- accept-invite URL
- expiry timestamp

Recommended link shape:

```text
/workspace-invites/accept?token=<signed-or-random-token>
```

The raw token should never be stored in the database. Store only a hash and compare on acceptance.

### Email Sending Strategy

Email invite sending should be treated as a transactional system flow, not an inline side effect inside the controller.

### Recommended Tech Strategy for This Repo

Given the current stack, the recommended implementation is:

- NestJS API for invite orchestration
- PostgreSQL as the source of truth for invite and email job state
- a Postgres-backed outbox table for pending email sends
- `@nestjs/schedule` worker to poll and send pending emails
- Amazon SES SMTP or a transactional email provider API
- provider abstraction through an internal `EmailService`

This is the best fit for the repo right now because:

- PostgreSQL already exists and is the main durable store
- `@nestjs/schedule` is already installed
- Redis is not currently enabled in local infrastructure
- invite email volume will be low enough that a DB-backed outbox is sufficient initially

Recommended first version:

- do not introduce BullMQ on day one
- do not couple invite creation to immediate provider delivery success

If you want a production-ready SMTP strategy specifically, use Amazon SES SMTP.

### Why This Strategy

For this codebase, a Postgres outbox is simpler and more reliable than adding Redis plus queue infrastructure immediately.

The system flow should be:

1. Create invite row in PostgreSQL.
2. Insert email job row into an outbox table in the same transaction.
3. Return success to the API caller.
4. A scheduled worker picks up unsent jobs and calls Amazon SES SMTP or the configured provider adapter.
5. Mark the job as sent, failed, or retryable.

This gives atomicity between invite creation and email scheduling without requiring new infrastructure.

### Provider Recommendation

Preferred order:

1. Amazon SES SMTP
2. Postmark
3. Resend
4. SendGrid

Reasoning:

- Amazon SES SMTP is the best fit when you want production SMTP with strong scalability, AWS-grade infrastructure, and a clean path to grow into broader email sending later.
- Postmark is strong for transactional email reliability and operational clarity.
- Resend has a good developer experience and simple API.
- SendGrid is workable but typically heavier to operate.

For a strict SMTP requirement, use Amazon SES SMTP. Do not use Google SMTP for production workspace invites.

### Amazon SES SMTP Strategy

Amazon SES SMTP should be wrapped behind the same internal `EmailService` abstraction as any API-based provider.

Recommended transport setup:

- `nodemailer` SMTP transport in the NestJS API worker
- SMTP credentials generated from Amazon SES IAM
- dedicated sender domain such as `mail.performa.ai` or `notify.performa.ai`
- environment-scoped sender addresses such as `no-reply@notify.performa.ai`

Recommended flow with SES SMTP:

1. Invite is created and persisted with an email outbox job.
2. Scheduled worker claims the next pending `EmailJob` row.
3. Worker renders HTML and plain text email bodies.
4. Worker sends through SES SMTP using `nodemailer`.
5. Worker stores send result, provider message id if available, and retry metadata.

### SES Operational Requirements

Before SES SMTP is production-ready, configure these correctly:

- verify the sending domain in Amazon SES
- configure SPF, DKIM, and ideally DMARC for the sending domain
- move the SES account out of sandbox mode
- set up a dedicated configuration set if you later want event publishing
- define bounce and complaint monitoring through SES event destinations or mailbox monitoring
- keep separate sender identities or configuration per environment when practical

### SES Environment Variables

Recommended environment variables:

```text
EMAIL_PROVIDER=ses_smtp
EMAIL_FROM=no-reply@notify.performa.ai
SMTP_HOST=email-smtp.<region>.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USERNAME=<ses-smtp-username>
SMTP_PASSWORD=<ses-smtp-password>
```

Use port `587` with STARTTLS by default. Use port `465` only if you specifically want implicit TLS.

### SES SMTP Pros and Tradeoffs

Pros:

- production-grade SMTP option
- cheaper and more scalable than most developer-first providers at higher volume
- good fit if Performa AI will later send multiple email types beyond invites
- clean alignment if the platform already uses AWS services later

Tradeoffs:

- setup is more operationally involved than Postmark or Resend
- SMTP gives weaker product ergonomics than a modern email API
- bounce and complaint handling needs more deliberate setup

So the practical recommendation is:

- if you want the easiest product experience, use Postmark API
- if you want a production SMTP path, use Amazon SES SMTP

### Template Strategy

For the first version, keep templates server-rendered in the API layer.

Recommended options:

- simple HTML and plain-text template builders in TypeScript
- or React Email later if email volume and template count grow

Do not over-engineer templates at the start. Invite emails are transactional and low-variance.

### Suggested Tables

Add an outbox-style email job table, for example:

```prisma
model EmailJob {
  id             String   @id @default(uuid())
  type           String   // "workspace_invite"
  recipientEmail String   @map("recipient_email")
  payload        Json
  status         String   @default("pending") // "pending" | "sending" | "sent" | "failed"
  attempts       Int      @default(0)
  lastError      String?  @map("last_error")
  sentAt         DateTime? @map("sent_at") @db.Timestamptz()
  nextAttemptAt  DateTime? @map("next_attempt_at") @db.Timestamptz()
  provider       String?
  providerMessageId String? @map("provider_message_id")
  createdAt      DateTime @default(now()) @db.Timestamptz()
  updatedAt      DateTime @updatedAt @db.Timestamptz()

  @@index([status, nextAttemptAt])
  @@map("email_jobs")
}
```

If you want audit separation, keep a second delivery log table later. For the first version, one email job table is enough.

### Operational Upgrade Path

If email volume grows later, upgrade the delivery mechanism without changing the invite API contract:

- Phase 1: PostgreSQL outbox + scheduled worker
- Phase 2: Redis + BullMQ worker for higher throughput
- Phase 3: provider webhooks for bounce, complaint, and delivery sync

This keeps the first implementation lean while leaving a clean scale path.

Recommended flow:

1. Owner or admin submits invite request.
2. API validates actor permission and normalizes the email.
3. Service creates the `WorkspaceInvite` record and hashed token in a database transaction.
4. Service emits an internal domain event such as `workspace.invite.created`.
5. A dedicated email job handler consumes that event and sends the email through the provider.
6. Delivery result is recorded for observability and retry handling.

This separation is important because email providers are external dependencies and should not make invite creation fail after the database write has already succeeded.

### Recommended Backend Design for Email

- `WorkspaceInviteService`
  - create invite record
  - generate raw token and persist only the hash
  - revoke and replace existing pending invite when re-inviting the same email
- `EmailService`
  - send transactional emails
  - render templates
  - map provider failures into retryable and non-retryable classes
- `WorkspaceInviteEmailJob`
  - queue-backed async job for sending the invite email
  - supports retry with backoff
- `NotificationLog` or equivalent tracking table
  - stores invite email send status, provider message id, error summary, and retry count

Recommended provider types:

- Resend
- SendGrid
- Postmark

The provider choice is less important than having a clean abstraction and delivery logging.

### Delivery and Retry Rules

- invite creation should succeed even if email delivery is temporarily delayed
- email sending should run asynchronously through a queue
- retry transient failures up to 3 times with exponential backoff
- do not retry permanent failures such as invalid email format rejected by provider
- surface send status in admin UI so the inviter can resend if needed
- if the invite expires before delivery succeeds, later sends must be blocked

### Security Rules for Invite Email Sending

- never store the raw invite token after the email payload is built
- never log the raw invite token
- do not expose whether an email address already has an account before acceptance
- rate limit invite creation per workspace and per actor
- add audit logs for create, resend, revoke, and accept actions
- prefer branded transactional email domain with SPF, DKIM, and DMARC configured

### Email Message Design

The invite email should be simple, transactional, and immediately actionable. It should not read like marketing copy.

Recommended structure:

1. Subject line
2. Short context sentence
3. Workspace summary card
4. Primary CTA button
5. Expiry and fallback link
6. Security note

### Subject Line Options

- `You’ve been invited to join <Workspace Name> on Performa AI`
- `<Inviter Name> invited you to <Workspace Name>`

Preferred default:

```text
You’ve been invited to join <Workspace Name> on Performa AI
```

### Email Body Content

Recommended body copy:

```text
<Inviter Name> invited you to join the workspace <Workspace Name> on Performa AI.

Role: <Role>
Expires: <Expiry Date>

Join this workspace to access shared AI agents, workspace knowledge, and team memory.
Your private chat history will remain private to your account.
```

Primary CTA label:

```text
Accept Invite
```

Fallback copy under the button:

```text
If the button does not work, copy and paste this link into your browser:
<accept invite url>
```

Security footer copy:

```text
This invite was sent to <email>. You must sign in or register with this email address to accept it.
If you were not expecting this invite, you can ignore this email.
```

### Visual Design Guidance

Use a clean transactional layout:

- lightweight Performa AI branding at the top
- clear heading such as `Join Workspace`
- compact workspace info block containing workspace name, inviter, role, and expiry
- one high-contrast CTA button
- plain text fallback link
- minimal footer

Do not add:

- promotional banners
- multiple competing CTA buttons
- long product marketing sections
- dense feature grids

The message should optimize for trust and completion, not conversion theater.

### Example Invite Email Template

```html
<h1>Join Workspace</h1>
<p><strong>{{inviterName}}</strong> invited you to join <strong>{{workspaceName}}</strong> on Performa AI.</p>
<p>Role: {{role}}<br />Expires: {{expiresAt}}</p>
<p>Join this workspace to access shared AI agents, workspace knowledge, and team memory. Your private chat history will remain private to your account.</p>
<p><a href="{{acceptUrl}}">Accept Invite</a></p>
<p>If the button does not work, use this link:</p>
<p>{{acceptUrl}}</p>
<p>This invite was sent to {{email}}. You must sign in or register with this email address to accept it.</p>
```

### Plain Text Version

Every invite email should also have a plain text version for deliverability and email client compatibility.

```text
Join Workspace

{{inviterName}} invited you to join {{workspaceName}} on Performa AI.
Role: {{role}}
Expires: {{expiresAt}}

Accept invite:
{{acceptUrl}}

You must sign in or register with {{email}} to accept this invite.
If you were not expecting this email, you can ignore it.
```

### Acceptance Edge Cases

- If the invited user already exists with the same email, route them through login and then accept the invite.
- If the invited user does not exist yet, route them through registration first and bind the new account to the invited email.
- If a workspace member already exists for that email's user account, mark the invite as redundant or accepted and do not create a duplicate membership.
- If the email does not match the signed-in user, reject acceptance and prompt the correct account flow.
- If the workspace reached its seat limit after the invite was sent but before acceptance, reject acceptance with an upgrade or member-management message.

## Retrieval and Prompt Composition

Inject workspace context as a separate block.

```text
[Workspace Context]
- Team conventions: ...
- Shared preferences: ...
- Organization facts: ...
- Do-not-assume notes: ...
```

Inject personal memory separately.

```text
[User Context]
- Preferred response style: ...
- Current personal project context: ...
```

This keeps the source of truth clear and prevents workspace context from being confused with user-specific preferences.

## Service Design

### New services

- `WorkspaceService`
  - create, update, archive workspace
  - list user's workspaces
  - resolve membership
- `WorkspaceMemberService`
  - invite by email, accept invite, remove, update role
- `WorkspaceQuotaService`
  - resolve workspace owner's subscription tier
  - compute active seat usage
  - enforce max users on invite and acceptance paths
- `WorkspaceInviteService`
  - create hashed invite token
  - send invite email
  - validate token, expiry, status, and email match
  - revoke and resend invite
- `WorkspaceMemoryService`
  - CRUD for shared memory
  - relevance retrieval for agent runtime
  - moderation and deduplication
- `WorkspaceAccessService`
  - central authorization checks

### Existing services to extend

- `AgentService`
  - support workspace-scoped agents
  - enforce workspace membership
- `AgentRunService`
  - attach `workspaceId` and `createdById`
  - enforce private history visibility
  - retrieve shared memory and knowledge during execution
- `KnowledgeBaseService`
  - support workspace ownership and permissions
- `PromptTuningService`
  - inject both workspace and user context blocks

## API Surface

Recommended endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/workspaces` | Create workspace |
| GET | `/api/workspaces` | List my workspaces |
| GET | `/api/workspaces/:id` | Get workspace detail |
| PATCH | `/api/workspaces/:id` | Update workspace |
| GET | `/api/workspaces/:id/quota` | Get seat usage and max users |
| POST | `/api/workspaces/:id/invites` | Create email invite |
| POST | `/api/workspaces/:id/invites/:inviteId/resend` | Resend email invite |
| POST | `/api/workspaces/:id/invites/:inviteId/revoke` | Revoke invite |
| GET | `/api/workspace-invites/accept` | Resolve invite token metadata |
| POST | `/api/workspace-invites/accept` | Accept email invite |
| GET | `/api/workspaces/:id/members` | List members |
| PATCH | `/api/workspaces/:id/members/:memberId` | Update role/status |
| GET | `/api/workspaces/:id/memories` | List workspace memory |
| POST | `/api/workspaces/:id/memories` | Create workspace memory |
| PATCH | `/api/workspaces/:id/memories/:memoryId` | Update workspace memory |
| DELETE | `/api/workspaces/:id/memories/:memoryId` | Soft delete workspace memory |
|

## UX Notes

The UI should present the workspace clearly as a separate context boundary.

Recommended UX rules:

- workspace switcher in the sidebar
- agent list scoped to selected workspace
- visible label when user is chatting with a workspace agent
- dedicated accept-invite page for emailed invites
- explicit note that history is private by default
- dedicated memory management screen for workspace memory
- audit-style attribution on shared memory entries

## Rollout Plan

### Phase 1

- workspace creation
- membership and invites
- workspace-scoped agents
- workspace memory
- workspace-scoped knowledge base
- private per-user run history

### Phase 2

- moderation flow for proposed workspace memories
- audit log for memory changes
- shared rooms or shared run visibility as an explicit opt-in feature
- billing and subscription per workspace

### Phase 3

- cross-workspace agent templates
- workspace analytics
- enterprise controls and SSO

## Risks and Mitigations

### Risk: shared memory contamination

Mitigation:

- approval workflow for low-confidence memory
- source attribution on every shared memory item
- archive and restore controls

### Risk: permission leaks

Mitigation:

- central workspace authorization guard
- every read query scoped by workspace membership
- private run queries always filtered by `createdById`

### Risk: user confusion about privacy

Mitigation:

- explicit UI messaging: shared memory, private history
- separate labels for workspace memory vs personal memory
- no hidden auto-sharing of raw chats

## Recommendation

This feature is worth building.

The correct model is not shared chat history. The correct model is a workspace boundary that shares agents, knowledge, and curated memory while keeping personal conversations private.

That gives you a strong collaboration feature without breaking trust.
