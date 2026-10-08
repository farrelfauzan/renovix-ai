# Workspace-in-Server — Revised Strategy

## Core Concept Change

**Before:** Workspace is a standalone entity accessed at `/agents/workspace`.
**Now:** Workspace lives **inside a server** (Channel). Each server has exactly one workspace. The server admin invites people to collaborate on that server's agents and knowledge.

---

## Mental Model

```
Server (Channel)
├── Agents (channels you chat with)
├── Workspace (collaboration layer)
│   ├── Members (invited users who can access this server)
│   ├── Invites (pending email invitations)
│   └── Shared Knowledge / Memory (future)
```

- **1 Server = 1 Workspace** (auto-created when server is created, or created lazily on first invite)
- Server creator = workspace owner
- Workspace members can see the server's agents and chat with them
- Chat history remains private per-user
- Agents, knowledge, and memory are shared within the workspace

---

## Database Changes

### Add `channelId` to Workspace

Link workspace to its parent channel:

```prisma
model Workspace {
  id          String   @id @default(uuid())
  channelId   String   @unique @map("channel_id")   // ← NEW: 1-to-1 with Channel
  channel     Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  ownerId     String   @map("owner_id")
  owner       User     @relation(...)
  name        String                                  // defaults to channel name
  slug        String
  ...existing fields...
}

model Channel {
  ...existing fields...
  workspace   Workspace?   // ← NEW: optional 1-to-1 back-relation
}
```

### Migration Plan

1. Add `channelId` (nullable first) to `workspaces` table
2. Add unique constraint on `channelId`
3. Drop the `@@unique([ownerId, slug])` constraint (slug is now scoped to channel, not user)
4. Add `Channel.workspace` relation

---

## API Changes

### Endpoints (nested under server/channel)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/channels/:channelId/workspace` | Get workspace for this server |
| POST | `/channels/:channelId/workspace` | Create/enable workspace for server |
| PATCH | `/channels/:channelId/workspace` | Update workspace settings |
| GET | `/channels/:channelId/workspace/members` | List members |
| PATCH | `/channels/:channelId/workspace/members/:id` | Update member role |
| DELETE | `/channels/:channelId/workspace/members/:id` | Remove member |
| GET | `/channels/:channelId/workspace/invites` | List invites |
| POST | `/channels/:channelId/workspace/invites` | Send invite |
| POST | `/channels/:channelId/workspace/invites/:id/resend` | Resend |
| POST | `/channels/:channelId/workspace/invites/:id/revoke` | Revoke |
| GET | `/channels/:channelId/workspace/quota` | Seat usage |
| GET | `/workspace-invites/accept?token=xxx` | Resolve token (public) |
| POST | `/workspace-invites/accept` | Accept invite (authed) |

### Auth/Access

- Only the channel owner (or workspace admin) can invite/manage
- Channel `userId` = workspace `ownerId`
- Members with workspace access can see channel agents and chat

---

## Frontend Changes

### No standalone workspace pages

Remove:
- `/agents/workspace` route
- `/agents/workspace/new` route
- `/agents/workspace/[id]` route
- Workspace icon button in left server bar

### Server gets a "Team" section in the middle panel

Inside the **ServerMiddlePanel** (the middle 240px column), add a "Team" section below the agent channels:

```
ServerMiddlePanel
├── Header (server name, icon)
├── Agent channels list (existing)
├── ─────────── separator ───────────
├── 👥 Team (N members)     ← NEW button/section
│   └── Opens workspace sheet/panel
└── Footer (Create Agent, Delete Server)
```

