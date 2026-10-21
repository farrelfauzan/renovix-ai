# Product role and permission matrix

- Source: spec v2, https://claude.ai/artifact/QEerixnDkavEQKMViBq53n (Draft 2.1, 2026-10-21; drafted by the Researcher, on the Orchestrator's handoff)
- Status: approved by the Tech Lead as recommended, point B narrowed (D237, 2026-10-21); draft 2 records the decisions
- Code read at main `36d9e26`
- Ticket: RNX-111 (RX-111)
- Summary: 2 workspace roles (owner, collaborator); 3 company roles (owner, billing admin, member); 29 product permissions named (section 3); decided in D237: D18 A, no viewer, A, B, C

Who may do what in the Renovix AI product, at the workspace level and at the company level, with every permission named `resource:action` so each route can declare it in `@Access` (D66, D67, RX-114) and the policy service of RX-41 can answer record-level questions with the same names. The back-office roles (PRD 09, RX-94 to RX-97) are a separate set and are not in this document.

## 1. Short answer and what the Tech Lead decides

The matrix follows what is already decided: two workspace roles (owner builds, collaborator runs; D77 Q15, D81, R14), three company roles kept at the company level (PRD 04, RX-56, RX-60), collaboration only on Enterprise (D44, D64), knowledge-base rules from D63 and D64, usage totals for the company owner only (D78 Q17), and tools per account (D77 Q18, R15). Roles compose: a person holds one company role (or none, for an individual account) plus one workspace role per workspace they are in.

Three things the ticket asked the Tech Lead to decide; all decided on 2026-10-21 (D237), as recommended except B, which was narrowed:

1. **D18, who tops up a company's pool:** proposal, the company owner and billing admins, charged to the company; members ask for more credits; a personal top-up never touches the pool (section 5). **Decided: option A.**
2. **Does "viewer" exist in the product:** proposal, no. D77 Q15 already retires `admin` and `viewer`; this document records the consequence and the clean-up (section 6). **Decided: no viewer.**
3. **Three open points** (section 9), decided: A, documents inside a workspace knowledge base are owner-only; B, narrowed to the web-search *policy* only, the provider key routes stay per person (R15); C, only the company owner's workspaces are company workspaces in v1. The two resulting code changes are RNX-218 (Backlog).

## 2. Principals and roles

A **principal** is whoever the request is made as. Today the guard produces four: a signed-in user (login token or better-auth session), the user behind an API key, an anonymous portal session (with an optional user), and back-office staff (`access-method.ts`). The product roles below are facts about a signed-in user or an API-key user, read from the data on each request; none is stored as a "role" column except the workspace member row.

| Role | Who | Where it comes from (today and target) | Decided by |
|---|---|---|---|
| **Individual account owner** | Any signed-in user: free, Starter or Pro, and every Enterprise person for their own account | The `User` row. Owns a hidden default workspace (`Workspace.isDefault`, RNX-117) and any workspace they create. Starter and Pro have no collaboration: their workspaces are owner only. | D13, D44, D64, RNX-117 |
| **Workspace owner** | The creator of a workspace | `Workspace.ownerId`. Builds and edits the workspace, its agents, links, knowledge and tools; invites collaborators on Enterprise. | D63, D77 Q14 and Q15, R14 |
| **Collaborator** | A person invited into a workspace, on an Enterprise owner's subscription | An active `WorkspaceMember` row (`status = active`), only while the workspace owner's subscription is Enterprise (`WorkspaceQuotaService.isCollaborationAllowed`, RX-113). Stored as role `member`, shown as "collaborator". Chats with the workspace's agents, sees own runs and own usage, edits nothing. | D64, D77 Q15, R14, RX-119 |
| **Company owner** | The one person who holds the Enterprise contract and the company pool | Target: the account the company contract and the company `CreditAccount` belong to (RX-31, RX-86); transferable (RX-56). Today there is no company table; the Enterprise subscription sits on a `User`. | PRD 04, D78 Q17, RX-56 |
| **Billing admin** | One or more people the company owner names to keep billing going | Target: a company-level designation created by RX-56 ("a second admin"). Sees billing, pays invoices and top-ups (D18 proposal), never usage totals. Does not exist in the schema today. | PRD 04 req. 5, D78 Q17, RX-56, RX-60 |
| **Company member** | A seat holder: anyone who is an active collaborator in a workspace owned by the company owner | Derived, not stored: counted across all of the company's workspaces against the seat limit (RX-31). Spends from the pool when running the company's agents; sees own usage and own share bar; can ask for more credits. | PRD 04, RX-31, RX-38, RX-60, D77 Q16 |
| **Other signed-in user / public** | Anyone else, including an anonymous portal session | May run a public, active agent, which then stands alone (no links, no workspace knowledge, R17). Nothing else in a workspace. | D78 Q8, R17 |
| **API-key principal** | The user behind `User.apiKey` | Acts as that user, but only on the API-key routes (`API_KEY_ROUTES` in `app.module.access.spec.ts`): completions, conversations, personal knowledge, export. Never a workspace or company route. API access is a package entitlement (RX-76). | RX-114, D112 item 42, RX-76 |
| ~~Workspace admin, viewer~~ | Not roles | Still in the schema comment and the Zod DTOs today; made unassignable by RX-119, and retired here (section 6). | D77 Q15 |

