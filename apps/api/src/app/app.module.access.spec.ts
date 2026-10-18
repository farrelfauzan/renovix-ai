import { Controller, Delete, Get, Module, Patch, Post, Put, RequestMethod, Type } from "@nestjs/common";
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
import { Access } from "../common/decorators/access.decorator";
import { AccessOptions } from "../common/types/access-options";
import { STAFF_PERMISSIONS } from "./admin-auth/config/staff-permissions";
import { AdminAudit } from "./admin-auth/decorator/admin-audit.decorator";
import type { AdminAuditOptions } from "./admin-auth/types/admin-audit-options";

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
  // A route that changes kind, or a new route that is not jwt/session, must be added here on purpose.
  const PUBLIC_ROUTES = [
    "ALL /auth/better/* (BetterAuthController.handleAuth)",
    "GET / (AppController.getData)",
    "GET /health (HealthController.check)",
    "GET /mcp/user/oauth/callback (McpUserController.oauthCallback)",
    "GET /models (ModelsController.listModels)",
    "GET /webhooks/stripe (WebhookController.healthCheck)",
    "GET /workspace-invites/accept (WorkspaceInviteController.resolveInvite)",
    "POST /admin/auth/refresh (AdminAuthController.refresh)",
    "POST /admin/auth/sign-in (AdminAuthController.signIn)",
    "POST /auth/login (AuthController.login)",
    "POST /auth/logout (AuthController.logout)",
    "POST /auth/register (AuthController.register)",
    "POST /webhooks/gowa (GowaWebhookController.handleInbound)",
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
    "GET /admin/audit-log (AdminAuditLogController.list)",
    "GET /admin/audit-log/export (AdminAuditLogController.export)",
    "GET /admin/auth/sessions (AdminAuthController.listSessions)",
    "POST /admin/auth/reauth (AdminAuthController.reauth)",
  ];
  const STAFF_ENROLMENT_ROUTES = [
    "POST /admin/auth/totp/confirm (AdminAuthController.confirm)",
    "POST /admin/auth/totp/enrol (AdminAuthController.enrol)",
  ];
  const STAFF_ANY_SCOPE_ROUTES = ["POST /admin/auth/sign-out (AdminAuthController.signOut)"];
  // Back-office routes that declare staff permissions (RX-96), with the permissions each declares. RX-94's
  // routes are self-service (an admin manages their own session) and need none. RX-164 (D113 item 53,
  // D138): the audit log and its CSV export need `audit:read` only (not `exports:create`).
  const STAFF_PERMISSION_ROUTES: Record<string, string[]> = {
    "GET /admin/audit-log (AdminAuditLogController.list)": ["audit:read"],
    "GET /admin/audit-log/export (AdminAuditLogController.export)": ["audit:read"],
  };
  const declares = (route: Route, methods: string[]) =>
    !route.access?.public && JSON.stringify(route.access?.auth) === JSON.stringify(methods);
  const declaresStaff = (route: Route, staffScope: string | undefined) =>
    declares(route, ["staff"]) && !route.access?.public && route.access?.staffScope === staffScope;

  it("each route declares the methods decided for it; every other route is jwt/session", () => {
    expect(labels(routes.filter((route) => route.access?.public))).toEqual(PUBLIC_ROUTES);
    expect(labels(routes.filter((route) => declares(route, ["apiKey"])))).toEqual(API_KEY_ROUTES);
    expect(labels(routes.filter((route) => declares(route, ["portal"])))).toEqual(PORTAL_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, undefined)))).toEqual(STAFF_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, "enrolment")))).toEqual(STAFF_ENROLMENT_ROUTES);
    expect(labels(routes.filter((route) => declaresStaff(route, "any")))).toEqual(STAFF_ANY_SCOPE_ROUTES);
    // No route lists staff next to another method, and none outside the three lists above.
    expect(labels(routes.filter((route) => !route.access?.public && route.access?.auth?.includes("staff")))).toEqual(
      [...STAFF_ROUTES, ...STAFF_ENROLMENT_ROUTES, ...STAFF_ANY_SCOPE_ROUTES].sort(),
    );
    const known = [
      ...PUBLIC_ROUTES,
      ...API_KEY_ROUTES,
      ...PORTAL_ROUTES,
      ...STAFF_ROUTES,
      ...STAFF_ENROLMENT_ROUTES,
      ...STAFF_ANY_SCOPE_ROUTES,
    ];
    const others = routes.filter((route) => !known.includes(route.label));
    expect(labels(others.filter((route) => !declares(route, ["jwt", "session"])))).toEqual([]);
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

  // RX-97 criterion 3: every state-changing /admin route is hooked or exempt; the lists below are the PR's.
  const AUDITED_ROUTES = [
    "DELETE /admin/auth/sessions/:id (AdminAuthController.revokeSession)",
    "POST /admin/auth/reauth (AdminAuthController.reauth)",
    "POST /admin/auth/sign-out (AdminAuthController.signOut)",
    "POST /admin/auth/totp/confirm (AdminAuthController.confirm)",
    "POST /admin/auth/totp/enrol (AdminAuthController.enrol)",
  ];
  const AUDIT_EXEMPT_ROUTES = [
    "POST /admin/auth/refresh (AdminAuthController.refresh)",
    "POST /admin/auth/sign-in (AdminAuthController.signIn)",
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
  const AUDITED_READ_ROUTES = ["GET /admin/audit-log/export (AdminAuditLogController.export)"];

  it("RX-164: the /admin reads that write an audit row (exports) are pinned", () => {
    expect(labels(routes.filter((route) => isAdminRoute(route) && !changesState(route) && route.audit !== undefined))).toEqual(
      AUDITED_READ_ROUTES,
    );
    expect(labels(routes.filter((route) => AUDITED_READ_ROUTES.includes(route.label) && isHooked(route)))).toEqual(AUDITED_READ_ROUTES);
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
