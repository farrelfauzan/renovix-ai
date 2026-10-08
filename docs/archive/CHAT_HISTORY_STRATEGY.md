# Chat History + Per-User RAG — Implementation Strategy

## Current State

### What Already Exists ✅

**Chat History:**
- **Database**: `Conversation` and `Message` models in Prisma with proper relationships
- **Backend**: `ConversationService` with `getOrCreateConversation()`, `saveMessages()`, `generateTitle()`
- **Backend**: `ConversationController` with list/get/delete endpoints (behind `ApiKeyGuard`)
- **Paid portal flow**: Already saves conversations + auto-generates titles when paid users chat

**RAG / Knowledge Base:**
- **Database**: `KnowledgeBase` (supports per-user via `userId`) and `KnowledgeChunk` (with `vector(1536)` pgvector column)
- **Backend**: Full `KnowledgeController` with CRUD, `.md` upload, chunk management, vector search (behind `ApiKeyGuard`)
- **Backend**: `KnowledgeService` — ownership checks, markdown chunking, batch embedding via Together AI (`m2-bert-80M-8k-retrieval`)
- **Backend**: `EmbeddingService` — Together AI embeddings, batch support
- **Backend**: `SystemKnowledgeService` — auto-syncs system docs from S3, hourly cron
- **Backend**: `PromptTuningService` — already searches **system KB** and injects context into prompts
- **Infrastructure**: pgvector extension, S3 storage, markdown chunker, cosine similarity search

### What's Missing ❌

**Chat History:**
- No portal conversation endpoints (existing ones require API key, not JWT)
- Frontend sends no `conversation_id` — every paid chat creates a new conversation
- No conversation list UI / sidebar
- No conversation loading/switching

**Per-User RAG:**
- **User KBs are NOT searched during chat** — only system KB is injected by `PromptTuningService`
- **No portal KB endpoints** — existing KB endpoints require API key auth, not portal JWT
- **No frontend UI** for uploading/managing knowledge bases
- **No per-conversation KB selection** — can't pick which KBs apply to a chat

---

## Implementation Plan

### Phase 1: Backend — Portal Conversation Endpoints

Add conversation endpoints to `PortalController` (authenticated via portal JWT):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/chat/portal/conversations` | List user's conversations (paginated) |
| `GET` | `/api/v1/chat/portal/conversations/:id` | Get conversation with messages |
| `DELETE` | `/api/v1/chat/portal/conversations/:id` | Delete a conversation |

**Key decisions:**
- Only **paid (logged-in) users** can access chat history — free-tier chats are ephemeral
- Reuse existing `ConversationService` methods (no duplication)
- Add a portal-level auth check (require `identity.user` exists)
- Return `conversation_id` in the SSE stream response so the frontend can track it

**Changes to portal completions endpoint:**
- After saving a conversation, emit a final SSE event: `data: {"conversation_id": "uuid"}\n\n` before `[DONE]`
- This lets the frontend know which conversation to continue

### Phase 2: Backend — Portal Knowledge Base Endpoints

Add KB management endpoints to a new section in `PortalController` (or a dedicated `PortalKnowledgeController`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/chat/portal/knowledge` | List user's knowledge bases |
| `POST` | `/api/v1/chat/portal/knowledge` | Create a new knowledge base |
| `DELETE` | `/api/v1/chat/portal/knowledge/:id` | Delete a knowledge base |
| `POST` | `/api/v1/chat/portal/knowledge/:id/upload` | Upload `.md` file to a KB |
| `GET` | `/api/v1/chat/portal/knowledge/:id/chunks` | List chunks in a KB |
| `DELETE` | `/api/v1/chat/portal/knowledge/:id/chunks/:chunkId` | Delete a chunk |

**Key decisions:**
- Reuse existing `KnowledgeService` methods — all the heavy lifting (chunking, embedding, S3 upload, vector search) already works
- Guard: require `identity.user` + `balance > 0` (paid users who have topped up)
- Rate limit uploads: 5 req/min (same as API key endpoint)
- File size limit: 10 MB (same as existing)

### Phase 3: Backend — Wire User KB into Chat Flow