## 3. Permission names

Same format as the staff set (`staff-permissions.ts`), separate list. A route declares what it needs in `@Access({ permissions: [...] })`; the guard resolves the workspace from the route (RX-41) and the company from the caller. "Self" means the permission is always held for the caller's own account and records; it is named so the route table is complete, and the policy service still scopes the record to the caller.

| Permission | Scope | Held by | Covers | Source |
|---|---|---|---|---|
| `workspace:create` | account | Any signed-in user with an active package (entitlement, not a role) | Create a workspace beyond the default one | Today: `requireSubscription`; RX-76 |
| `workspace:read` | workspace | Owner, collaborator | Read the workspace, its quota, its member list | RX-113 |
| `workspace:update` | workspace | Owner | Name, description, avatar, settings | R14 |
| `workspace:archive` | workspace | Owner (never the default workspace) | Archive / delete the workspace | Today owner only (`workspace.service.ts:127`); RNX-117 |
| `workspace.members:read` | workspace | Owner, collaborator | List members | RX-113 |
| `workspace.members:manage` | workspace | Owner, and only when collaboration is allowed (Enterprise) | Invite, resend, revoke, remove, reactivate; the owner row is never changed | D64, R14, RX-119 ("invite or remove members" is a collaborator-refused path) |
| `workspace.agents:manage` | workspace | Owner | Create, edit, delete, change status, publish, tools, integrations, channels, attach or detach knowledge, deploy | PRD 10 (named there), R14, RNX-203 |
| `agent.links:manage` | workspace | Owner | Add or remove "Can call" links; both agents in the same workspace | PRD 10 (named), D75, D77 Q14, RX-118 |
| `agent:run` | agent | Owner (inside), current collaborator (inside), or anyone when the agent is public and active (outside, alone) | Agent chat, channel chat, public API, reminders | PRD 10 (named), R17, RX-119 |
| `agent.runs:read` | self | The runner, for their own runs only; the workspace owner does not see a collaborator's runs | Run list, run detail, delete own run | D78 Q17, R14 |
| `workspace.knowledge:create` | workspace | Owner | Add a knowledge base to the workspace | D63, RX-113 (enforced) |
| `workspace.knowledge:read` | workspace | Owner, collaborator (current membership) | List, read chunks, search; retrieval in agent runs | D63, D64, RX-113, RX-116 |
| `workspace.knowledge:delete` | workspace | Owner | Delete a workspace knowledge base | D64 |
| `workspace.knowledge.documents:manage` | workspace | Owner (D237: D64 said owner and admins; admin is retired, so it narrows to the owner) | Add or remove documents and chunks inside a workspace knowledge base | D64, R14 |
| `workspace.tools:manage` | workspace | Owner (D237) | The workspace web-search policy only (`PUT /integrations/web-search/policy`). Provider keys are not covered: each key is the caller's own `UserMcpCredential` row, under `account.tools:manage` | R14, R15, D237; RNX-218 |
| `account.tools:manage` | self | Every signed-in user, for their own connections | Connect MCP servers, OAuth, store or delete own credentials; a credential stored for a workspace still requires current membership and Enterprise (RX-119) | D77 Q18, R15 |
| `account.api_key:rotate` | self | Every signed-in user whose package includes API access | Regenerate the account's API key | Today `POST /auth/keys/regenerate`; RX-76 (apiAccess) |
| `account.profile:update` | self | Every signed-in user | Profile fields | today |
| `account.usage:read` | self | Every signed-in user, own usage only | Own usage, own share bar on Enterprise | D78 Q17, R16 |
| `account.billing:purchase` | self | Every signed-in user, within the credit rules | Buy a package; buy a top-up pack only with a package (D36); redeem a code; stays open when locked (D3) | D3, D36, D37, RX-35 |
| `channel:manage` | channel | The channel's owner (`Channel.userId`); for a workspace channel that is the workspace owner | Create, edit, delete a channel ("server"), its icon, add or remove agents, clear messages | today (service checks by `userId`) |
| `company.usage:read_totals` | company | Company owner ONLY | Pool balance, spend this period, one credit total per member, run-out warnings, CSV of the same | PRD 10 (named), D78 Q17, RX-38 |
| `company.members:manage` | company | Company owner | Edit a member's share or hard cap (D2), remove a person from the company (all its workspaces), seat count up to the contract limit | RX-31, RX-38 |
| `company.billing:read` | company | Company owner, billing admin | Company billing section: billing information, invoices, receipts, pay buttons | PRD 04 req. 5, RX-60 |
| `company.billing:update_info` | company | Company owner, billing admin | Legal name, NPWP, address, billing email, PO reference | RX-32, RX-60 |
| `company.billing:top_up` | company | Company owner, billing admin (D18 decided, option A, D237) | Start a Xendit invoice for extra pool credits; pay the renewal invoice | D18, D19, RX-60 |
| `company.billing_admins:manage` | company | Company owner | Name or remove billing admins | RX-56 |
| `company:transfer_ownership` | company | Company owner | Transfer the company account (ledger, profile, contract) to another member | RX-56 |
| `company.credits:request` | company | Company member (and billing admin) | "Ask your admin for more credits": a notice and an email to the company owner | RX-60, D78 |

