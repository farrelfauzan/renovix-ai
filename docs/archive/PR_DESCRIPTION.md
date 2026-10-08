# PR Description

## Summary
This PR extends the AI Agents platform with MCP (Model Context Protocol) tools integration, an improved agent builder UI, landing page redesign, token usage tracking, channel chat memory/usage enhancements, and strategy documentation for guardrails and notifications.

## What Changed

### 1. Landing Page Redesign
- Revamped hero section with updated messaging and layout
- Added new sections: agent showcase, comparison, AI models, pricing, testimonials, use cases, CTA
- Updated navbar, footer, and services section styling
- Updated next.config.js and layout metadata

### 2. MCP Tools Integration
- Added full MCP module (client, registry, OAuth, controllers) in API
- MCP server management API with CRUD and connect/disconnect lifecycle
- OAuth credential management for workspace integrations (Google, etc.)
- Refactored `agent-tool.service` to dynamically load MCP tool schemas
- Added `@modelcontextprotocol/sdk` dependency
- Frontend: MCP connect dialog, integrations panel, `use-mcp` hook, MCP types
- Updated integrations tab with MCP server management UI
- Added workspace integrations settings panel
- New env vars: `MCP_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `CHAT_APP_URL`
- Database: `mcp_servers`, `agent_mcp_servers`, `workspace_oauth_credentials` tables

### 3. Agent Builder & Service Improvements
- Enhanced `agent-memory.service` with workspace memory context injection
- Improved `agent-run.service` with extended tool iterations and memory policy
- Added new agent management endpoints
- Multi-step agent builder wizard UI (identity → instructions → tools → review)
- Refactored agent listing page with improved actions
- Simplified new-agent-page with builder wizard flow
- Added agent settings panel and workspace settings components
- Added sonner toast notifications

### 4. Channel Chat Enhancements
- Workspace memory context injection in channel chat
- Memory policy instruction for persistent task recall
- MCP tool schema integration in channel chat tool building
- Usage tracking (token counting) per channel chat response
- Increased `MAX_TOOL_ITERATIONS` from 6 to 30
- Refactored portal controller to simplify session management

### 5. Database Schema Updates
- Added `tokensUsed` (BigInt) field to `AgentSubscription`
- Added `McpServer` model for MCP server configuration
- Added `AgentMcpServer` junction model
- Added `WorkspaceOAuthCredential` model
- Migration: `20260524100000_add_tokens_used_to_subscriptions`

### 6. Misc Fixes & Improvements
- Fixed xlsx converter for better spreadsheet handling
- Updated together.adapter with improved model routing
- Updated chat-sidebar navigation and styling
- Fixed kb-upload-dialog interaction issues
- Improved server-team-sidebar workspace display
- Added API public URL config to chat lib

### 7. Strategy Documentation
- Added `AGENT_GUARDRAILS_STRATEGY.md` for agent safety constraints
- Added `AGENT_NOTIFICATION_REMINDER_STRATEGY.md` for scheduled notifications
## Commit Breakdown
1. `feat(landing): redesign landing page with new sections`
2. `feat(mcp): add MCP tools integration with OAuth support`
3. `feat(agent): improve agent builder UI and backend services`
4. `feat(channel): integrate memory, MCP tools, and usage tracking in channel chat`
5. `feat(db): add token usage tracking and MCP schema models`
6. `fix(api,chat): misc improvements and bug fixes`
7. `docs: add agent guardrails and notification/reminder strategies`

## Migration / Deployment Notes
1. Run Prisma migrations before deploying (`20260522143721_add_mcp_servers`, `20260523092916_add_workspace_oauth_credentials`, `20260524100000_add_tokens_used_to_subscriptions`).
2. Set new environment variables: `MCP_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `CHAT_APP_URL`.
3. Install new dependency: `@modelcontextprotocol/sdk`.
3. Run or include `seed-agents.ts` where agent bootstrap data is required.

## Testing Notes
- This PR is large and spans schema, API, and frontend surfaces.
- Recommended verification before merge:
  1. API smoke test for agent CRUD and agent-run chat endpoints.
  2. Channel creation + chat room/message flow checks.
  3. Frontend navigation through agents list, create, detail, and chat pages.
  4. Tool-calling regression test on Together-backed models.

## Risk Notes
- High change breadth across persistence, backend services, and UI means integration regressions are possible if migrations or seeds are skipped.
- Channel webhook/integration paths should be validated in an environment with real credentials/webhook callbacks.