**Modify `PromptTuningService.applyTuning()`** to accept an optional `userId` parameter:

```
Current flow:
  applyTuning(messages)
    → search system KB → inject system context

New flow:
  applyTuning(messages, userId?)
    → search system KB → inject system context
    → if userId: search user's active KBs → inject user context
```

**Changes:**
- `PromptTuningService`: Add `userId` param, call `KnowledgeService.searchChunks()` scoped to user's KBs
- `PortalController.handlePaidRequest()`: Pass `user.id` to `applyTuning()`
- Context injection format: separate `[System Knowledge]` and `[Your Knowledge Base]` sections in the system prompt so the AI distinguishes between them

### Phase 4: Frontend — State & API Layer

#### 4a. Update `api.ts`
- Add conversation API functions: `fetchConversations`, `fetchConversation`, `deleteConversation`
- Add KB API functions: `fetchKnowledgeBases`, `createKnowledgeBase`, `deleteKnowledgeBase`, `uploadKnowledgeBaseFile`, `fetchChunks`, `deleteChunk`
- Update `streamCompletion()` to accept and send `conversation_id` parameter
- Parse `conversation_id` from the SSE stream and pass it to a callback

#### 4b. Update `stores.ts`
- Add `conversationId: string | null` to `ChatState`
- Add `setConversationId(id)` action
- Update `clearChat()` to also reset `conversationId`
- Add `loadConversation(messages, conversationId)` action to hydrate state from history

#### 4c. Add React Query hooks
- `hooks/use-conversations.ts` — `useConversations()`, `useConversation(id)`, `useDeleteConversation()`
- `hooks/use-knowledge.ts` — `useKnowledgeBases()`, `useCreateKB()`, `useDeleteKB()`, `useUploadKBFile()`, `useKBChunks(id)`, `useDeleteChunk()`

### Phase 5: Frontend — Chat History Sidebar

#### 5a. Sidebar Component (`components/chat-sidebar.tsx`)
- Collapsible sidebar on the left side of the chat
- **Two tabs**: "Chats" and "Knowledge"
- **Chats tab**: Past conversations grouped by date (Today, Yesterday, Last 7 days, Older)
  - Each item: title (truncated), timestamp
  - Click to load, hover to reveal delete
- **Knowledge tab**: User's knowledge bases
  - List of KBs with name, chunk count, created date
  - "Add Knowledge Base" button → opens upload flow
  - Click KB to expand → see chunks, delete individual chunks
  - Delete KB button
- "New Chat" button at top
- Only visible for paid logged-in users

#### 5b. Knowledge Upload Flow (`components/kb-upload-dialog.tsx`)
- Modal/dialog triggered from sidebar Knowledge tab
- Step 1: Enter KB name + optional description
- Step 2: Drag-and-drop or file picker for `.md` files
- Step 3: Upload progress indicator (chunking + embedding takes a few seconds)
- Step 4: Success → KB appears in sidebar list
- Validation: `.md` files only, max 10 MB

#### 5c. Header Updates (`components/chat-header.tsx`)
- Add hamburger/menu button to toggle sidebar on mobile
- Add sidebar toggle button on desktop

#### 5d. Chat Flow Updates (`components/chat-input.tsx`)
- After stream completes, capture `conversation_id` from response
- Store `conversationId` in Zustand so subsequent messages continue the same conversation
- On "New Chat", reset `conversationId` to `null`

#### 5e. Chat Messages Updates (`components/chat-messages.tsx`)
- When loading a conversation from history, render the loaded messages
- Keep the same UI — no changes to message rendering

---

## Data Flow

### Chat History Flow
```
User clicks conversation in sidebar
  → fetchConversation(id) — returns ALL messages (user + assistant) in order
  → loadConversation(messages, conversationId) into Zustand
  → ChatMessages renders the full historical conversation

User continues chatting in a loaded conversation
  → User types new message → added to Zustand messages[]
  → streamCompletion(ALL messages, model, conversation_id)
     ↑ sends the FULL message array (all old messages + new one)
     ↑ this ensures the AI has complete prior context
  → Backend receives full history → AI sees entire conversation
  → Backend appends new user + assistant messages to DB
  → Frontend stores returned conversation_id (same one)
  → Sidebar list auto-refreshes (updated_at changes)

User clicks "New Chat"
  → clearChat() resets messages[] + conversationId to null
  → Next message creates a brand new conversation
```