Not permissions: **spending the pool** happens through `agent:run` on a company workspace (the runner is a member, the run is inside the workspace, the pool is not frozen or empty; RX-31, D77 Q16, D23). **Accepting an invite** is a rule on the invitee (the email matches, the owner's plan allows collaboration), not a role. **Package limits** (agents, tools, API access, tiers) are entitlements checked by RX-76 next to the permission, not inside it.

## 4. The matrix

yes = allowed; no = refused with 403 and a negative test; own = own records only; open = needs the Tech Lead's word (section 9); n/a = not applicable.

### 4a. Workspace actions, by workspace role

| Action | Permission | Workspace owner | Collaborator | Other user / public | API-key principal |
|---|---|---|---|---|---|
| Read the workspace, quota, members | `workspace:read, workspace.members:read` | yes | yes | no | no |
| Edit the workspace; archive it | `workspace:update, workspace:archive` | yes | no | no | no |
| Invite, resend, revoke, remove members | `workspace.members:manage` | yes (Enterprise only) | no | no | no |
| Create, edit, delete, publish agents; set their tools, integrations, channels; attach knowledge | `workspace.agents:manage` | yes | no | no | no |
| Set "Can call" links | `agent.links:manage` | yes | no | no | no |
| Run a workspace agent (chat, channel, reminder), inside the workspace | `agent:run` | yes | yes (current member, Enterprise) | no | no (no agent routes on API keys today) |
| Run a public active agent, alone | `agent:run` | yes | yes | yes (R17: no links, no workspace knowledge) | no |
| See runs and run trees | `agent.runs:read` | own | own | no | no |
| Add a knowledge base to the workspace | `workspace.knowledge:create` | yes | no | no | no |
| Read, search, use a workspace knowledge base (also in agent runs) | `workspace.knowledge:read` | yes | yes | no | no |
| Add or remove documents inside a workspace knowledge base | `workspace.knowledge.documents:manage` | yes | no (D237) | no | no |
| Delete a workspace knowledge base | `workspace.knowledge:delete` | yes | no | no | no |
| Workspace web-search policy | `workspace.tools:manage` | yes | no (D237) | no | no |
| Connect own tools and MCP servers; store own credentials for a workspace, the web-search provider key included | `account.tools:manage` | own | own (membership and Enterprise checked, RX-119) | no | no |
| Manage the workspace's channel ("server"): icon, agents in rooms, messages | `channel:manage` | yes | no | no | no |
| See another person's conversations or usage in the workspace | none | no (D78 Q17) | no | no | no |

On Starter, Pro and free accounts the owner column is the whole matrix: there are no collaborators (D44, D64), and the server refuses invites, accepts and member routes with 403 (RX-113, later RX-76).

### 4b. Company, billing, credits and account actions, by company role

| Action | Permission | Individual (no company) | Company owner | Billing admin | Company member |
|---|---|---|---|---|---|
| See own usage, own share bar, own warnings | `account.usage:read` | own | own | own | own |
| See pool balance, period spend, one total per member, run-out warnings, CSV | `company.usage:read_totals` | n/a | yes | no | no |
| Edit a member's share or hard cap (D2); remove a member from the company | `company.members:manage` | n/a | yes | no | no |
| See the company billing section, invoices, receipts | `company.billing:read` | n/a | yes | yes | no |
| Enter or change company billing information (NPWP, address, billing email) | `company.billing:update_info` | n/a | yes | yes | no |
| Top up the pool; pay the renewal invoice (Xendit, GoPay or QRIS) | `company.billing:top_up` | n/a | yes | yes (D18, D237) | no |
| Ask for more credits | `company.credits:request` | n/a | n/a | yes | yes |
| Name or remove billing admins | `company.billing_admins:manage` | n/a | yes | no | no |
| Transfer company ownership | `company:transfer_ownership` | n/a | yes | no | no |
| Spend the pool (run a company workspace agent) | via `agent:run` | n/a | yes | yes if also a collaborator | yes (attributed to the member) |
| Buy a personal package or top-up; redeem a code (goes to the personal balance, never the pool) | `account.billing:purchase` | own | own | own | own |
| Rotate the account API key (package with API access) | `account.api_key:rotate` | own | own | own | own |
| Update own profile | `account.profile:update` | own | own | own | own |
| Create a workspace (beyond the default one) | `workspace:create` | yes with a package | yes | own with a package; owner-only, not a company workspace (D237, C) | own with a package; owner-only, not a company workspace (D237, C) |

A billing admin or a member who is also a workspace owner or collaborator has those workspace rights in that workspace (section 4a); the company role adds nothing there. A workspace owner who is not the company owner sees nothing about collaborators (D78 Q17).

## 5. D18 proposal: who tops up a company's pool

**Decided (D237, 2026-10-21): option A, the company owner and billing admins, charged to the company.** Members never pay for the company; a member who is near the limit or locked gets "Ask your admin for more credits", which reaches the company owner and the billing admins (RX-60). A person's own top-up always goes to their personal balance (D18 recommendation, `docs/credits.md` section on the pool). With one fixed rule, the nullable `CompanyContract.topUpRoles` Json column (schema line 1195, "D18, open, no default") has no job: drop it in the RX-56 or RX-60 migration, or keep it null and unread until a customer asks for a narrower rule.

| Option | Pros | Cons | Cost | Risk |
|---|---|---|---|---|
| **A. Owner and billing admins** (recommended; what D18, PRD 04 req. 5 and RX-60 already say) | Billing continues when the owner is away (the stated purpose of RX-56's second admin); one rule, no per-contract setting; matches Q17 (billing admins pay without seeing totals) | A billing admin can commit company money without the owner's click; mitigated by Xendit's payment step (someone still has to pay the invoice) and by the owner naming the admins | Low: one permission on two roles; RX-56 creates the designation anyway | Low |
| **B. Owner only** | Simplest control; no second role touches money | If the owner is away nobody can pay the renewal, and D23's freeze stops the whole company; makes RX-56's second admin pointless for billing | Lowest | Medium: an avoidable freeze for a 100-seat customer |
| **C. Per contract** (keep `topUpRoles`, set at activation) | A customer can demand "owner only" | Another setting the back office must fill with no default (RX-86), one more branch to test, and no customer has asked | Medium: back-office field, validation, tests | Low, but D46 ("values are settings") was about prices and limits, not about who may pay |

## 6. Proposal: "viewer" does not exist in the product

**Decided (D237, 2026-10-21): no viewer role (option A); D77 Q15 confirmed.** The decision is already made (D77 Q15, D81: owner and collaborator only, `admin` and `viewer` retired, not assignable). A collaborator already is the read-and-run role; a role that reads but may not chat has no use case in PRD 10, where the point of inviting someone is that they chat with the agents. What remains is the clean-up:

- RX-119 makes the invite and member DTOs refuse `admin` and `viewer` (400) and renders `member` as "collaborator".
- Nothing is deployed (D190), so a later migration (RX-41, or the RX-119 PR if the Engineer prefers) may add a CHECK that `workspace_members.role` and `workspace_invites.role` are `owner` or `member`, and update the schema comments at lines 715 and 734. D49 ("no data migration") is not touched because there is no data to migrate.
- Until then, the policy service reads any stored `admin` or `viewer` row as a collaborator (read and run, no writes), so a stale row can never grant more than a collaborator.

| Option | Pros | Cons | Cost | Risk |
|---|---|---|---|---|
| **A. No viewer** (recommended; already decided) | Two roles, one matrix column less, every "collaborator write path refused" test covers it; matches R14 and the RX-41 and RX-119 texts | No read-only guest for Enterprise; if a customer wants "watch but don't spend", a per-member hard cap of 0 (D2) gives it later | One CHECK constraint, two schema comments | Low |
| **B. Keep viewer as read-only** | A guest who sees agents and knowledge without spending the pool | Reopens D77 Q15; needs its own permission rows, UI copy, tests, seat-count rule; conflicts with "collaboration means chatting" | Medium across RX-119, RX-120, RX-122, RX-38 | Medium: a third role that the engine and billing must know about |

## 7. Route map: every data-changing product route and its permission

Read from main `36d9e26`. "Today" is the check actually in the code; "Permission" is what the route declares once RX-41 moves checks into `@Access`; "Ticket" is who changes it. Reads are listed where a role matters. Back-office routes are not listed. Public routes without a user (`register`, `login`, better-auth, the webhooks, `GET /models`, `GET /workspace-invites/accept`) carry no product permission and stay as pinned in `app.module.access.spec.ts`.

### Workspace (`workspace.controller.ts`, `workspace-channel.controller.ts`)

| Route | Today | Permission | Ticket |
|---|---|---|---|
| POST /workspaces · POST /channels/:channelId/workspace | any active subscription (`requireSubscription`); channel owner | `workspace:create` | RX-41 (RX-76 for the entitlement) |
| GET /workspaces, /:id, /:id/quota, /:id/members (and the /channels/… twins) | membership; non-owner needs Enterprise | `workspace:read, workspace.members:read` | RX-41 |
| PATCH /workspaces/:id | owner or admin (`workspace.service.ts:114`) | `workspace:update` | RX-41 (RX-119 refuses collaborators first) |
| DELETE /workspaces/:id | owner (`workspace.service.ts:127`) | `workspace:archive` | RX-41 |
| PATCH, DELETE /workspaces/:id/members/:memberId · POST /:id/invites, …/resend, …/revoke (and the /channels/… twins) | owner or admin (`workspace.controller.ts:109-198`, `workspace-channel.controller.ts:205-321`); Enterprise via `enforceCollaboration` | `workspace.members:manage` | RX-119 (collaborator 403), RX-41 |
| POST /workspace-invites/accept | signed-in; owner's plan must allow collaboration (RX-113) | none (invitee rule in the service) | unchanged; RX-76 swaps the plan check |
| POST /channels/:channelId/workspace/knowledge | owner only (`:366`, D63) | `workspace.knowledge:create` | done (RX-113); RX-41 renames |
| DELETE …/workspace/knowledge/:kbId | owner or admin (`:386`) | `workspace.knowledge:delete` | RX-41 (owner only per D64) |
| POST …/knowledge/:kbId/chunks | owner, admin or member (`:420-423`) | `workspace.knowledge.documents:manage` | RNX-218 (owner only), then RX-41 |
| DELETE …/knowledge/:kbId/chunks/:chunkId | owner or admin (`:444`) | `workspace.knowledge.documents:manage` | RNX-218, then RX-41 |
| GET …/knowledge, …/chunks · POST …/knowledge/search | current member | `workspace.knowledge:read` | done (RX-113); RX-41 renames |

### Agents (`agent.controller.ts`, `agent-run.controller.ts`)

| Route | Today | Permission | Ticket |
|---|---|---|---|
| POST /agents · POST /agents/clone/:templateId | subscription; caller owns the target workspace (`findUserAgent`, RNX-203) or the default one | `workspace.agents:manage` | RX-41 (RX-76 agent limit) |
| PATCH, DELETE /agents/:id · PATCH /:id/status · POST /:id/publish · POST, DELETE /:id/tools · /:id/integrations · /:id/channels | workspace owner (`verifyOwnership`, `agent.service.ts:566`) | `workspace.agents:manage` | RX-119 (collaborator 403 tests), RX-41 |
| POST, DELETE /agents/:id/knowledge-bases/:kbId | workspace owner; a workspace KB also owner or admin of its workspace (`agent.service.ts:363`) | `workspace.agents:manage` | RX-41 (same workspace rule, D64) |
| Agent links: list, add, remove (new) | not built | `agent.links:manage` | RX-118 |
| POST /agents/:id/chat · POST /channels/:id/agents/:agentId/chat · reminders · public API | owner or public active (`findRunnableAgent`, `agent.repository.ts:75-80`) | `agent:run` | RX-119 (collaborator inside, public alone), reused by RX-41 and RX-23 |
| GET /agents/:id/runs, /:runId · DELETE /:runId | workspace owner (`findUserAgent`) | `agent.runs:read` | RX-119 (per-person scoping) |
| GET /agents, /public, /tools/available, /subscription, /:id · POST /agents/generate-prompt | signed-in | none beyond sign-in (reads; generate-prompt is an LLM call, writes nothing we found) | unchanged |

### Tools and MCP (`mcp.controller.ts`, `mcp-user.controller.ts`, `web-search.controller.ts`)

| Route | Today | Permission | Ticket |
|---|---|---|---|
| GET /mcp/user/oauth/start · POST /mcp/user/connect · DELETE /mcp/user/credentials/:provider | signed-in; `connect` and the reads require membership of the given workspace (`mcp-user.controller.ts:130,151,168`); no Enterprise check (RX-119 scope) | `account.tools:manage` | RX-119 (membership and Enterprise on store) |
| GET /mcp/user/oauth/callback | public; the state names the user | none | unchanged |
| DELETE /mcp/servers/:id · POST /mcp/servers/:id/test | signed-in; per-user scoping not verified | `account.tools:manage` | RX-41 to verify the scoping |
| PUT /integrations/web-search/policy | owner or admin (`web-search.controller.ts:96`) | `workspace.tools:manage` | RNX-218 (owner only), then RX-41 |
| PUT /integrations/web-search/brave/key · PUT …/providers/:provider/key · DELETE …/brave/key | current member (`requireMembership`, which also runs the Enterprise check, `:50,:65,:123`); the key is the caller's own `UserMcpCredential` row | `account.tools:manage` | unchanged (D237, R15) |

### Account, billing, credits

| Route | Today | Permission | Ticket |
|---|---|---|---|
| PATCH /auth/me | signed-in | `account.profile:update` | RX-41 |
| POST /auth/keys/regenerate | signed-in | `account.api_key:rotate` | RX-41; RX-76 (apiAccess) |
| POST /codes/redeem · GET /codes/history · GET /usage | signed-in | `account.billing:purchase · account.usage:read` | RX-41 |
| POST /billing/checkout · POST /webhooks/stripe | signed-in; Stripe, disabled unless `STRIPE_ENABLED` | none: legacy, outside D22 (Xendit only) | RX-57 removes; RX-35 replaces with Xendit checkout under `account.billing:purchase` |
| Company routes (new): totals, member share and cap, billing info, invoices, top-up, request credits, billing admins, transfer | not built; no company table | `company.usage:read_totals · company.members:manage · company.billing:read · company.billing:update_info · company.billing:top_up · company.credits:request · company.billing_admins:manage · company:transfer_ownership` | RX-38, RX-56, RX-60 (RX-31 for pool spending) |

### Channels, reminders, API-key and portal surfaces

| Route | Today | Permission | Ticket |
|---|---|---|---|
| POST, PATCH, DELETE /channels/:id, /:id/icon, /:id/agents/:agentId, /:id/agents/:agentId/messages | channel owner by `userId` in the service | `channel:manage` | RX-41 |
| POST, PATCH, DELETE /reminders/:id | by `userId` | self (own records); runs under `agent:run` | RX-41 (policy service), RX-119 (run rule) |
| API-key routes: POST /chat/completions, conversations, /v1/knowledge/*, POST /export | `auth: ["apiKey"]`; personal records of the key's user | self, as the API-key principal | unchanged; RX-76 (API access entitlement) |
| Portal routes: /chat/portal/* | `auth: ["portal"]`; anonymous session, optional user | self (the session's own conversations and knowledge) | unchanged |

## 8. What today's code does that the matrix forbids

1. **Web-search provider keys: not a gap** (draft 1 called it one; corrected by the Product Manager's code check, 2026-10-21). `PUT /integrations/web-search/brave/key`, `PUT …/providers/:provider/key` and `DELETE …/brave/key` check `requireMembership` only (`web-search.controller.ts:50, :65, :123`), but each writes the caller's own `UserMcpCredential` row and only the caller's own searches use it; `requireMembership` also runs the Enterprise check. That is R15 as intended. What does change is the **policy** route (`:96`, owner or admin today), which becomes owner-only in **RNX-218**.
2. **Members may add chunks to a workspace knowledge base** (`POST …/knowledge/:kbId/chunks`, `workspace-channel.controller.ts:420-423` accepts owner, admin and member) while deleting one needs owner or admin (`:444-447`). Under D237 (owner-only) both are collaborator write paths not named in RNX-119. **RNX-218** (Backlog, Bug, 2 pts, Hard, P1, after RNX-119 merges) carries them together with the web-search policy route.
3. **The schema and DTOs still offer `admin` and `viewer`** (schema lines 715, 734; `invite-member.dto.ts:5`, `update-member.dto.ts:4`). RX-119 closes the DTOs; section 6 proposes the CHECK.
4. **Product `permissions` in `@Access` are refused by the guard** (`access.guard.ts:59-62`, "not checked before RX-41"), and `plan` is refused too (`:55-57`). This is by design until RX-41; the matrix is what RX-41 needs to lift it. The Enterprise rule lives in `WorkspaceQuotaService.isCollaborationAllowed` (`workspace-quota.service.ts:52-63`, hard-coded `plan.slug === "enterprise"`) until RX-76.
5. **Stripe routes** (`POST /billing/checkout`, `/webhooks/stripe`) still exist behind a flag; outside D22. Already on RX-57.

## 9. Open points, assumptions, confidence

**Decided by the Tech Lead on 2026-10-21 (D237)**, as recommended except B, which was narrowed:

- **A. Documents inside a workspace knowledge base: owner only** (`workspace.knowledge.documents:manage`). D64 gave the right to "the owner and admins"; admin is retired, so it narrows to the owner (PRD 10 is newer than D64; R14 says collaborators do "nothing else" than chat; RNX-119 refuses every collaborator write). Code change: RNX-218.
- **B. Web search: the policy is owner only; the keys stay per person.** Narrowed from the draft 1 proposal. `workspace.tools:manage` covers `PUT /integrations/web-search/policy` only (owner or admin today; RNX-218 makes it owner-only). The provider key routes stay member-level: each key is the caller's own `UserMcpCredential` row and `requireMembership` already runs the Enterprise check, which is R15 ("credentials never cross people") and RNX-119's runner-resolved tools.
- **C. Only the company owner's workspaces are company workspaces in v1.** `isCollaborationAllowed` reads the *workspace owner's* plan, so a member without a personal Enterprise subscription cannot invite anyone into a workspace they create, and seats are counted on the company owner's workspaces (RX-31). The alternative ("any seat holder creates company workspaces paid from the pool") is not in v1; it would need a company table first (RX-56).

**Assumptions made** (stated, not decided): a company member is derived (an active collaborator in a company-owned workspace), not a stored company membership; billing admins are a company-level designation that RX-56 creates; the ticket's Scope line "workspace owner, admin, member; viewer if kept" is superseded by its own decided inputs (D77, D81, the 2026-10-09 log line "the matrix's workspace part shrinks"); "individual owner" means every account for its own things, including Enterprise people.

**Confidence.** High on the workspace half: every rule is a Tech Lead decision (D63, D64, D77, D78, D81) and the code was read at main `36d9e26`. Medium on the company half: it is built on PRD 04, RX-31, RX-38, RX-56 and RX-60 as written; none of it exists in code, there is no company table, and the billing-admin designation is RX-56's to shape. The D18 recommendation is the one the Decision log and PRD 04 already carry; the only new element is dropping `topUpRoles`.

**Not verified:** the global route prefix (paths are controller paths); whether `POST /export`, `POST /agents/generate-prompt` and `POST /mcp/servers/:id/test` persist anything; per-user scoping of `DELETE /mcp/servers/:id`; the front-end copy for "collaborator" (RX-120, RX-122 are not read).

## 10. Impact on tickets

| Ticket | What this document gives it or changes |
|---|---|
| RNX-41 (RX-41) access layer | The permission names for `@Access({ permissions })` and the role table the policy service answers; the CHECK on `role` (section 6); findings 1 to 3. Depends On RX-111 is satisfied once the Tech Lead approves. |
| RNX-119 (RX-119) collaborators run, owners edit | Confirms its scope; nothing added. The two extra routes (chunk add and delete, web-search policy) are RNX-218, ordered after RNX-119 merges. |
| RNX-218 (new, Backlog) | Carries the two code changes this matrix exposes: chunk add and delete owner-only (`workspace.knowledge.documents:manage`) and the web-search policy owner-only (`workspace.tools:manage`); Bug, 2 pts, Hard, P1; the per-person key routes are out of its scope. |
| RNX-118 (RX-118) agent links | `agent.links:manage` as named; no change. |
| RNX-116 (RX-116) workspace knowledge in agent chat | Done; its "may this user search this base" check is `workspace.knowledge:read`. |
| RNX-56 (RX-56) ownership transfer, second admin | The second admin is the **billing admin**: `company.billing:read`, `company.billing:update_info`, `company.billing:top_up` (D18 option A), nothing on usage. Owner holds `company.billing_admins:manage` and `company:transfer_ownership`. Drop or ignore `CompanyContract.topUpRoles`. |
| RNX-60 (RX-60) company billing and renewal | Pay buttons and billing section under `company.billing:*`; "ask for more credits" under `company.credits:request`, delivered to the owner and billing admins. |
| RNX-38 (RX-38) company-owner view | `company.usage:read_totals` and `company.members:manage`, owner only; the 403 tests for billing admin, second admin and workspace owner are the matrix's "no" cells. |
| RNX-31 (RX-31) Enterprise pool | Pool spending through `agent:run` by a member inside a company workspace; open point C states which workspaces count. |
| RNX-76 (RX-76) entitlements | `workspace:create`, `workspace.members:manage` (Enterprise), `account.api_key:rotate` (API access) are the places the entitlement check sits next to the permission. |
| RNX-57 (RX-57) | Stripe routes stay out of the matrix; removal already in scope. |
| RNX-120, RNX-122 (UI) | Visibility follows the matrix: collaborators get the read-only agent view and no invite, knowledge-create or link controls; the server stays the guard. |

## 11. Evidence

- Ticket: [RNX-111](https://plane.renovix.id/renovix-ai/browse/RNX-111/); related [RNX-41](https://plane.renovix.id/renovix-ai/browse/RNX-41/), [RNX-119](https://plane.renovix.id/renovix-ai/browse/RNX-119/), [RNX-118](https://plane.renovix.id/renovix-ai/browse/RNX-118/), [RNX-116](https://plane.renovix.id/renovix-ai/browse/RNX-116/), [RNX-113](https://plane.renovix.id/renovix-ai/browse/RNX-113/), [RNX-56](https://plane.renovix.id/renovix-ai/browse/RNX-56/), [RNX-60](https://plane.renovix.id/renovix-ai/browse/RNX-60/), [RNX-38](https://plane.renovix.id/renovix-ai/browse/RNX-38/), [RNX-31](https://plane.renovix.id/renovix-ai/browse/RNX-31/), [RNX-76](https://plane.renovix.id/renovix-ai/browse/RNX-76/), [RNX-218](https://plane.renovix.id/renovix-ai/browse/RNX-218/) (read 2026-10-21).
- Decisions (Notion archive, read 2026-10-21): D18, D44, D63, D64, D66, D67, D75, D77, D78, D79, D81, D112 item 42, D113 item 53, D190; [Decision log](https://app.notion.com/p/3f352ed08ee28144bb0ec248c720de2c). D211 to D235 on RNX-198: none changes the above. D237 (2026-10-21, recorded on RNX-111 and RNX-218): the Tech Lead approved this matrix as recommended, with point B narrowed to the web-search policy.
- PRDs: [PRD 10 — Peer agents and workspace model](https://app.notion.com/p/3f452ed08ee2816497a4d2f4741563fd) (rules R2, R8, R14, R15, R16, R17; Q14 to Q18; sections 4a, 4b, 8), [PRD 04 — Onboarding & Enterprise](https://app.notion.com/p/3f352ed08ee28127b052c470e7fec04f) (req. 3 to 5, workspace-model callout).
- Code at main `36d9e26`: `prisma/schema.prisma` 680-760 (Workspace, WorkspaceMember, WorkspaceInvite), 1184-1201 (CompanyContract), 1270-1290 (CreditAccount), 31 (User.apiKey); `apps/api/src/common/guards/access.guard.ts`; `apps/api/src/common/types/access-options.ts`, `access-method.ts`; `apps/api/src/app/admin-auth/config/staff-permissions.ts`; `apps/api/src/app/workspace/service/workspace.service.ts` 107-169; `workspace-quota.service.ts` 52-71; `apps/api/src/app/workspace/controller/workspace.controller.ts`, `workspace-channel.controller.ts`; `apps/api/src/app/agent/repository/agent.repository.ts` 33-45, 75-80; `apps/api/src/app/agent/service/agent.service.ts` 344-375, 566; `apps/api/src/app/mcp/controller/web-search.controller.ts`, `mcp-user.controller.ts`; `apps/api/src/app/auth/controller/auth.controller.ts` 79-84; `apps/api/src/app/app.module.access.spec.ts` 131-182 (pinned public, API-key, portal routes); `docs/credits.md` (items 11-14, pool section).
- Method: route inventory by a read-only analyst (Standard tier), every cited line re-checked by the Researcher; no proof-of-concept code; no .env read. Tiers: Standard for the inventory, 0 escalations.
