/**
 * The request schemas of the routes whose controller parses a Zod DTO (RX-170). A small explicit
 * registry: the scanner cannot read which schema a `safeParse` call uses, so the mapping is by
 * route (`METHOD /path`, the controller path without the `/api/v1` prefix) and references the
 * actual exported schemas (imports, not copies). Routes without an entry have no Zod body schema;
 * the documents mark their bodies as free-form JSON and the drift test keeps the list honest
 * (an entry that matches no scanned route fails the generator, so stale entries cannot linger).
 */
import type { ZodType } from "zod";
import { SignInDto } from "../../app/admin-auth/dto/sign-in.dto";
import { ReauthDto } from "../../app/admin-auth/dto/reauth.dto";
import { ChangePasswordDto } from "../../app/admin-auth/dto/change-password.dto";
import { CreateInvitationDto } from "../../app/admin-auth/dto/create-invitation.dto";
import { AssignRoleDto } from "../../app/admin-auth/dto/assign-role.dto";
import { CreateRoleDto } from "../../app/admin-auth/dto/create-role.dto";
import { UpdateRoleDto } from "../../app/admin-auth/dto/update-role.dto";
import { InvitationTokenDto } from "../../app/admin-auth/dto/invitation-token.dto";
import { AcceptInvitationDto } from "../../app/admin-auth/dto/accept-invitation.dto";
import { TotpCodeDto } from "../../app/admin-auth/dto/totp-code.dto";
import { AuditLogQueryDto } from "../../app/admin-auth/dto/audit-log-query.dto";
import { AuditLogExportQueryDto } from "../../app/admin-auth/dto/audit-log-export-query.dto";
import { CreditAdjustmentDto } from "../../app/admin-credits/dto/credit-adjustment.dto";
import { EmailRevealBodyDto } from "../../app/admin-usage/dto/email-reveal-body.dto";
import { ReconciliationEntryBodyDto } from "../../app/admin-usage/dto/reconciliation-entry-body.dto";
import { CreateProviderDto } from "../../app/admin-providers/dto/create-provider.dto";
import { UpdateProviderDto } from "../../app/admin-providers/dto/update-provider.dto";
import { TestProviderDto } from "../../app/admin-providers/dto/test-provider.dto";
import { CreateProviderModelDto } from "../../app/admin-providers/dto/create-provider-model.dto";
import { UpdateProviderModelDto } from "../../app/admin-providers/dto/update-provider-model.dto";
import { PackageVersionBodyDto } from "../../app/admin-catalog/dto/package-version-body.dto";
import { UpdatePackageBodyDto } from "../../app/admin-catalog/dto/update-package-body.dto";
import { TopUpPackVersionBodyDto } from "../../app/admin-catalog/dto/top-up-pack-version-body.dto";
import { EnterpriseBundleVersionBodyDto } from "../../app/admin-catalog/dto/enterprise-bundle-version-body.dto";
import { UpdateActiveBodyDto } from "../../app/admin-catalog/dto/update-active-body.dto";
import { DeactivateCodeBodyDto } from "../../app/admin-catalog/dto/deactivate-code-body.dto";
import { ListCodesQueryDto } from "../../app/admin-catalog/dto/list-codes-query.dto";
import { SaveSettingBodyDto } from "../../app/admin-catalog/dto/save-setting-body.dto";
import { AgentChatSchema, AttachToolSchema, AttachIntegrationSchema, DeployChannelSchema, AttachKnowledgeBaseSchema } from "../../app/agent/dto/agent-chat.dto";
import { CreateAgentSchema } from "../../app/agent/dto/create-agent.dto";
import { CloneAgentSchema } from "../../app/agent/dto/clone-agent.dto";
import { UpdateAgentSchema } from "../../app/agent/dto/update-agent.dto";
import { CreateAgentLinkSchema } from "../../app/agent/dto/create-agent-link.dto";
import { GeneratePromptSchema } from "../../app/agent/dto/generate-prompt.dto";
import { UpdateAgentStatusSchema } from "../../app/agent/dto/update-agent-status.dto";
import { UpdateAgentChannelSchema } from "../../app/agent/dto/update-agent-channel.dto";
import { CreateCheckoutSchema } from "../../app/billing/dto/create-checkout.dto";
import { ConnectMcpTokenSchema } from "../../app/mcp/dto/connect-mcp-token.dto";
import { WebSearchKeySchema } from "../../app/mcp/dto/web-search-key.dto";
import { UpdateWebSearchPolicySchema } from "../../app/mcp/dto/update-web-search-policy.dto";
import { PortalCompletionSchema } from "../../app/portal/dto/portal-completion.dto";
import { CreatePortalKnowledgeBaseSchema } from "../../app/portal/dto/create-portal-knowledge-base.dto";
import { CreateWorkspaceKnowledgeBaseSchema } from "../../app/workspace/dto/create-workspace-knowledge-base.dto";
import { AddWorkspaceChunksSchema } from "../../app/workspace/dto/add-workspace-chunks.dto";
import { SearchWorkspaceKnowledgeSchema } from "../../app/workspace/dto/search-workspace-knowledge.dto";
import { UpdateProfileDto } from "../../app/auth/dto/create-auth.dto";
import { CreateApiKeyDto } from "../../app/auth/dto/create-api-key.dto";
import { ApiChatCompletionRequestSchema } from "../../app/chat/dto/chat-completion.dto";
import { CreateCodeDto, RedeemCodeDto } from "../../app/codes/dto/redeem-code.dto";
import { ExportRequestSchema } from "../../app/document/dto/export-request.dto";
import { CreateKnowledgeBaseSchema, UpdateKnowledgeBaseSchema, AddChunksSchema, SearchChunksSchema } from "../../app/knowledge/dto/knowledge.dto";
import { CreateWorkspaceSchema } from "../../app/workspace/dto/create-workspace.dto";
import { UpdateWorkspaceSchema } from "../../app/workspace/dto/update-workspace.dto";
import { InviteMemberSchema } from "../../app/workspace/dto/invite-member.dto";
import { UpdateMemberSchema } from "../../app/workspace/dto/update-member.dto";
import { AcceptInviteSchema } from "../../app/workspace/dto/accept-invite.dto";

