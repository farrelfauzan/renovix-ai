# feat: Chat Memory Sharing

## Summary

Adds automatic memory extraction and personalization to Renovix AI. The system learns user interests, preferences, and context from conversations and uses them to personalize future responses — making the AI feel familiar and contextually aware across sessions.

## Motivation

Users currently get generic responses regardless of how many conversations they've had. This feature enables the AI to remember key facts about the user (role, tech stack, communication preferences) and inject them as context in future chats — creating a more personalized and productive experience.

## Changes

### Backend

| Area | Files | Description |
|------|-------|-------------|
| Database | `prisma/schema.prisma`, `prisma/migrations/20260513150000_add_user_memories/` | New `user_memories` table with indexes on `[userId, status]` and `[userId, type]` |
| Memory Services | `apps/api/src/app/memory/` | `UserMemoryService` (CRUD + dedup + conflict detection), `MemoryExtractionService` (LLM-based fact extraction), `MemoryPolicyService` (security filtering) |
| Portal Endpoints | `apps/api/src/app/portal/portal.controller.ts` | 4 new endpoints: `GET /memory`, `PATCH /memory/:id`, `DELETE /memory/:id`, `POST /memory/clear` |
| Extraction Trigger | `apps/api/src/app/portal/portal.controller.ts` | Fire-and-forget extraction after conversation save in `handlePaidRequest` |
| Prompt Injection | `apps/api/src/app/chat/prompt-tuning.service.ts` | Retrieves up to 8 relevant memories and injects as `[User Memory Context]` section |
| API Docs | `apps/api/openapi.yaml` | Swagger documentation for all memory endpoints with `X-Portal-Session` header |
| Error Logging | `apps/api/src/app/providers/together.adapter.ts` | Better error body logging for Together AI 500s |

### Frontend

| Area | Files | Description |
|------|-------|-------------|
| API Layer | `apps/chat/src/lib/api.ts` | `fetchMemories`, `updateMemory`, `deleteMemory`, `clearAllMemories` |
| React Query | `apps/chat/src/hooks/use-memory.ts` | `useMemories`, `useUpdateMemory`, `useDeleteMemory`, `useClearMemories` |
| Sidebar UI | `apps/chat/src/components/chat-sidebar.tsx` | New "Memory" tab with horizontally scrollable tab bar, memory list with pin/delete/clear actions |

## Architecture

```
User sends message
        │
        ▼
  PortalController.handlePaidRequest()
        │
        ├── Stream response to user
        │
        ▼
  saveMessages() ──► .then() ──► MemoryExtractionService.extract()
                                        │
                                        ├── Check eligibility (paid user)
                                        ├── Check 5-conversation window
                                        ├── Check min 2 user messages
                                        ├── Call LLM (Llama-3.3-70B)
                                        ├── Policy filter (sensitive data, injection)
                                        ├── Deduplication check
                                        └── Store in user_memories table
                                                │
                                                ▼
                              Next chat ──► PromptTuningService.applyTuning()
                                                │
                                                └── Inject [User Memory Context]
```

## Key Design Decisions

- **Automatic extraction** — No user toggle; memories are extracted transparently for paid users
- **5-conversation window** — Only the latest 5 qualifying conversations are processed
- **Paid users only** — Must have topped up at least once
- **Fire-and-forget** — Extraction runs async, doesn't block chat responses
- **Security filtering** — Blocks API keys, emails, credit cards, JWTs, prompt injections
- **Token budget** — Max 8 items, ~400 tokens, lowest priority in context injection
- **Deduplication** — Substring matching prevents duplicate facts; conflicts are auto-archived

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/chat/portal/memory` | List all active memories |
| PATCH | `/api/v1/chat/portal/memory/:id` | Update content or pin status |
| DELETE | `/api/v1/chat/portal/memory/:id` | Delete a memory item |
| POST | `/api/v1/chat/portal/memory/clear` | Clear all memories |

All endpoints require `X-Portal-Session` header and `Authorization: Bearer <jwt>`.

## Testing

See `CHAT_MEMORY_SHARING_TEST.md` for 14 test scenarios covering:
- Extraction from explicit statements
- Memory recall in new sessions
- Irrelevant chat filtering
- Deduplication and conflict resolution
- Free-tier exclusion
- CRUD operations
- Sensitive data rejection
- Prompt injection resistance
- Cross-user isolation

## Migration

```bash
npx prisma migrate deploy
```

Creates `user_memories` table — no breaking changes to existing tables.

## Commits

- `82c6777` feat(db): add UserMemory model and migration
- `5f85837` feat(memory): add memory extraction, policy, and CRUD services
- `86a3c0a` feat(portal): add memory endpoints and extraction trigger
- `6b4303f` feat(chat): inject user memory context into system prompt
- `3b68c9c` docs(api): add Swagger documentation for memory endpoints
- `40f09f8` fix(providers): add error body logging for Together AI 500s
- `6a38409` feat(chat-fe): add memory API functions and React Query hooks
- `c226b07` feat(chat-fe): add Memory tab to sidebar with scroll support
- `b89b0a5` docs: add memory sharing strategy and test plan
- `a1edaf9` chore: minor formatting and type fixes
