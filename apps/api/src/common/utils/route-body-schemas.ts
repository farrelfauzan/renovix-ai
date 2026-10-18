/**
 * The request schemas of the routes whose controller parses a Zod DTO (RX-170). A small explicit
 * registry: the scanner cannot read which schema a `safeParse` call uses, so the mapping is by
 * route (`METHOD /path`, the controller path without the `/api/v1` prefix) and references the
 * actual exported schemas (imports, not copies). Routes without an entry have no Zod body schema;
 * the documents mark their bodies as free-form JSON and the drift test keeps the list honest
 * (an entry that matches no scanned route fails the generator, so stale entries cannot linger).
 */
import type { ZodType } from "zod";
import { z } from "zod";
import { SignInDto } from "../../app/admin-auth/dto/sign-in.dto";
import { ReauthDto } from "../../app/admin-auth/dto/reauth.dto";
import { TotpCodeDto } from "../../app/admin-auth/dto/totp-code.dto";
import { AuditLogQueryDto } from "../../app/admin-auth/dto/audit-log-query.dto";
import { AuditLogExportQueryDto } from "../../app/admin-auth/dto/audit-log-export-query.dto";
import { AgentChatSchema, AttachToolSchema, AttachIntegrationSchema, DeployChannelSchema, AttachKnowledgeBaseSchema } from "../../app/agent/dto/agent-chat.dto";
import { CreateAgentSchema } from "../../app/agent/dto/create-agent.dto";
import { UpdateAgentSchema } from "../../app/agent/dto/update-agent.dto";
import { RegisterDto, LoginDto, UpdateProfileDto } from "../../app/auth/dto/create-auth.dto";
import { ChatCompletionRequestSchema } from "../../app/chat/dto/chat-completion.dto";
import { RedeemCodeDto } from "../../app/codes/dto/redeem-code.dto";
import { ExportRequestSchema } from "../../app/document/dto/export-request.dto";
import { CreateKnowledgeBaseSchema, UpdateKnowledgeBaseSchema, AddChunksSchema, SearchChunksSchema } from "../../app/knowledge/dto/knowledge.dto";
import { CreateWorkspaceSchema } from "../../app/workspace/dto/create-workspace.dto";
import { UpdateWorkspaceSchema } from "../../app/workspace/dto/update-workspace.dto";
import { InviteMemberSchema } from "../../app/workspace/dto/invite-member.dto";
import { UpdateMemberSchema } from "../../app/workspace/dto/update-member.dto";
import { AcceptInviteSchema } from "../../app/workspace/dto/accept-invite.dto";

// The schemas below live inside controller files (not in a dto/ folder): imported here, not copied.
import { CreateChannelSchema, UpdateChannelSchema, AddAgentSchema, ChatMessageSchema } from "../../app/channel/controller/channel.controller";
import { CreateReminderSchema, UpdateReminderSchema } from "../../app/reminder/controller/reminder.controller";

/** The portal completion body: the chat completion schema with the model optional (portal.controller.ts). */
const PORTAL_COMPLETION_SCHEMA: ZodType = ChatCompletionRequestSchema.extend({
  model: ChatCompletionRequestSchema.shape.model.optional(),
});

/** `METHOD /controller-path[/handler-path]` → the Zod schema its controller parses the request body with. */
export const ROUTE_BODY_SCHEMAS: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  // ─── back office (/admin) ───
  ["POST /admin/auth/sign-in", SignInDto],
  ["POST /admin/auth/totp/confirm", TotpCodeDto],
  ["POST /admin/auth/reauth", ReauthDto],
  // ─── chat and agents ───
  ["POST /chat/completions", ChatCompletionRequestSchema],
  ["POST /agents", CreateAgentSchema],
  ["PATCH /agents/:id", UpdateAgentSchema],
  ["POST /agents/generate-prompt", z.object({ name: z.string().min(1), description: z.string().optional() })],
  ["PATCH /agents/:id/status", z.object({ status: z.enum(["active", "draft", "archived"]) })],
  ["POST /agents/:id/tools", AttachToolSchema],
  ["POST /agents/:id/integrations", AttachIntegrationSchema],
  ["POST /agents/:id/knowledge-bases", AttachKnowledgeBaseSchema],
  ["POST /agents/:id/channels", DeployChannelSchema],
  ["PATCH /agents/:id/channels/:channelId", z.record(z.string(), z.unknown())],
  ["POST /agents/:id/chat", AgentChatSchema],
  // ─── channels and their workspaces ───
  ["POST /channels", CreateChannelSchema],
  ["PATCH /channels/:id", UpdateChannelSchema],
  ["POST /channels/:id/agents", AddAgentSchema],
  ["POST /channels/:id/agents/:agentId/chat", ChatMessageSchema],
  ["PATCH /channels/:channelId/workspace/members/:memberId", UpdateMemberSchema],
  ["POST /channels/:channelId/workspace/invites", InviteMemberSchema],
  // ─── workspaces ───
  ["POST /workspaces", CreateWorkspaceSchema],
  ["PATCH /workspaces/:id", UpdateWorkspaceSchema],
  ["PATCH /workspaces/:id/members/:memberId", UpdateMemberSchema],
  ["POST /workspaces/:id/invites", InviteMemberSchema],
  ["POST /workspace-invites/accept", AcceptInviteSchema],
  // ─── portal ───
  ["POST /chat/portal/completions", PORTAL_COMPLETION_SCHEMA],
  // ─── the rest of the product API ───
  ["POST /auth/register", RegisterDto],
  ["POST /auth/login", LoginDto],
  ["PATCH /auth/me", UpdateProfileDto],
  ["POST /codes/redeem", RedeemCodeDto],
  ["POST /export", ExportRequestSchema],
  ["POST /v1/knowledge/bases", CreateKnowledgeBaseSchema],
  ["PUT /v1/knowledge/bases/:id", UpdateKnowledgeBaseSchema],
  ["POST /v1/knowledge/bases/:id/chunks", AddChunksSchema],
  ["POST /v1/knowledge/search", SearchChunksSchema],
  ["POST /reminders", CreateReminderSchema],
  ["PATCH /reminders/:id", UpdateReminderSchema],
  // The workspace-channel knowledge routes write with plain-object bodies (no Zod schema there).
]);

/** The query schemas of the routes whose controller parses a Zod DTO from the query string. */
export const ROUTE_QUERY_SCHEMAS: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ["GET /admin/audit-log", AuditLogQueryDto],
  ["GET /admin/audit-log/export", AuditLogExportQueryDto],
]);