**Context continuity guarantee:** The frontend always sends the **entire `messages[]` array** from Zustand to the backend on every request. When a conversation is loaded from history, all old messages are placed into `messages[]` first. So when the user sends a new message, the payload includes every prior message — the AI always has full context regardless of whether it's a new or continued conversation.

### Per-User RAG Flow
```
User uploads .md file via sidebar
  → POST /chat/portal/knowledge (create KB)
  → POST /chat/portal/knowledge/:id/upload (upload file)
  → Backend: parse markdown → chunk by headings → batch embed → store in DB
  → KB appears in sidebar with chunk count

User sends chat message (paid)
  → Backend: PromptTuningService.applyTuning(messages, userId)
    → Search system KB for relevant chunks (existing)
    → Search user's active KBs for relevant chunks (NEW)
    → Inject both as context in system prompt
  → AI responds with knowledge from user's documents
```

---

## Scope Boundaries

**In Scope:**
- Conversation list sidebar with date grouping (paid users only)
- Load/resume/delete conversations
- `conversation_id` tracking across messages
- Knowledge base CRUD via portal (create, list, delete)
- `.md` file upload with auto-chunking + embedding
- Chunk listing and deletion
- User KB context injection into chat prompts (alongside system KB)
- Upload dialog with drag-and-drop
- Two-tab sidebar (Chats + Knowledge)

**Out of Scope (future):**
- Conversation search/filter/rename
- Free-tier chat history or RAG
- Multiple file formats (PDF, DOCX, TXT) — only `.md` for now
- Per-conversation KB selection (toggle specific KBs on/off per chat)
- KB sharing between users
- Chunk editing/rewriting
- Custom embedding models
- Conversation export/sharing

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `apps/api/src/app/portal/portal.controller.ts` | Modify | Add conversation + KB portal endpoints, emit `conversation_id` in SSE, pass `userId` to prompt tuning |
| `apps/api/src/app/chat/prompt-tuning.service.ts` | Modify | Accept `userId`, search user KBs alongside system KB |
| `apps/chat/src/lib/api.ts` | Modify | Add conversation + KB API functions, update `streamCompletion` |
| `apps/chat/src/lib/stores.ts` | Modify | Add `conversationId` state + actions |
| `apps/chat/src/hooks/use-conversations.ts` | **New** | React Query hooks for conversation CRUD |
| `apps/chat/src/hooks/use-knowledge.ts` | **New** | React Query hooks for KB CRUD + upload |
| `apps/chat/src/components/chat-sidebar.tsx` | **New** | Two-tab sidebar (Chats + Knowledge) |
| `apps/chat/src/components/kb-upload-dialog.tsx` | **New** | Knowledge base upload modal |
| `apps/chat/src/components/chat-header.tsx` | Modify | Add sidebar toggle button |
| `apps/chat/src/components/chat-input.tsx` | Modify | Track `conversation_id` from stream response |
| `apps/chat/src/components/chat-messages.tsx` | Modify | Minor — support loading historical messages |
| `apps/chat/src/app/page.tsx` | Modify | Add sidebar to layout |

---

## Estimated Complexity

- **Backend Conversation Endpoints**: Low — wiring existing `ConversationService` to portal routes
- **Backend KB Portal Endpoints**: Low — wiring existing `KnowledgeService` to portal routes
- **Backend User KB → Chat Integration**: Low — add `userId` param to `applyTuning()`, one extra search call
- **Frontend API/State**: Low — straightforward additions
- **Frontend Sidebar + KB Upload UI**: Medium — new components, two tabs, drag-and-drop, progress states

**Total: ~12 files touched (4 new, 8 modified), no database migrations needed.**
All embedding, chunking, vector search, and S3 infrastructure already exists — this is primarily a wiring + UI effort.