Clicking "Team" toggles a **collapsible right sidebar** (like Discord's member list panel):
- Sits to the right of the chat area
- Can be collapsed/expanded with the "Team" button
- Shows members list with roles
- "Invite" button → invite dialog (email + role)
- Pending invites with resend/revoke
- Seat quota card

```
┌─────────┬────────────┬──────────────────────┬──────────────┐
│ Servers │ Agents     │ Chat                 │ Team Panel   │
│ (72px)  │ (240px)    │ (flex-1)             │ (260px)      │
│         │            │                      │ collapsible  │
│  ← Back │ # agent-1  │ Messages...          │ 👑 Owner     │
│  Server1│ # agent-2  │                      │ 🛡️ Admin     │
│  Server2│            │                      │ 👤 Member    │
│  + New  │ 👥 Team    │                      │ [Invite]     │
└─────────┴────────────┴──────────────────────┴──────────────┘
```

### Workspace is created lazily

When server owner clicks "Team" for the first time:
- If no workspace exists → auto-create it (POST `/channels/:id/workspace`)
- Then show the members panel

### Invite accept page stays

`/workspace-invites/accept?token=xxx` stays as a top-level route since it's accessed from email.
After accepting, redirect to `/agents?server=<channelId>`.

---

## UI Components (Revised)

```
components/
├── workspace/
│   ├── server-team-sidebar.tsx        # Collapsible right sidebar (members + invites + quota)
│   ├── workspace-members-tab.tsx      # Member list with roles (reuse, minor refactor)
│   ├── workspace-invites-tab.tsx      # Pending invites (reuse)
│   ├── workspace-invite-dialog.tsx    # Email + role modal (reuse)
│   ├── workspace-quota-card.tsx       # Seat progress bar (reuse)
│   └── accept-invite-client.tsx       # Token resolve + join CTA (update redirect)
```

### Remove (from previous implementation)

- `workspace-page-client.tsx` (standalone list page)
- `create-workspace-form.tsx` (standalone create)
- `workspace-detail-client.tsx` (standalone detail with tabs)
- `workspace-settings-tab.tsx` (settings now part of server settings)

---

## Hooks Changes

```ts
// Revised hooks - workspace scoped to channelId
useServerWorkspace(channelId)           → GET /channels/:id/workspace
useCreateServerWorkspace(channelId)     → POST /channels/:id/workspace
useWorkspaceMembers(channelId)          → GET /channels/:id/workspace/members
useWorkspaceInvites(channelId)          → GET /channels/:id/workspace/invites
useWorkspaceQuota(channelId)            → GET /channels/:id/workspace/quota
useInviteMember()                       → POST /channels/:id/workspace/invites
useResendInvite()                       → POST /channels/:id/workspace/invites/:id/resend
useRevokeInvite()                       → POST /channels/:id/workspace/invites/:id/revoke
useUpdateMember()                       → PATCH /channels/:id/workspace/members/:id
useRemoveMember()                       → DELETE /channels/:id/workspace/members/:id
useAcceptInvite()                       → POST /workspace-invites/accept
useResolveInvite(token)                 → GET /workspace-invites/accept?token=xxx
```

---

## Implementation Order

| # | Task | Notes |
|---|------|-------|
| 1 | Prisma: Add `channelId` to Workspace + Channel back-relation | Migration |
| 2 | API: Create `WorkspaceChannelController` (nested under channels) | New controller |
| 3 | API: Update `WorkspaceService` to create by channelId | Service changes |
| 4 | Frontend: Rewrite `use-workspaces.ts` hooks to channel-scoped | Hook refactor |
| 5 | Frontend: Create `server-team-sidebar.tsx` (collapsible right panel) | New component |
| 6 | Frontend: Add "Team" button to `ServerMiddlePanel` | UI integration |
| 7 | Frontend: Remove standalone workspace pages/routes | Cleanup |
| 8 | Frontend: Update `accept-invite-client.tsx` redirect | Minor fix |

---

## User Flow

### Server Owner

1. Creates a server (already works)
2. Clicks "Team" in server middle panel
3. Workspace auto-created → sees empty members list (just themselves as owner)
4. Clicks "Invite" → enters email + role → invite sent
5. Teammate receives email → clicks "Accept Invitation" → joins server workspace
6. Teammate now appears in server members and can access agents

### Invited Member

1. Receives email with "Accept Invitation" button
2. Clicks → lands on `/workspace-invites/accept?token=xxx`
3. Signs in (or creates account) → clicks "Join Workspace"
4. Redirected to `/agents?server=<channelId>`
5. Sees the server in their left bar with shared agents
