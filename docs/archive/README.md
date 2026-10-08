# Archived docs

Strategy and plan docs for work that is finished in the code, plus one-off artefacts. Kept for history; the code is the source of truth. Archived in RX-7. Paths below are relative to `apps/api/src/app/` unless stated.

| Doc | Covered | Why archived | Implementation |
|-----|---------|--------------|----------------|
| `PR_DESCRIPTION.md` | PR text for MCP tools, agent builder UI, landing redesign | One-off PR text | n/a |
| `PR_MEMORY_SHARE.md` | PR text for chat memory sharing | One-off PR text | n/a |
| `MIGRATION_STRATEGY.md` | Better Auth + SSO, invitation codes, subscription plan table, Stripe feature flag | Done. The three `/admin/codes` rows are marked removed (D33, RX-66; admin role is RX-37) | `../../apps/api/src/lib/auth.ts`, `codes/`, `billing/billing.controller.ts` (`STRIPE_ENABLED`), models `InvitationCode`, `CodeRedemption`, `SubscriptionPlan` |
| `OPENROUTER_MIGRATION_STRATEGY.md` | Plan to move from Together AI to OpenRouter | Done | `providers/openrouter.adapter.ts`, `providers/provider-router.ts` |
| `OPENROUTER_MIGRATION_GUIDE.md` | Deployment guide for that migration | Done; GCP production is retired | same as above |
| `CHAT_HISTORY_STRATEGY.md` | Conversation history, per-user RAG | Done | `chat/conversation.service.ts`, models `Conversation`, `Message` |
| `CHAT_MEMORY_SHARING_STRATEGY.md` | Memory extraction and injection across chats | Done (test plan `../CHAT_MEMORY_SHARING_TEST.md` stays in `docs/`) | `memory/`, model `UserMemory`, `apps/chat/src/app/memory` |
| `DOCUMENT_EXPORT_STRATEGY.md` | PDF, DOCX, XLSX generation from chat | Done | `document/` (converters), `chat/chat.service.ts` (`outputFormat`) |
| `MCP_TOOLS_STRATEGY.md` | MCP tool integration for agents | Done | `mcp/` |
| `MCP_PER_USER_STRATEGY.md` | Per-user MCP credentials | Done | `mcp/mcp-user.service.ts`, model `UserMcpCredential` |
| `AGENT_GUARDRAILS_STRATEGY.md` | Input/output guardrails for agent channels | Done (test plan `../GUARDRAILS_TEST.md` stays) | `guardrail/`, models `GuardrailViolation`, `GuardrailConfig` |
| `AGENT_NOTIFICATION_REMINDER_STRATEGY.md` | Scheduled agent reminders | Done | `reminder/`, model `Reminder` |
| `WORKSPACE_STRATEGY.md` | Workspaces, members, invites, shared memory | Done | `workspace/`, models `Workspace*`, `apps/chat/src/lib/workspace-store.ts` |
| `WORKSPACE_FRONTEND_STRATEGY.md` | Workspace inside a channel (server), frontend | Done | `workspace/`, `channel/`, `apps/chat/src/app/workspace-invites` |
| `WEB_SEARCH_API_KEY_HANDOFF_STRATEGY.md` | Per-user Brave Search key for the web search tool | Done | `mcp/web-search.service.ts`, `mcp/web-search.controller.ts` |
| `AI_AGENT_PORTAL_STRATEGY.md` | Agent portal in the chat app | Done | `agent/`, `channel/`, `apps/chat/src/app/agents` |
| `CHAT_PORTAL_STRATEGY.md` | Public chat portal | Done | `portal/`, `apps/chat` |

These docs still mention Together AI and the old GCP setup; that is history, not the current state (see `AGENTS.md`).
