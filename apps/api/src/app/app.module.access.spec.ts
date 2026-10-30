import { Controller, Delete, ExecutionContext, ForbiddenException, Get, Module, Patch, Post, Put, RequestMethod, Type, UnauthorizedException } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import {
  MetadataScanner,
  ModulesContainer,
  NestFactory,
  Reflector,
} from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { Access } from "../common/decorators/access.decorator";
import { AccessGuard } from "../common/guards/access.guard";
import { ApiKeyGuard } from "../common/guards/api-key.guard";
import { CombinedAuthGuard } from "../common/guards/combined-auth.guard";
import { UserOriginGuard } from "../common/guards/user-origin.guard";
import { AccessOptions } from "../common/types/access-options";
import { STAFF_PERMISSIONS } from "./admin-auth/config/staff-permissions";
import { AdminAudit } from "./admin-auth/decorator/admin-audit.decorator";
import type { AdminAuditOptions } from "./admin-auth/types/admin-audit-options";
import type { AdminSessionService } from "./admin-auth/service/admin-session.service";
import type { ApiKeyRateLimitService } from "./auth/service/api-key-rate-limit.service";
import type { ApiKeyService } from "./auth/service/api-key.service";
import type { PortalGuard } from "./portal/guard/portal.guard";

// RX-114 coverage: the route table of the real AppModule, as Nest's own
// scanner sees it (preview mode: every module reachable from AppModule is
// scanned, dynamic modules included, and nothing is instantiated, so no
// database or secret is needed). marked is ESM-only (the app imports it
// through the document converters).
jest.mock("marked", () => ({}));
// AppModule is required, not imported: an import would put every file of the
// app into the spec type program (tsconfig.spec.json), which then reports the
// app's own type errors a second time; `tsc -p tsconfig.app.json` reports them.
const { AppModule }: { AppModule: Type<unknown> } = require("./app.module");

type Route = {
  readonly label: string;
  /** The route's path without the global prefix, e.g. "/admin/auth/sessions/:id". */
  readonly path: string;
  readonly method: string;
  readonly access: AccessOptions | undefined;
  /** The RX-97 audit declaration (`@AdminAudit`), on the handler or its controller. */
  readonly audit: AdminAuditOptions | undefined;
  readonly usesGuards: boolean;
  /** The handler and its controller, for an ExecutionContext of the route (RNX-225). */
  readonly handler: () => unknown;
  readonly controller: object;
};

const hasGuards = (target: object): boolean =>
  (Reflect.getMetadata(GUARDS_METADATA, target) ?? []).length > 0;

function listRoutes(modules: ModulesContainer): Route[] {
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const routes: Route[] = [];
  for (const moduleRef of modules.values()) {
    for (const { metatype } of moduleRef.controllers.values()) {
      const controller = metatype as new (...args: never[]) => object;
      for (const name of scanner.getAllMethodNames(controller.prototype)) {
        const handler: () => unknown = controller.prototype[name];
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const path = [controller, handler]
          .map((target): string => Reflect.getMetadata(PATH_METADATA, target))
          .filter((part) => part !== "/")
          .join("/");
        routes.push({
          label: `${RequestMethod[method]} /${path} (${controller.name}.${name})`,
          path: `/${path}`.replace(/\/{2,}/g, "/"),
          method: RequestMethod[method],
          access: reflector.getAllAndOverride(Access, [handler, controller]),
          audit: reflector.getAllAndOverride(AdminAudit, [handler, controller]),
          usesGuards: hasGuards(controller) || hasGuards(handler),
          handler,
          controller,
        });
      }
    }
  }
  return routes;
}

/** The routes of a module, as the preview scanner sees them (nothing is instantiated). */
async function scanRoutes(module: Type<unknown>): Promise<Route[]> {
  const context = await NestFactory.createApplicationContext(module, { preview: true, logger: false });
  const found = listRoutes(context.get(ModulesContainer));
  await context.close();
  return found;
}

// RX-97 (D57): a back-office route that changes state either writes the audit row (`@AdminAudit` with a
// resource and an action) or is exempt with a reason. GET (and HEAD, OPTIONS) routes only read.
const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE", "ALL"];
const isAdminRoute = (route: Route) => /^\/admin(\/|$)/.test(route.path);
const changesState = (route: Route) => isAdminRoute(route) && STATE_CHANGING.includes(route.method);
const isHooked = (route: Route) => route.audit !== undefined && !route.audit.exempt && Boolean(route.audit.resource.trim() && route.audit.action.trim());
const isExempt = (route: Route) => route.audit?.exempt === true && Boolean(route.audit.reason.trim());
/** The state-changing /admin routes that neither write the audit row nor are exempt with a reason. */
const unaudited = (found: Route[]) => found.filter((route) => changesState(route) && !isHooked(route) && !isExempt(route));

