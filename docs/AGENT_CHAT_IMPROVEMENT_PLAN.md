# AI Agent Chat Improvement Plan

## 1. Smooth Chat Experience (Match Chat Portal)

**Current:** Rigid agent chat with basic SSE handling.
**Target:** Same streaming UX as root chat portal — smooth token-by-token rendering, typing indicators, auto-scroll with snap-to-bottom, markdown rendering with code blocks.

**Changes:**
- Reuse the existing `ChatMessage` rendering component from the chat portal
- Match the SSE parsing logic from `apps/chat/src/hooks/use-chat.ts` (delta streaming, same event format)
- Add typing indicator animation during stream
- Smooth auto-scroll with "scroll to bottom" button when user scrolls up
- Same markdown/code rendering as chat portal (rehype-highlight, etc.)

---

## 2. Channels System (Simplified)

**Current:** Agents are standalone, chat is per-agent with multiple sessions/runs.
**Target:** Users create **Channels** (like Discord servers). Each channel contains multiple agents. Each agent has **one persistent chat room** — no history, no multiple sessions. All messages live in that single room.

**Rules:**
- Each agent in a channel = one chat room (auto-created when agent is added)
- **No chat history list** — all messages stored in one room per agent
- User can **clear chat** (wipe all messages) from the chat UI
- User **cannot delete the chat room** from the chat UI — only by removing the agent from the channel via the edit page
- Removing an agent from a channel deletes all its messages (cascade)

**DB Models:**
```
Channel — id, userId, name, icon, color, createdAt
ChannelAgent — channelId, agentId, role (primary/sub), messages[]
ChannelMessage — channelAgentId, role, content, tokens, cost, createdAt
```

No `ChannelChatRoom` — each `ChannelAgent` IS the room.

**API Endpoints:**
- `POST /channels` — create channel
- `GET /channels` — list user channels
- `PATCH/DELETE /channels/:id`
- `POST /channels/:id/agents` — add agent to channel
- `DELETE /channels/:id/agents/:agentId` — remove agent + all its messages
- `POST /channels/:id/agents/:agentId/chat` — send message (SSE stream, per user)
- `GET /channels/:id/agents/:agentId/messages` — get user's messages with this agent
- `DELETE /channels/:id/agents/:agentId/messages` — clear chat (wipe messages, keep room)

**Frontend Layout:**
- Left panel: list of channels (vertical icons like Discord)
- Middle panel: list of agents inside selected channel
- Right panel: active agent chat (single room, no history tabs)

---

## 3. Chat Interface Layout (Like Root Chat)

**Target:** When user clicks "AI Agents" from sidebar:
- Left: channel list (vertical icon strip)
- Middle: agents in the selected channel
- Right: selected agent's chat (single persistent room, no history)

User clicks an agent in the middle panel → right panel shows the chat.
Clear chat button in chat header wipes messages but keeps the room.
No "new conversation" button — it's always the same room per agent.

---

## 4. Back to Chat Portal Navigation

**Changes:**
- Add a "← Back to Chat" button/link in the agent page header
- Add it in the channel view as well
- Use `router.push("/")` or a Link component

---

## 5. Active/Deactive Agent + Delete Confirmation

**API Changes:**
- `PATCH /agents/:id/status` — body: `{ status: "active" | "inactive" }`
- Agent must be `inactive` before deletion (400 if trying to delete active agent)

**Frontend Changes:**
- Toggle switch on agent card (active/inactive)
- Delete button shows AlertDialog (shadcn) with confirmation: "Are you sure? This action cannot be undone."
- Disable delete button if agent is active, show tooltip "Deactivate agent first"

---

## 6. Integrations UI Overhaul

**Current:** Basic list with plain buttons.
**Target:** Rich cards per integration platform.

**Each card shows:**
- Platform logo (Jira, Notion, Plane, Slack, GitHub, Google Calendar)
- Platform name + 1-line description
- Connection status badge
- "Connect" button opens a form dialog

**Form dialog per platform:**
| Platform | Required Fields |
|----------|----------------|
| Jira | Base URL, Email, API Token, Project Key |
| Notion | Integration Token, Workspace ID |
| Plane | API Key, Workspace Slug, Project ID |
| Slack | Bot Token, Channel ID |
| GitHub | Personal Access Token, Owner, Repo |
| Google Calendar | OAuth or Service Account JSON |