import { CreateChannelSchema, UpdateChannelSchema, AddAgentSchema, ChatMessageSchema } from "../../app/channel/dto/channel.dto";
import { CreateReminderSchema, UpdateReminderSchema } from "../../app/reminder/dto/reminder.dto";
import { CheckoutBodyDto } from "../../app/payments/dto/checkout-body.dto";
import { ConfirmOrderBodyDto } from "../../app/payments/dto/confirm-order-body.dto";
import { MarkRefundedBodyDto } from "../../app/payments/dto/mark-refunded-body.dto";
import { OrdersListQueryDto } from "../../app/payments/dto/orders-list-query.dto";
import { OrdersDayQueryDto } from "../../app/payments/dto/orders-day-query.dto";

/** `METHOD /controller-path[/handler-path]` → the Zod schema its controller parses the request body with. */
export const ROUTE_BODY_SCHEMAS: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  // ─── back office (/admin) ───
  ["POST /admin/auth/sign-in", SignInDto],
  ["POST /admin/auth/totp/confirm", TotpCodeDto],
  ["POST /admin/auth/reauth", ReauthDto],
  ["POST /admin/auth/password", ChangePasswordDto],
  ["POST /admin/invitations", CreateInvitationDto],
  ["POST /admin/invitations/preview", InvitationTokenDto],
  ["POST /admin/invitations/accept", AcceptInvitationDto],
  ["PUT /admin/admins/:id/role", AssignRoleDto],
  ["POST /admin/roles", CreateRoleDto],
  ["PATCH /admin/roles/:name", UpdateRoleDto],
  ["POST /admin/providers", CreateProviderDto],
  ["PATCH /admin/providers/:id", UpdateProviderDto],
  ["POST /admin/providers/:id/test", TestProviderDto],
  ["POST /admin/providers/:providerId/models", CreateProviderModelDto],
  ["PATCH /admin/providers/:providerId/models/:modelId", UpdateProviderModelDto],
  ["POST /admin/credits/adjustments", CreditAdjustmentDto],
  ["PATCH /admin/packages/:id", UpdatePackageBodyDto],
  ["POST /admin/packages/:id/versions", PackageVersionBodyDto],
  ["PATCH /admin/top-up-packs/:id", UpdateActiveBodyDto],
  ["POST /admin/top-up-packs/:id/versions", TopUpPackVersionBodyDto],
  ["PATCH /admin/enterprise-bundles/:id", UpdateActiveBodyDto],
  ["POST /admin/enterprise-bundles/:id/versions", EnterpriseBundleVersionBodyDto],
  ["POST /admin/codes", CreateCodeDto],
  ["PATCH /admin/codes/:id", DeactivateCodeBodyDto],
  ["PUT /admin/settings/:name", SaveSettingBodyDto],
  ["POST /admin/usage/users/:userId/email", EmailRevealBodyDto],
  ["POST /admin/reconciliation/entries", ReconciliationEntryBodyDto],
  ["POST /admin/payments/orders/:id/confirm", ConfirmOrderBodyDto],
  ["POST /admin/payments/unmatched/:id/refunded", MarkRefundedBodyDto],
  // ─── chat and agents ───
  ["POST /chat/completions", ApiChatCompletionRequestSchema],
  ["POST /agents", CreateAgentSchema],
  ["POST /agents/clone/:templateId", CloneAgentSchema],
  ["PATCH /agents/:id", UpdateAgentSchema],
  ["POST /agents/generate-prompt", GeneratePromptSchema],
  ["PATCH /agents/:id/status", UpdateAgentStatusSchema],
  ["POST /agents/:id/tools", AttachToolSchema],
  ["POST /agents/:id/integrations", AttachIntegrationSchema],
  ["POST /agents/:id/knowledge-bases", AttachKnowledgeBaseSchema],
  ["POST /agents/:id/channels", DeployChannelSchema],
  ["PATCH /agents/:id/channels/:channelId", UpdateAgentChannelSchema],
  ["POST /agents/:id/chat", AgentChatSchema],
  ["POST /agents/:id/links", CreateAgentLinkSchema],
  // ─── channels and their workspaces ───
  ["POST /channels", CreateChannelSchema],
  ["PATCH /channels/:id", UpdateChannelSchema],
  ["POST /channels/:id/agents", AddAgentSchema],
  ["POST /channels/:id/agents/:agentId/chat", ChatMessageSchema],
  ["PATCH /channels/:channelId/workspace/members/:memberId", UpdateMemberSchema],
  ["POST /channels/:channelId/workspace/invites", InviteMemberSchema],
  ["POST /channels/:channelId/workspace/knowledge", CreateWorkspaceKnowledgeBaseSchema],
  ["POST /channels/:channelId/workspace/knowledge/:kbId/chunks", AddWorkspaceChunksSchema],
  ["POST /channels/:channelId/workspace/knowledge/search", SearchWorkspaceKnowledgeSchema],
  // ─── workspaces ───
  ["POST /workspaces", CreateWorkspaceSchema],
  ["PATCH /workspaces/:id", UpdateWorkspaceSchema],
  ["PATCH /workspaces/:id/members/:memberId", UpdateMemberSchema],
  ["POST /workspaces/:id/invites", InviteMemberSchema],
  ["POST /workspace-invites/accept", AcceptInviteSchema],
  // ─── portal ───
  ["POST /chat/portal/completions", PortalCompletionSchema],
  ["POST /chat/portal/knowledge", CreatePortalKnowledgeBaseSchema],
  // ─── the rest of the product API ───
  ["POST /auth/keys", CreateApiKeyDto],
  ["PATCH /auth/me", UpdateProfileDto],
  ["POST /codes/redeem", RedeemCodeDto],
  ["POST /export", ExportRequestSchema],
  ["POST /v1/knowledge/bases", CreateKnowledgeBaseSchema],
  ["PUT /v1/knowledge/bases/:id", UpdateKnowledgeBaseSchema],
  ["POST /v1/knowledge/bases/:id/chunks", AddChunksSchema],
  ["POST /v1/knowledge/search", SearchChunksSchema],
  ["POST /reminders", CreateReminderSchema],
  ["PATCH /reminders/:id", UpdateReminderSchema],
  ["POST /billing/checkout", CreateCheckoutSchema],
  ["POST /payments/checkout", CheckoutBodyDto],
  ["POST /mcp/user/connect", ConnectMcpTokenSchema],
  ["PUT /integrations/web-search/brave/key", WebSearchKeySchema],
  ["PUT /integrations/web-search/policy", UpdateWebSearchPolicySchema],
  ["PUT /integrations/web-search/providers/:provider/key", WebSearchKeySchema],
]);

/** The query schemas of the routes whose controller parses a Zod DTO from the query string. */
export const ROUTE_QUERY_SCHEMAS: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ["GET /admin/audit-log", AuditLogQueryDto],
  ["GET /admin/audit-log/export", AuditLogExportQueryDto],
  ["GET /admin/codes", ListCodesQueryDto],
  ["GET /admin/payments/orders", OrdersListQueryDto],
  ["GET /admin/payments/orders/export", OrdersDayQueryDto],
]);