describe("RX-114: every route of AppModule declares its access", () => {
  let routes: Route[];

  beforeAll(async () => {
    const context = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
    });
    routes = listRoutes(context.get(ModulesContainer));
    await context.close();
    process.stdout.write(`RX-114 coverage: ${routes.length} routes looked at\n`);
  });

  const labels = (found: Route[]) => found.map((route) => route.label).sort();

  it("looks at the real route table (it is not empty)", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every route has @Access, on the handler or on its controller", () => {
    expect(labels(routes.filter((route) => !route.access))).toEqual([]);
  });

  it("every public route gives a reason", () => {
    const withoutReason = routes.filter(
      ({ access }) => access?.public && !(typeof access.reason === "string" && access.reason.trim()),
    );

    expect(labels(withoutReason)).toEqual([]);
  });

  // Any @UseGuards fails: access is declared with @Access and checked by the
  // one global AccessGuard, so no controller needs a guard of its own.
  it("no controller or route uses @UseGuards", () => {
    expect(labels(routes.filter((route) => route.usesGuards))).toEqual([]);
  });

  // The decided declaration of every route (RX-114 inventory; 12 public routes per D112, plus the
  // back-office sign-in and refresh of RX-94).
  // A route that changes kind, or a new route, must be added here on purpose.
  const PUBLIC_ROUTES = [
    "ALL /auth/better/* (BetterAuthController.handleAuth)",
    "GET / (AppController.getData)",
    "GET /health (HealthController.check)",
    "GET /mcp/user/oauth/callback (McpUserController.oauthCallback)",
    "GET /models (ModelsController.listModels)",
    "GET /prices (PricesController.listPrices)",
    "GET /webhooks/stripe (WebhookController.healthCheck)",
    "GET /workspace-invites/accept (WorkspaceInviteController.resolveInvite)",
    "POST /admin/auth/refresh (AdminAuthController.refresh)",
    "POST /admin/auth/sign-in (AdminAuthController.signIn)",
    "POST /admin/invitations/accept (AdminInvitationsController.accept)",
    "POST /admin/invitations/preview (AdminInvitationsController.preview)",
    "POST /webhooks/gowa (GowaWebhookController.handleInbound)",
    "POST /webhooks/payments (PaymentWebhookController.receive)",
    "POST /webhooks/stripe (WebhookController.handleStripeWebhook)",
  ];
  const API_KEY_ROUTES = [
    "DELETE /conversations/:id (ConversationController.delete)",
    "DELETE /v1/knowledge/bases/:id (KnowledgeController.deleteKnowledgeBase)",
    "DELETE /v1/knowledge/bases/:id/chunks/:chunkId (KnowledgeController.deleteChunk)",
    "GET /conversations (ConversationController.list)",
    "GET /conversations/:id (ConversationController.get)",
    "GET /v1/knowledge/bases (KnowledgeController.listKnowledgeBases)",
    "GET /v1/knowledge/bases/:id (KnowledgeController.getKnowledgeBase)",
    "GET /v1/knowledge/bases/:id/chunks (KnowledgeController.listChunks)",
    "POST /chat/completions (ChatController.createCompletion)",
    "POST /export (DocumentController.exportDocument)",
    "POST /v1/knowledge/bases (KnowledgeController.createKnowledgeBase)",
    "POST /v1/knowledge/bases/:id/chunks (KnowledgeController.addChunks)",
    "POST /v1/knowledge/bases/:id/upload (KnowledgeController.uploadMarkdown)",
    "POST /v1/knowledge/search (KnowledgeController.searchChunks)",
    "PUT /v1/knowledge/bases/:id (KnowledgeController.updateKnowledgeBase)",
  ];
  const PORTAL_ROUTES = [
    "DELETE /chat/portal/conversations/:id (PortalController.deleteConversation)",
    "DELETE /chat/portal/knowledge/:id (PortalController.deleteKnowledgeBase)",
    "DELETE /chat/portal/knowledge/:id/chunks/:chunkId (PortalController.deleteChunk)",
    "GET /chat/portal/conversations (PortalController.listConversations)",
    "GET /chat/portal/conversations/:id (PortalController.getConversation)",
    "GET /chat/portal/knowledge (PortalController.listKnowledgeBases)",
    "GET /chat/portal/knowledge/:id/chunks (PortalController.listChunks)",
    "GET /chat/portal/models (PortalController.getModels)",
    "GET /chat/portal/usage (PortalController.getUsage)",
    "POST /chat/portal/completions (PortalController.createCompletion)",
    "POST /chat/portal/knowledge (PortalController.createKnowledgeBase)",
    "POST /chat/portal/knowledge/:id/upload (PortalController.uploadToKnowledgeBase)",
    "POST /chat/portal/link-session (PortalController.linkSession)",
  ];
  // Back-office routes (RX-94): `staff` only, full sessions unless a scope is declared.
  const STAFF_ROUTES = [
    "DELETE /admin/auth/sessions/:id (AdminAuthController.revokeSession)",
    "DELETE /admin/invitations/:id (AdminInvitationsController.revoke)",
    "DELETE /admin/providers/:id (AdminProvidersController.remove)",
    "DELETE /admin/roles/:name (AdminRolesController.delete)",
    "GET /admin/admins (AdminAdminsController.list)",
    "GET /admin/audit-log (AdminAuditLogController.list)",
    "GET /admin/audit-log/export (AdminAuditLogController.export)",
    "GET /admin/auth/sessions (AdminAuthController.listSessions)",
    "GET /admin/codes (AdminCodesController.list)",
    "GET /admin/codes/:id/redemptions (AdminCodesController.listRedemptions)",
    "GET /admin/enterprise-bundles (AdminEnterpriseBundlesController.list)",
    "GET /admin/enterprise-bundles/:id (AdminEnterpriseBundlesController.get)",
    "GET /admin/packages (AdminPackagesController.list)",
    "GET /admin/packages/:id (AdminPackagesController.get)",
    "GET /admin/payments/orders (AdminPaymentsController.listOrders)",
    "GET /admin/payments/orders/export (AdminPaymentsController.exportOrders)",
    "GET /admin/providers (AdminProvidersController.list)",
    "GET /admin/providers/:id (AdminProvidersController.get)",
    "GET /admin/providers/:providerId/models (AdminProviderModelsController.list)",
    "GET /admin/reconciliation (AdminReconciliationController.report)",
    "GET /admin/roles (AdminRolesController.list)",
    "GET /admin/settings (AdminSettingsController.list)",
    "GET /admin/top-up-packs (AdminTopUpPacksController.list)",
    "GET /admin/top-up-packs/:id (AdminTopUpPacksController.get)",
    "GET /admin/usage/daily (AdminUsageController.daily)",
    "GET /admin/usage/profit (AdminUsageController.profit)",
    "PATCH /admin/codes/:id (AdminCodesController.deactivate)",
    "PATCH /admin/enterprise-bundles/:id (AdminEnterpriseBundlesController.update)",
    "PATCH /admin/packages/:id (AdminPackagesController.update)",
    "PATCH /admin/providers/:id (AdminProvidersController.update)",
    "PATCH /admin/providers/:providerId/models/:modelId (AdminProviderModelsController.update)",
    "PATCH /admin/roles/:name (AdminRolesController.update)",
    "PATCH /admin/top-up-packs/:id (AdminTopUpPacksController.update)",
    "POST /admin/admins/:id/force-password-reset (AdminAdminsController.forcePasswordReset)",
    "POST /admin/admins/:id/reactivate (AdminAdminsController.reactivate)",
    "POST /admin/admins/:id/reset-mfa (AdminAdminsController.resetMfa)",
    "POST /admin/admins/:id/suspend (AdminAdminsController.suspend)",
    "POST /admin/auth/reauth (AdminAuthController.reauth)",
    "POST /admin/codes (AdminCodesController.create)",
    "POST /admin/credits/adjustments (AdminCreditsController.adjust)",
    "POST /admin/enterprise-bundles/:id/versions (AdminEnterpriseBundlesController.createVersion)",
    "POST /admin/invitations (AdminInvitationsController.create)",
    "POST /admin/invitations/:id/resend (AdminInvitationsController.resend)",
    "POST /admin/packages/:id/versions (AdminPackagesController.createVersion)",
    "POST /admin/payments/orders/:id/confirm (AdminPaymentsController.confirmFromProvider)",
    "POST /admin/payments/unmatched/:id/refunded (AdminPaymentsController.markRefunded)",
    "POST /admin/providers (AdminProvidersController.create)",
    "POST /admin/providers/:id/activate (AdminProvidersController.activate)",
    "POST /admin/providers/:id/test (AdminProvidersController.test)",
    "POST /admin/providers/:providerId/models (AdminProviderModelsController.create)",
    "POST /admin/reconciliation/entries (AdminReconciliationController.record)",
    "POST /admin/roles (AdminRolesController.create)",
    "POST /admin/top-up-packs/:id/versions (AdminTopUpPacksController.createVersion)",
    "POST /admin/usage/users/:userId/email (AdminUsageController.revealEmail)",
    "PUT /admin/admins/:id/role (AdminAdminsController.assignRole)",
    "PUT /admin/settings/:name (AdminSettingsController.save)",
  ];
  const STAFF_ENROLMENT_ROUTES = [
    "POST /admin/auth/totp/confirm (AdminAuthController.confirm)",
    "POST /admin/auth/totp/enrol (AdminAuthController.enrol)",
  ];
  const STAFF_ANY_SCOPE_ROUTES = [
    "GET /admin/auth/me (AdminAuthController.me)",
    "POST /admin/auth/sign-out (AdminAuthController.signOut)",
  ];
  // RX-95: the only route a "password_change" session (forced password reset) reaches, besides the any-scope ones.
  const STAFF_PASSWORD_CHANGE_ROUTES = ["POST /admin/auth/password (AdminAuthController.changePassword)"];
  // Back-office routes that declare staff permissions (RX-96), with the permissions each declares. RX-94's
  // routes are self-service (an admin manages their own session) and need none. RX-164 (D113 item 53,
  // D138): the audit log and its CSV export need `audit:read` only (not `exports:create`).
  const STAFF_PERMISSION_ROUTES: Record<string, string[]> = {
    "GET /admin/audit-log (AdminAuditLogController.list)": ["audit:read"],
    "GET /admin/audit-log/export (AdminAuditLogController.export)": ["audit:read"],
    // RX-95: the admin list needs admins:read; invitations, suspension and resets need admins:write (Owner only).
    "DELETE /admin/invitations/:id (AdminInvitationsController.revoke)": ["admins:write"],
    "GET /admin/admins (AdminAdminsController.list)": ["admins:read"],
    "POST /admin/admins/:id/force-password-reset (AdminAdminsController.forcePasswordReset)": ["admins:write"],
    "POST /admin/admins/:id/reactivate (AdminAdminsController.reactivate)": ["admins:write"],
    "POST /admin/admins/:id/reset-mfa (AdminAdminsController.resetMfa)": ["admins:write"],
    "POST /admin/admins/:id/suspend (AdminAdminsController.suspend)": ["admins:write"],
    "POST /admin/invitations (AdminInvitationsController.create)": ["admins:write"],
    "POST /admin/invitations/:id/resend (AdminInvitationsController.resend)": ["admins:write"],
    // RX-177: provider records (providers:*) and their models (models:*).
    "DELETE /admin/providers/:id (AdminProvidersController.remove)": ["providers:write"],
    "GET /admin/providers (AdminProvidersController.list)": ["providers:read"],
    "GET /admin/providers/:id (AdminProvidersController.get)": ["providers:read"],
    "GET /admin/providers/:providerId/models (AdminProviderModelsController.list)": ["models:read"],
    "PATCH /admin/providers/:id (AdminProvidersController.update)": ["providers:write"],
    "PATCH /admin/providers/:providerId/models/:modelId (AdminProviderModelsController.update)": ["models:write"],
    "POST /admin/providers (AdminProvidersController.create)": ["providers:write"],
    "POST /admin/providers/:id/activate (AdminProvidersController.activate)": ["providers:write"],
    "POST /admin/providers/:id/test (AdminProvidersController.test)": ["providers:write"],
    "POST /admin/providers/:providerId/models (AdminProviderModelsController.create)": ["models:write"],
    // RNX-187: the role list needs roles:read; custom roles and role assignment need roles:write (Owner only).
    "DELETE /admin/roles/:name (AdminRolesController.delete)": ["roles:write"],
    "GET /admin/roles (AdminRolesController.list)": ["roles:read"],
    "PATCH /admin/roles/:name (AdminRolesController.update)": ["roles:write"],
    "POST /admin/roles (AdminRolesController.create)": ["roles:write"],
    "PUT /admin/admins/:id/role (AdminAdminsController.assignRole)": ["roles:write"],
    // RNX-227: a credit adjustment needs credits:adjust.
    "POST /admin/credits/adjustments (AdminCreditsController.adjust)": ["credits:adjust"],
    // RNX-35: the payments day list and its CSV need credits:read; confirm from provider and mark refunded need credits:adjust.
    "GET /admin/payments/orders (AdminPaymentsController.listOrders)": ["credits:read"],
    "GET /admin/payments/orders/export (AdminPaymentsController.exportOrders)": ["credits:read"],
    "POST /admin/payments/orders/:id/confirm (AdminPaymentsController.confirmFromProvider)": ["credits:adjust"],
    "POST /admin/payments/unmatched/:id/refunded (AdminPaymentsController.markRefunded)": ["credits:adjust"],
    // RNX-226: packages, top-up packs and Enterprise bundles need packages:*; invitation codes (no code permission in
    // RX-96: a code grants credits or a plan) need packages:write, the reads too (a code's text is a redeemable secret);
    // platform settings need settings:*.
    "GET /admin/codes (AdminCodesController.list)": ["packages:write"],
    "POST /admin/codes (AdminCodesController.create)": ["packages:write"],
    "PATCH /admin/codes/:id (AdminCodesController.deactivate)": ["packages:write"],
    "GET /admin/codes/:id/redemptions (AdminCodesController.listRedemptions)": ["packages:write"],
    "GET /admin/enterprise-bundles (AdminEnterpriseBundlesController.list)": ["packages:read"],
    "GET /admin/enterprise-bundles/:id (AdminEnterpriseBundlesController.get)": ["packages:read"],
    "PATCH /admin/enterprise-bundles/:id (AdminEnterpriseBundlesController.update)": ["packages:write"],
    "POST /admin/enterprise-bundles/:id/versions (AdminEnterpriseBundlesController.createVersion)": ["packages:write"],
    "GET /admin/packages (AdminPackagesController.list)": ["packages:read"],
    "GET /admin/packages/:id (AdminPackagesController.get)": ["packages:read"],
    "PATCH /admin/packages/:id (AdminPackagesController.update)": ["packages:write"],
    "POST /admin/packages/:id/versions (AdminPackagesController.createVersion)": ["packages:write"],
    "GET /admin/settings (AdminSettingsController.list)": ["settings:read"],
    "PUT /admin/settings/:name (AdminSettingsController.save)": ["settings:write"],
    "GET /admin/top-up-packs (AdminTopUpPacksController.list)": ["packages:read"],
    "GET /admin/top-up-packs/:id (AdminTopUpPacksController.get)": ["packages:read"],
    "PATCH /admin/top-up-packs/:id (AdminTopUpPacksController.update)": ["packages:write"],
    "POST /admin/top-up-packs/:id/versions (AdminTopUpPacksController.createVersion)": ["packages:write"],
    // RNX-228: token counts need usage:read; cost, revenue, profit, margin and the reconciliation report need
    // profit:read; a portal balance entry needs reconciliation:write; an email reveal needs users:read_pii too.
    "GET /admin/usage/daily (AdminUsageController.daily)": ["usage:read"],
    "GET /admin/usage/profit (AdminUsageController.profit)": ["profit:read"],
    "POST /admin/usage/users/:userId/email (AdminUsageController.revealEmail)": ["usage:read", "users:read_pii"],
    "GET /admin/reconciliation (AdminReconciliationController.report)": ["profit:read"],
    "POST /admin/reconciliation/entries (AdminReconciliationController.record)": ["reconciliation:write"],
  };
  // RNX-225 (D113): every route that accepted the login JWT or the session now accepts the session only (the
  // login JWT is retired as an access method). This is the full list of the routes whose @Access changed, plus
  // RNX-35's two buyer payment routes, which took the session only from the start.
  const SESSION_ROUTES = [
    "DELETE /agents/:id (AgentController.delete)",
    "DELETE /agents/:id/channels/:channelId (AgentController.removeChannel)",
    "DELETE /agents/:id/integrations/:integrationId (AgentController.removeIntegration)",
    "DELETE /agents/:id/knowledge-bases/:kbId (AgentController.removeKnowledgeBase)",
    "DELETE /agents/:id/links/:calleeAgentId (AgentLinkController.removeLink)",
    "DELETE /agents/:id/runs/:runId (AgentRunController.deleteRun)",
    "DELETE /agents/:id/tools/:toolId (AgentController.removeTool)",
    "DELETE /auth/keys/:id (ApiKeyController.revoke)",
    "DELETE /channels/:channelId/workspace/knowledge/:kbId (WorkspaceChannelController.deleteKnowledgeBase)",
    "DELETE /channels/:channelId/workspace/knowledge/:kbId/chunks/:chunkId (WorkspaceChannelController.deleteChunk)",
    "DELETE /channels/:channelId/workspace/members/:memberId (WorkspaceChannelController.removeMember)",
    "DELETE /channels/:id (ChannelController.delete)",
    "DELETE /channels/:id/agents/:agentId (ChannelController.removeAgent)",
    "DELETE /channels/:id/agents/:agentId/messages (ChannelController.clearMessages)",
    "DELETE /integrations/web-search/brave/key (WebSearchController.deleteBraveKey)",
    "DELETE /mcp/servers/:id (McpController.deleteServer)",
    "DELETE /mcp/user/credentials/:provider (McpUserController.disconnect)",
    "DELETE /reminders/:id (ReminderController.delete)",
    "DELETE /workspaces/:id (WorkspaceController.archive)",
    "DELETE /workspaces/:id/members/:memberId (WorkspaceController.removeMember)",
    "GET /agents (AgentController.list)",
    "GET /agents/:id (AgentController.findById)",
    "GET /agents/:id/links (AgentLinkController.listLinks)",
    "GET /agents/:id/runs (AgentRunController.listRuns)",
    "GET /agents/:id/runs/:runId (AgentRunController.getRun)",
    "GET /agents/public (AgentController.listPublic)",
    "GET /agents/subscription (AgentController.getSubscription)",
    "GET /agents/tools/available (AgentController.getAvailableTools)",
    "GET /auth/keys (ApiKeyController.list)",
    "GET /auth/me (AuthController.getProfile)",
    "GET /channels (ChannelController.list)",
    "GET /channels/:channelId/workspace (WorkspaceChannelController.getWorkspace)",
    "GET /channels/:channelId/workspace/invites (WorkspaceChannelController.listInvites)",
    "GET /channels/:channelId/workspace/knowledge (WorkspaceChannelController.listKnowledgeBases)",
    "GET /channels/:channelId/workspace/knowledge/:kbId/chunks (WorkspaceChannelController.listChunks)",
    "GET /channels/:channelId/workspace/members (WorkspaceChannelController.listMembers)",
    "GET /channels/:channelId/workspace/quota (WorkspaceChannelController.getQuota)",
    "GET /channels/:id (ChannelController.findById)",
    "GET /channels/:id/agents/:agentId/messages (ChannelController.getMessages)",
    "GET /codes/history (CodesController.getHistory)",
    "GET /entitlements/me (EntitlementsController.getMine)",
    "GET /integrations/web-search/policy (WebSearchController.getPolicy)",
    "GET /integrations/web-search/status (WebSearchController.getStatus)",
    "GET /mcp/registry (McpController.getRegistry)",
    "GET /mcp/servers (McpController.listServers)",
    "GET /mcp/user/credentials (McpUserController.listCredentials)",
    "GET /mcp/user/oauth/start (McpUserController.startOAuth)",
    "GET /payments/orders/:id (PaymentsController.getOrder)",
    "GET /reminders (ReminderController.list)",
    "GET /reminders/:id (ReminderController.findById)",
    "GET /usage (UsageController.getUsage)",
    "GET /workspaces (WorkspaceController.list)",
    "GET /workspaces/:id (WorkspaceController.getById)",
    "GET /workspaces/:id/invites (WorkspaceController.listInvites)",
    "GET /workspaces/:id/members (WorkspaceController.listMembers)",
    "GET /workspaces/:id/quota (WorkspaceController.getQuota)",
    "PATCH /agents/:id (AgentController.update)",
    "PATCH /agents/:id/channels/:channelId (AgentController.updateChannel)",
    "PATCH /agents/:id/status (AgentController.updateStatus)",
    "PATCH /auth/me (AuthController.updateProfile)",
    "PATCH /channels/:channelId/workspace/members/:memberId (WorkspaceChannelController.updateMember)",
    "PATCH /channels/:id (ChannelController.update)",
    "PATCH /reminders/:id (ReminderController.update)",
    "PATCH /workspaces/:id (WorkspaceController.update)",
    "PATCH /workspaces/:id/members/:memberId (WorkspaceController.updateMember)",
    "POST /agents (AgentController.create)",
    "POST /agents/:id/channels (AgentController.deployChannel)",
    "POST /agents/:id/chat (AgentRunController.chat)",
    "POST /agents/:id/integrations (AgentController.attachIntegration)",
    "POST /agents/:id/knowledge-bases (AgentController.attachKnowledgeBase)",
    "POST /agents/:id/links (AgentLinkController.addLink)",
    "POST /agents/:id/publish (AgentController.publish)",
    "POST /agents/:id/tools (AgentController.attachTool)",
    "POST /agents/clone/:templateId (AgentController.cloneFromTemplate)",
    "POST /agents/generate-prompt (AgentController.generatePrompt)",
    "POST /auth/keys (ApiKeyController.create)",
    "POST /auth/keys/regenerate (ApiKeyController.regenerate)",
    "POST /billing/checkout (BillingController.createCheckout)",
    "POST /channels (ChannelController.create)",
    "POST /channels/:channelId/workspace (WorkspaceChannelController.createWorkspace)",
    "POST /channels/:channelId/workspace/invites (WorkspaceChannelController.createInvite)",
    "POST /channels/:channelId/workspace/invites/:inviteId/resend (WorkspaceChannelController.resendInvite)",
    "POST /channels/:channelId/workspace/invites/:inviteId/revoke (WorkspaceChannelController.revokeInvite)",
    "POST /channels/:channelId/workspace/knowledge (WorkspaceChannelController.createKnowledgeBase)",
    "POST /channels/:channelId/workspace/knowledge/:kbId/chunks (WorkspaceChannelController.addChunks)",
    "POST /channels/:channelId/workspace/knowledge/search (WorkspaceChannelController.searchKnowledge)",
    "POST /channels/:id/agents (ChannelController.addAgent)",
    "POST /channels/:id/agents/:agentId/chat (ChannelController.chat)",
    "POST /channels/:id/icon (ChannelController.uploadIcon)",
    "POST /channels/upload-icon (ChannelController.uploadIconStandalone)",
    "POST /codes/redeem (CodesController.redeemCode)",
    "POST /mcp/servers/:id/test (McpController.testConnection)",
    "POST /mcp/user/connect (McpUserController.connectWithToken)",
    "POST /payments/checkout (PaymentsController.startCheckout)",
    "POST /reminders (ReminderController.create)",
    "POST /workspace-invites/accept (WorkspaceInviteController.acceptInvite)",
    "POST /workspaces (WorkspaceController.create)",
    "POST /workspaces/:id/invites (WorkspaceController.createInvite)",
    "POST /workspaces/:id/invites/:inviteId/resend (WorkspaceController.resendInvite)",
    "POST /workspaces/:id/invites/:inviteId/revoke (WorkspaceController.revokeInvite)",
    "PUT /integrations/web-search/brave/key (WebSearchController.upsertBraveKey)",
    "PUT /integrations/web-search/policy (WebSearchController.updatePolicy)",
    "PUT /integrations/web-search/providers/:provider/key (WebSearchController.upsertProviderKey)",
  ];
  const declares = (route: Route, methods: string[]) =>
    !route.access?.public && JSON.stringify(route.access?.auth) === JSON.stringify(methods);
  const declaresStaff = (route: Route, staffScope: string | undefined) =>
    declares(route, ["staff"]) && !route.access?.public && route.access?.staffScope === staffScope;

  it("each route declares the methods decided for it; there is no other route", () => {
    expect(labels(routes.filter((route) => route.access?.public))).toEqual(PUBLIC_ROUTES);
    expect(labels(routes.filter((route) => declares(route, ["session"])))).toEqual(SESSION_ROUTES);
    expect(labels(routes.filter((route) => declares(route, ["apiKey"])))).toEqual(API_KEY_ROUTES);
    expect(labels(routes.filter((route) => declares(route, ["portal"])))).toEqual(PORTAL_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, undefined)))).toEqual(STAFF_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, "enrolment")))).toEqual(STAFF_ENROLMENT_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, "any")))).toEqual(STAFF_ANY_SCOPE_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, "password_change")))).toEqual(STAFF_PASSWORD_CHANGE_ROUTES);
    // No route lists staff next to another method, and none outside the four lists above.
    expect(labels(routes.filter((route) => !route.access?.public && route.access?.auth?.includes("staff")))).toEqual(
      [...STAFF_ROUTES, ...STAFF_ENROLMENT_ROUTES, ...STAFF_ANY_SCOPE_ROUTES, ...STAFF_PASSWORD_CHANGE_ROUTES].sort(),
    );
    const known = [
      ...PUBLIC_ROUTES,
      ...SESSION_ROUTES,
      ...API_KEY_ROUTES,
      ...PORTAL_ROUTES,
      ...STAFF_ROUTES,
      ...STAFF_ENROLMENT_ROUTES,
      ...STAFF_ANY_SCOPE_ROUTES,
      ...STAFF_PASSWORD_CHANGE_ROUTES,
    ];
    const others = routes.filter((route) => !known.includes(route.label));
    expect(labels(others)).toEqual([]);
  });

  // RNX-225 AC1: a login JWT (signed with JWT_SECRET, as POST /auth/login issued them) sent to every former
  // jwt/session route gets 401: the real AccessGuard with the route's own declaration, as the global guard runs
  // it before the handler. No session (setup-env.ts: getSession answers null) and no API key lookup (the token
  // is not an API key, so the key check refuses it before any lookup).
  describe("RNX-225 AC1: a login JWT is no credential on any former jwt/session route", () => {
    const refusingKeys = { authenticate: () => Promise.reject(new Error("no API key lookup expected")) };
    const guard = new AccessGuard(
      new Reflector(),
      new CombinedAuthGuard(),
      new ApiKeyGuard(refusingKeys as unknown as ApiKeyService),
      {} as PortalGuard,
      {} as AdminSessionService,
      {} as ApiKeyRateLimitService,
    );
    const loginJwt = jwt.sign({ userId: "00000000-0000-4000-8000-000000000001", email: "user@renovix.test" }, process.env.JWT_SECRET!);

    it("the table is the session route list (every listed route is in the app)", () => {
      expect(labels(routes.filter((route) => SESSION_ROUTES.includes(route.label)))).toEqual(SESSION_ROUTES);
    });

    it.each(SESSION_ROUTES)("%s: 401, nothing attached", async (label) => {
      const route = routes.find((found) => found.label === label);
      const request: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: `Bearer ${loginJwt}` } };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => route?.handler,
        getClass: () => route?.controller,
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });
  });

  // RNX-118: the agent link routes are product routes (session, RNX-225); the owner-only rule is in AgentLinkService.
  const AGENT_LINK_ROUTES = [
    "DELETE /agents/:id/links/:calleeAgentId (AgentLinkController.removeLink)",
    "GET /agents/:id/links (AgentLinkController.listLinks)",
    "POST /agents/:id/links (AgentLinkController.addLink)",
  ];

  it("RNX-118: the agent link routes exist and declare session", () => {
    expect(labels(routes.filter((route) => route.path.startsWith("/agents/:id/links")))).toEqual(AGENT_LINK_ROUTES);
    expect(labels(routes.filter((route) => AGENT_LINK_ROUTES.includes(route.label) && declares(route, ["session"])))).toEqual(
      AGENT_LINK_ROUTES,
    );
  });

  // RNX-18: the API key routes are the signed-in user's (session, RNX-225); an API key cannot manage keys.
  const API_KEY_MANAGEMENT_ROUTES = [
    "DELETE /auth/keys/:id (ApiKeyController.revoke)",
    "GET /auth/keys (ApiKeyController.list)",
    "POST /auth/keys (ApiKeyController.create)",
    "POST /auth/keys/regenerate (ApiKeyController.regenerate)",
  ];

  it("RNX-18: the API key routes exist and declare session", () => {
    expect(labels(routes.filter((route) => route.path.startsWith("/auth/keys")))).toEqual(API_KEY_MANAGEMENT_ROUTES);
    expect(
      labels(routes.filter((route) => API_KEY_MANAGEMENT_ROUTES.includes(route.label) && declares(route, ["session"]))),
    ).toEqual(API_KEY_MANAGEMENT_ROUTES);
  });

  // RX-96 criterion 4: the back office is /admin, and /admin is the back office.
  const isAdminPath = (route: Route) => /^\/admin(\/|$)/.test(route.path);
  const listsStaff = (route: Route) => !route.access?.public && route.access?.auth?.includes("staff") === true;

  it("every non-public /admin route lists staff (and only staff); every staff route is under /admin", () => {
    const adminRoutes = routes.filter(isAdminPath);

    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(labels(adminRoutes.filter((route) => !route.access?.public && !declares(route, ["staff"])))).toEqual([]);
    expect(labels(routes.filter((route) => listsStaff(route) && !isAdminPath(route)))).toEqual([]);
  });

  it("staff routes declare only staff permissions; the routes that declare any are pinned", () => {
    const staffRoutes = routes.filter(listsStaff);
    const declared = staffRoutes.flatMap((route) => (route.access?.public ? [] : route.access?.permissions ?? []));

    expect(declared.filter((permission) => !(STAFF_PERMISSIONS as readonly string[]).includes(permission))).toEqual([]);
    const declaring = staffRoutes.filter((route) => !route.access?.public && route.access?.permissions?.length);
    expect(Object.fromEntries(declaring.map((route) => [route.label, route.access?.public ? [] : route.access?.permissions]))).toEqual(
      STAFF_PERMISSION_ROUTES,
    );
  });

  // RX-95 (D219): the sensitive actions that need a re-authentication within REAUTH_WINDOW_MINUTES.
  // RNX-187: editing a role and every role assignment as well. Inviting an Owner (POST /admin/invitations with
  // role "owner") also needs one; its controller checks that, since `reauth` cannot depend on the body. RNX-214:
  // resending an Owner invitation (POST /admin/invitations/:id/resend) too, checked in its controller the same way.
  // RNX-227: a credit adjustment.
  // D250 (RNX-226): every price change (a new package, pack or bundle version) and every invitation code write.
  // RNX-35: the two payment writes, confirm from provider and mark unmatched as refunded.
  const REAUTH_ROUTES = [
    "PATCH /admin/codes/:id (AdminCodesController.deactivate)",
    "PATCH /admin/roles/:name (AdminRolesController.update)",
    "POST /admin/admins/:id/force-password-reset (AdminAdminsController.forcePasswordReset)",
    "POST /admin/admins/:id/reset-mfa (AdminAdminsController.resetMfa)",
    "POST /admin/admins/:id/suspend (AdminAdminsController.suspend)",
    "POST /admin/codes (AdminCodesController.create)",
    "POST /admin/credits/adjustments (AdminCreditsController.adjust)",
    "POST /admin/enterprise-bundles/:id/versions (AdminEnterpriseBundlesController.createVersion)",
    "POST /admin/packages/:id/versions (AdminPackagesController.createVersion)",
    "POST /admin/payments/orders/:id/confirm (AdminPaymentsController.confirmFromProvider)",
    "POST /admin/payments/unmatched/:id/refunded (AdminPaymentsController.markRefunded)",
    "POST /admin/top-up-packs/:id/versions (AdminTopUpPacksController.createVersion)",
    "PUT /admin/admins/:id/role (AdminAdminsController.assignRole)",
  ];

  it("RX-95: the routes that declare reauth are pinned", () => {
    expect(labels(routes.filter((route) => !route.access?.public && route.access?.reauth === true))).toEqual(REAUTH_ROUTES);
  });

  // RX-97 criterion 3: every state-changing /admin route is hooked or exempt; the lists below are the PR's.
  const AUDITED_ROUTES = [
    "DELETE /admin/auth/sessions/:id (AdminAuthController.revokeSession)",
    "DELETE /admin/invitations/:id (AdminInvitationsController.revoke)",
    "DELETE /admin/providers/:id (AdminProvidersController.remove)",
    "DELETE /admin/roles/:name (AdminRolesController.delete)",
    "PATCH /admin/codes/:id (AdminCodesController.deactivate)",
    "PATCH /admin/enterprise-bundles/:id (AdminEnterpriseBundlesController.update)",
    "PATCH /admin/packages/:id (AdminPackagesController.update)",
    "PATCH /admin/providers/:id (AdminProvidersController.update)",
    "PATCH /admin/providers/:providerId/models/:modelId (AdminProviderModelsController.update)",
    "PATCH /admin/roles/:name (AdminRolesController.update)",
    "PATCH /admin/top-up-packs/:id (AdminTopUpPacksController.update)",
    "POST /admin/admins/:id/force-password-reset (AdminAdminsController.forcePasswordReset)",
    "POST /admin/admins/:id/reactivate (AdminAdminsController.reactivate)",
    "POST /admin/admins/:id/reset-mfa (AdminAdminsController.resetMfa)",
    "POST /admin/admins/:id/suspend (AdminAdminsController.suspend)",
    "POST /admin/auth/password (AdminAuthController.changePassword)",
    "POST /admin/auth/reauth (AdminAuthController.reauth)",
    "POST /admin/auth/sign-out (AdminAuthController.signOut)",
    "POST /admin/auth/totp/confirm (AdminAuthController.confirm)",
    "POST /admin/auth/totp/enrol (AdminAuthController.enrol)",
    "POST /admin/codes (AdminCodesController.create)",
    "POST /admin/credits/adjustments (AdminCreditsController.adjust)",
    "POST /admin/enterprise-bundles/:id/versions (AdminEnterpriseBundlesController.createVersion)",
    "POST /admin/invitations (AdminInvitationsController.create)",
    "POST /admin/invitations/:id/resend (AdminInvitationsController.resend)",
    "POST /admin/packages/:id/versions (AdminPackagesController.createVersion)",
    "POST /admin/payments/unmatched/:id/refunded (AdminPaymentsController.markRefunded)",
    "POST /admin/providers (AdminProvidersController.create)",
    "POST /admin/providers/:id/activate (AdminProvidersController.activate)",
    "POST /admin/providers/:providerId/models (AdminProviderModelsController.create)",
    "POST /admin/reconciliation/entries (AdminReconciliationController.record)",
    "POST /admin/roles (AdminRolesController.create)",
    "POST /admin/top-up-packs/:id/versions (AdminTopUpPacksController.createVersion)",
    "POST /admin/usage/users/:userId/email (AdminUsageController.revealEmail)",
    "PUT /admin/admins/:id/role (AdminAdminsController.assignRole)",
    "PUT /admin/settings/:name (AdminSettingsController.save)",
  ];
  const AUDIT_EXEMPT_ROUTES = [
    "POST /admin/auth/refresh (AdminAuthController.refresh)",
    "POST /admin/auth/sign-in (AdminAuthController.signIn)",
    // RX-95: the invitation link's holder has no account yet; accept writes the new admin's audit row itself.
    "POST /admin/invitations/accept (AdminInvitationsController.accept)",
    "POST /admin/invitations/preview (AdminInvitationsController.preview)",
    // RNX-35: confirm from provider calls the payment provider outside a transaction; the handler writes its own audit row.
    "POST /admin/payments/orders/:id/confirm (AdminPaymentsController.confirmFromProvider)",
    // RX-177: the provider call must run outside a transaction; the handler writes its own audit row in a
    // short transaction after the call (admin-providers.controller.spec.ts checks the row).
    "POST /admin/providers/:id/test (AdminProvidersController.test)",
  ];

  it("RX-97: every state-changing /admin route writes the audit row or is exempt with a reason", () => {
    expect(routes.filter(changesState).length).toBeGreaterThan(0);
    expect(labels(unaudited(routes))).toEqual([]);
  });

  it("RX-97: the audited and the exempt /admin routes are pinned", () => {
    expect(labels(routes.filter((route) => changesState(route) && isHooked(route)))).toEqual(AUDITED_ROUTES);
    expect(labels(routes.filter((route) => changesState(route) && isExempt(route)))).toEqual(AUDIT_EXEMPT_ROUTES);
  });

  // RX-164 (PRD 09 F16): a read is not audited by default, but an export is. The CSV export is a GET that
  // writes its own audit row through the same hook, so it is pinned here: dropping its `@AdminAudit` fails.
  const AUDITED_READ_ROUTES = [
    "GET /admin/audit-log/export (AdminAuditLogController.export)",
    "GET /admin/payments/orders/export (AdminPaymentsController.exportOrders)",
  ];

  it("RX-164: the /admin reads that write an audit row (exports) are pinned", () => {
    expect(labels(routes.filter((route) => isAdminRoute(route) && !changesState(route) && route.audit !== undefined))).toEqual(
      AUDITED_READ_ROUTES,
    );
    expect(labels(routes.filter((route) => AUDITED_READ_ROUTES.includes(route.label) && isHooked(route)))).toEqual(AUDITED_READ_ROUTES);
  });

  // RNX-272: UserOriginGuard refuses a cross-origin write to a cookie-authenticated user route. Covered: every POST,
  // PUT, PATCH and DELETE of a route whose @Access lists `session` or `portal`, derived from the declarations, so a
  // new route is classified as soon as it declares its access. Every other route is exempt, for the first reason
  // below that matches it. The real guard runs on each route's own declaration (allowed list: one chat origin).
  describe("RNX-272: which routes the user Origin check covers, and why the others are exempt", () => {
    const CHAT_ORIGIN = "https://chat.example.test";
    const EVIL_ORIGIN = "https://evil.example.test";
    const UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
    const listsCookieMethod = (route: Route) =>
      !route.access?.public && (route.access?.auth ?? []).some((method) => method === "session" || method === "portal");
    const isCovered = (route: Route) => listsCookieMethod(route) && UNSAFE_METHODS.includes(route.method);
    const ORIGIN_EXEMPT: readonly { readonly reason: string; readonly matches: (route: Route) => boolean }[] = [
      {
        reason: "public: no cookie identity is used (webhooks check their own signature, Better Auth its own requests)",
        matches: (route) => route.access?.public === true,
      },
      {
        reason: "staff (/admin): AdminOriginGuard checks the back-office origin (RX-156)",
        matches: (route) => !route.access?.public && route.access?.auth?.includes("staff") === true,
      },
      {
        reason: "apiKey: the key is an Authorization header, which a foreign page cannot send without a CORS preflight",
        matches: (route) => declares(route, ["apiKey"]),
      },
      {
        reason: "a read (GET, HEAD, OPTIONS) of a session or portal route changes nothing",
        matches: (route) => listsCookieMethod(route) && !UNSAFE_METHODS.includes(route.method),
      },
    ];
    /** True when the guard, with this allowed list, refuses a request of the route's method with these headers. */
    const isRefused = (route: Route, headers: Record<string, string>, allowedOrigins: string[] | true = [CHAT_ORIGIN]): boolean => {
      const request = { method: route.method === "ALL" ? "POST" : route.method, headers };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => route.handler,
        getClass: () => route.controller,
      } as unknown as ExecutionContext;
      try {
        return !new UserOriginGuard(new Reflector(), allowedOrigins).canActivate(context);
      } catch (err) {
        if (err instanceof ForbiddenException) return true;
        throw err;
      }
    };

    it("AC5: covers exactly the session and portal writes, refused with a foreign Origin or with no header", () => {
      const covered = labels(routes.filter(isCovered));

      expect(covered.length).toBeGreaterThan(0);
      expect(covered).toEqual([...SESSION_ROUTES, ...PORTAL_ROUTES].filter((label) => UNSAFE_METHODS.includes(label.split(" ")[0])).sort());
      expect(labels(routes.filter((route) => isRefused(route, { origin: EVIL_ORIGIN })))).toEqual(covered);
      expect(labels(routes.filter((route) => isRefused(route, {})))).toEqual(covered);
      expect(labels(routes.filter((route) => isRefused(route, { origin: CHAT_ORIGIN })))).toEqual([]);
    });

    it("AC5: every other route is exempt for one of the stated reasons", () => {
      expect(labels(routes.filter((route) => !isCovered(route) && !ORIGIN_EXEMPT.some((group) => group.matches(route))))).toEqual([]);
    });

    it.each(ORIGIN_EXEMPT.map((group) => [group.reason, group] as const))(
      "AC5: exempt, %s: no route of the group is refused, with a foreign Origin or with no header",
      (_reason, group) => {
        const exempt = routes.filter((route) => !isCovered(route) && group.matches(route));

        expect(exempt.length).toBeGreaterThan(0);
        expect(labels(exempt.filter((route) => isRefused(route, { origin: EVIL_ORIGIN }) || isRefused(route, {})))).toEqual([]);
      },
    );

    it.each([
      "POST /webhooks/gowa (GowaWebhookController.handleInbound)",
      "POST /webhooks/payments (PaymentWebhookController.receive)",
      "POST /v1/knowledge/bases (KnowledgeController.createKnowledgeBase)",
      "POST /v1/knowledge/bases/:id/upload (KnowledgeController.uploadMarkdown)",
      "GET /channels (ChannelController.list)",
    ])("AC4: %s is not refused, without Origin or with a foreign Origin", (label) => {
      const route = routes.find((found) => found.label === label);

      expect(route).toBeDefined();
      expect(isRefused(route as Route, {})).toBe(false);
      expect(isRefused(route as Route, { origin: EVIL_ORIGIN })).toBe(false);
    });

    it("CORS_ORIGIN unset (the list is `true`): no route is refused, until RNX-70", () => {
      expect(labels(routes.filter((route) => isRefused(route, { origin: EVIL_ORIGIN }, true) || isRefused(route, {}, true)))).toEqual([]);
    });
  });
});