**Implementation:**
- Create `IntegrationCard` component
- Create `IntegrationFormDialog` component with dynamic fields per provider
- Store encrypted credentials in `AgentIntegration.config` (JSON)

---

## 7. Knowledge Base Attachment Fix

**Problem:** Cannot attach knowledge base in agent edit page.
**Root Cause:** The Knowledge tab shows existing KBs but has no UI to attach one.

**Fix:**
- Add a "Attach Knowledge Base" button
- Show a dropdown/dialog listing user's knowledge bases (from `useKnowledgeBases()`)
- On select, call `useAttachKnowledgeBase` mutation
- Show attached KBs with remove button

---

## 8. Rename "Channels" Tab → "Deployments"

**Current:** Tab in edit agent called "Channels" (conflicts with new Channel system).
**Target:** Rename to "Deployments" (web, API, WhatsApp deployment targets).

---

## 9. Agent Chat Timeout Fix

**Possible causes:**
- LLM tool loop takes too long (MAX_TOOL_ITERATIONS=8, each with network calls)
- No SSE keep-alive heartbeat during long tool executions
- Fastify default timeout

**Fixes:**
- Add SSE heartbeat (send `: heartbeat\n\n` every 15s during execution)
- Increase Fastify route timeout for agent chat endpoint
- Add timeout handling in tool execution (already 10s per tool, but add overall 120s cap)
- Frontend: show "Agent is thinking..." with elapsed time indicator

---

## 10. Sub-Agent Management in Edit

**Current:** Sub-agents tab shows list but no way to add/remove.
**Target:**
- "Add Sub-Agent" button
- Options: create new sub-agent (inline form) or select existing agent to link
- Remove sub-agent (unlink, not delete)
- Show sub-agent cards with name, status, and "View" link

**API:** Already exists (`parentAgentId` relation). Just needs UI.

> **Obsolete since RNX-118.** The `parentAgentId` relation and agent types were replaced by agent links ("Can call"):
> `GET /agents/:id/links`, `POST /agents/:id/links` (`{ calleeAgentId }`, same workspace) and
> `DELETE /agents/:id/links/:calleeAgentId`, for the workspace owner only. The links UI is RX-122.

---

## 11. Agent Avatar Upload / Color Picker

**Options (in priority order):**
1. **S3 Upload** — Upload image, store URL in `avatar` field
2. **Default profile picture with color picker** — Generate initials-based avatar with user-selected background color

**Implementation (Option 2 — simpler, no S3 dependency):**
- Default: show agent initials on a colored circle
- Color picker: 12 preset colors, stored as `avatarColor` field
- Optional: user can still paste an emoji as override
- If S3 is configured later, add image upload button

**New field:** Add `avatarColor String? @default("#6366f1")` to Agent model.

---

## 12. Model Selection Dropdown

**Current:** Free text input for model.
**Target:** Dropdown populated from `GET /portal/models` API.

**Changes:**
- Replace `<Input>` with `<Select>` component
- Fetch models using `usePortalModels()` hook (already exists)
- Show model name + provider as option label
- Store the slug value

---

## 13. Form Descriptions (Temperature + Public)

**Add helper text:**
- **Temperature:** "Controls randomness. Lower (0.1-0.3) = focused and deterministic. Higher (0.7-1.0) = creative and varied. Default: 0.7"
- **Public Agent:** "When enabled, other users can browse and clone this agent as a template from the Explore page. Your system prompt will be visible."

---

## Implementation Order

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase 1: Quick Fixes** | #4, #5, #7, #8, #12, #13 | Small |
| **Phase 2: UI Polish** | #1, #6, #9, #10, #11 | Medium |
| **Phase 3: Channels System** | #2, #3 | Large |

Phase 3 is the biggest change — it introduces a new data model and completely restructures the agent chat experience. Phases 1 and 2 can be done incrementally.

---

## Questions for Approval

1. **Phase 3 (Channels):** Full 3-column Discord-style layout ✅
2. **Avatar (Point 11):** Color picker + initials by default. S3 upload if user adds a file ✅
3. **Integration credentials (Point 6):** Encrypted at rest with AES-256 ✅
4. **Implementation order:** Phase 1 → Phase 2 → Phase 3 ✅