describe("RX-97: the audit coverage check catches a new /admin write without the hook (probe)", () => {
  @Controller("admin/audit-probe")
  class AuditProbeController {
    @Post("unaudited")
    unaudited() {
      return null;
    }

    @Put("hooked")
    @AdminAudit({ resource: "probe", action: "put" })
    hooked() {
      return null;
    }

    @Patch("exempt")
    @AdminAudit({ exempt: true, reason: "probe: no signed-in admin" })
    exempt() {
      return null;
    }

    @Delete("blank-reason")
    @AdminAudit({ exempt: true, reason: " " })
    blankReason() {
      return null;
    }

    @Get("read")
    read() {
      return null;
    }
  }

  @Controller("not-admin")
  class ProductProbeController {
    @Post("write")
    write() {
      return null;
    }
  }

  @Module({ controllers: [AuditProbeController, ProductProbeController] })
  class AuditProbeModule {}

  it("reports the probe write with neither the hook nor an exemption (and one exempt without a reason), nothing else", async () => {
    const probeRoutes = await scanRoutes(AuditProbeModule);

    expect(probeRoutes).toHaveLength(6);
    expect(unaudited(probeRoutes).map((route) => route.label).sort()).toEqual([
      "DELETE /admin/audit-probe/blank-reason (AuditProbeController.blankReason)",
      "POST /admin/audit-probe/unaudited (AuditProbeController.unaudited)",
    ]);
  });
});
