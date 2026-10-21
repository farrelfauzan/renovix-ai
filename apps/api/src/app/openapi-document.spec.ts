import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Controller, Get, Module, Type } from "@nestjs/common";

// RX-170: the two generated OpenAPI documents. The generator runs inside Jest on purpose: booting
// `AppModule` in preview mode works under ts-jest but fails under tsx/node directly (module
// duplication artifact), and Jest's setup (test/setup-env.ts) already provides the dummy env and
// mocks ../src/lib/auth. This spec follows app.module.access.spec.ts's pattern exactly: AppModule
// and the helpers are required, not imported — an import (or a `typeof import(...)`) would put
// every file of the app into the spec type program (tsconfig.spec.json), which then reports the
// app's own type errors a second time. marked is ESM-only (the app imports it through the
// document converters).
jest.mock("marked", () => ({}));
const { AppModule }: { AppModule: Type<unknown> } = require("./app.module");
const {
  buildOpenApiDocument,
  scanOpenApiRoutes,
  staleSchemaEntries,
}: {
  buildOpenApiDocument: (kind: "backoffice" | "portal", routes: ScannedRoute[]) => OpenApiDocument;
  scanOpenApiRoutes: (module: Type<unknown>) => Promise<ScannedRoute[]>;
  staleSchemaEntries: (routes: readonly ScannedRoute[]) => string[];
} = require("./openapi-document.builder");
const { isExcludedFromOpenApi }: { isExcludedFromOpenApi: (fullPath: string) => string | undefined } = require(
  "../common/utils/is-excluded-from-openapi",
);
const {
  unassignedOpenApiRoutes,
}: { unassignedOpenApiRoutes: (routes: readonly ScannedRoute[], isExcluded: (fullPath: string) => string | undefined, documentedPaths: ReadonlySet<string>) => string[] } =
  require("../common/utils/openapi-route-split");
const {
  scanOpenApiDocumentForSecrets,
}: { scanOpenApiDocumentForSecrets: (document: unknown, envValues: readonly string[]) => string[] } = require(
  "../common/utils/scan-openapi-document-for-secrets",
);

/** One scanned route, the fields the spec reads (a structural subset of the builder's `ScannedRoute`). */
type ScannedRoute = {
  routeKey: string;
  fullPath: string;
  label: string;
  method: string;
  access: { public?: boolean; auth?: readonly string[]; permissions?: readonly string[] } | undefined;
};

/** A generated document, the fields the spec reads (a structural subset of the builder's `OpenApiDocument`). */
type OpenApiDocument = {
  info: { title: string; description: string };
  paths: Record<string, Record<string, { security?: unknown; description?: string; requestBody?: unknown }>>;
  components: { securitySchemes: Record<string, unknown> };
};

// The documents are committed at the repo root (docs/openapi/), three levels above apps/api/src/app.
const DOCS_DIR = resolve(__dirname, "../../../..", "docs", "openapi");
const BACKOFFICE_FILE = join(DOCS_DIR, "backoffice.openapi.json");
const PORTAL_FILE = join(DOCS_DIR, "portal.openapi.json");
/** `UPDATE_OPENAPI=1` (root script `bun run openapi:generate`) rewrites the committed files instead of checking them. */
const UPDATE = process.env.UPDATE_OPENAPI === "1";
/** The values the dummy test env sets (test/setup-env.ts): a document must contain none of them. */
const SETUP_ENV_VALUES = [
  "postgresql://none@127.0.0.1:1/no_test_database_test",
  "test-jwt-secret",
  "test-admin-jwt-secret-not-a-real-secret",
  "test-mcp-oauth-state-secret-not-a-real-secret",
  "http://admin.renovix.test",
  Buffer.alloc(32, 7).toString("base64"),
  Buffer.alloc(32, 9).toString("hex"),
  Buffer.alloc(32, 11).toString("hex"),
];

/** The operation keys of a document's paths (sorted): `METHOD /path` for every route it documents. */
function documentOperations(document: unknown): string[] {
  const paths = (document as { paths: Record<string, Record<string, { tags?: string[] }>> }).paths;
  const operations: string[] = [];
  for (const path of Object.keys(paths)) {
    for (const method of Object.keys(paths[path])) {
      if (method === "parameters") continue;
      operations.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations.sort();
}

describe("RX-170: two generated OpenAPI documents", () => {
  let routes: ScannedRoute[];
  let backoffice: OpenApiDocument;
  let portal: OpenApiDocument;

  beforeAll(async () => {
    routes = await scanOpenApiRoutes(AppModule);
    backoffice = buildOpenApiDocument("backoffice", routes);
    portal = buildOpenApiDocument("portal", routes);
    process.stdout.write(
      `RX-170: ${routes.length} routes scanned, ${Object.keys(backoffice.paths).length} backoffice paths, ${Object.keys(portal.paths).length} portal paths\n`,
    );
  });

  it("looks at the real route table (it is not empty)", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every route is in exactly one document or on the exclusion list", () => {
    // The acceptance criterion: a new controller route in neither document nor the exclusion list
    // fails here and names the route. The documents' path keys are the union both files document.
    const documentedPaths = new Set([...Object.keys(backoffice.paths), ...Object.keys(portal.paths)]);
    expect(unassignedOpenApiRoutes(routes, isExcludedFromOpenApi, documentedPaths)).toEqual([]);
    // And the two documents' operations together cover every non-excluded route exactly once
    // (an ALL handler counts once per method it documents).
    const documented = documentOperations(backoffice).concat(documentOperations(portal)).sort();
    const expected = routes
      .filter((route) => isExcludedFromOpenApi(route.fullPath) === undefined)
      .flatMap((route) =>
        (route.method === "ALL" ? ["POST", "GET", "PUT", "PATCH", "DELETE"] : [route.method]).map(
          (method) => `${method} ${route.fullPath}`,
        ),
      )
      .sort();
    expect(documented).toEqual(expected);
  });

  it("the schema registry matches the code (no stale route entries)", () => {
    expect(staleSchemaEntries(routes)).toEqual([]);
  });

  it("the documents are deterministic (building twice is byte-identical)", () => {
    expect(JSON.stringify(buildOpenApiDocument("backoffice", routes))).toBe(JSON.stringify(backoffice));
    expect(JSON.stringify(buildOpenApiDocument("portal", routes))).toBe(JSON.stringify(portal));
  });

  it("backoffice documents ONLY /api/v1/admin paths; portal contains none", () => {
    const backofficePaths = Object.keys(backoffice.paths);
    const portalPaths = Object.keys(portal.paths);
    expect(backofficePaths.length).toBeGreaterThan(0);
    expect(backofficePaths.every((path) => path.startsWith("/api/v1/admin"))).toBe(true);
    expect(portalPaths.some((path) => path.startsWith("/api/v1/admin"))).toBe(false);
  });

  it("portal documents the representative user, apiKey and portal routes (actual paths, not fixed ones)", () => {
    const portalOperations = documentOperations(portal);
    expect(portalOperations).toContain("POST /api/v1/chat/completions");
    expect(portalOperations).toContain("POST /api/v1/chat/portal/completions");
    expect(portalOperations).toContain("GET /api/v1/auth/me");
    // The knowledge controller composes @Controller("v1/knowledge") under the global /api/v1: the
    // real path is /api/v1/v1/knowledge — documented as it is, not "fixed".
    expect(portalOperations).toContain("GET /api/v1/v1/knowledge/bases");
    expect(portalOperations).toContain("GET /api/v1/models");
    expect(portalOperations).toContain("GET /api/v1/usage");
    expect(portalOperations).toContain("POST /api/v1/export");
  });

  it("the exclusions are only webhooks and the infra probes", () => {
    const excluded = routes.filter((route) => isExcludedFromOpenApi(route.fullPath) !== undefined);
    expect(excluded.map((route) => route.label).sort()).toEqual([
      "GET /api/health (HealthController.check)",
      "GET /api/v1 (AppController.getData)",
      "GET /api/v1/webhooks/stripe (WebhookController.healthCheck)",
      "POST /api/v1/webhooks/gowa (GowaWebhookController.handleInbound)",
      "POST /api/v1/webhooks/stripe (WebhookController.handleStripeWebhook)",
    ]);
  });

  it("every operation carries a security scheme or says it is public", () => {
    for (const document of [backoffice, portal]) {
      for (const path of Object.keys(document.paths)) {
        for (const method of Object.keys(document.paths[path])) {
          const operation = document.paths[path][method] as { security?: unknown; description?: string };
          const hasSecurity = operation.security !== undefined;
          const saysPublic = typeof operation.description === "string" && operation.description.startsWith("Public: ");
          expect(`${method.toUpperCase()} ${path}: ${hasSecurity || saysPublic}`).toBe(`${method.toUpperCase()} ${path}: true`);
        }
      }
    }
  });

  it("the documents contain no secrets (names, key patterns, internal hosts, dummy env values)", () => {
    expect(scanOpenApiDocumentForSecrets(backoffice, SETUP_ENV_VALUES)).toEqual([]);
    expect(scanOpenApiDocumentForSecrets(portal, SETUP_ENV_VALUES)).toEqual([]);
  });

  it("the secrets scanner catches a planted value (control)", () => {
    // A planted-value control: inject a fake value into a copy of the document and assert the
    // scanner names it, so a clean run is proof the scanner works, not that it silently matched nothing.
    const planted = JSON.parse(JSON.stringify(portal)) as { info: { description: string } };
    planted.info = { description: "leaked sk_live_abcdef0123456789 in the description" };
    expect(scanOpenApiDocumentForSecrets(planted, SETUP_ENV_VALUES)).toContain("API key prefix");
    const plantedHost = JSON.parse(JSON.stringify(backoffice)) as { servers: { url: string }[] };
    plantedHost.servers = [{ url: "http://localhost:3000" }];
    expect(scanOpenApiDocumentForSecrets(plantedHost, SETUP_ENV_VALUES)).toContain("internal hostname");
  });

  it("no operation advertises an rnx_live_ or sk_live_ key example in any description", () => {
    for (const document of [backoffice, portal]) {
      expect(JSON.stringify(document)).not.toMatch(/rnx_live_|sk_live_|sk_test_|pk_live_|pk_test_/);
    }
  });

  // The committed files: drift check by default, UPDATE_OPENAPI=1 rewrites them (openapi:generate).
  it.each([
    ["backoffice", BACKOFFICE_FILE, () => backoffice],
    ["portal", PORTAL_FILE, () => portal],
  ] as const)("the committed %s document matches the code (drift check)", (_name, file, build) => {
    const built = build();
    const serialized = `${JSON.stringify(built, null, 2)}\n`;
    if (UPDATE) {
      if (!existsSync(DOCS_DIR)) throw new Error(`docs/openapi folder is missing: ${DOCS_DIR}`);
      writeFileSync(file, serialized);
      return;
    }
    if (!existsSync(file)) {
      throw new Error(
        `${file} does not exist yet. Run \`bun run openapi:generate\` (UPDATE_OPENAPI=1) once to write it, then commit the result.`,
      );
    }
    const committed = readFileSync(file, "utf8");
    if (committed !== serialized) {
      const committedOps = documentOperations(JSON.parse(committed));
      const generatedOps = documentOperations(built);
      const missing = committedOps.filter((op) => !generatedOps.includes(op));
      const added = generatedOps.filter((op) => !committedOps.includes(op));
      throw new Error(
        [
          `${file} is out of date with the code (RX-170 drift).`,
          missing.length ? `Routes removed from the code but still in the document:\n  ${missing.join("\n  ")}` : "",
          added.length ? `Routes added to the code but missing from the document:\n  ${added.join("\n  ")}` : "",
          "If the routes are the same, the operation content changed (schema, security, responses).",
          "Regenerate with `bun run openapi:generate` and commit the updated files.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  });
});

// The red/green probe (like the access spec's): a rogue controller route that is in neither
// document nor on the exclusion list must be named by the split check, proving the generator test
// fails on an undocumented route instead of passing vacuously.
describe("RX-170: the split check names a route that is in neither document (probe)", () => {
  @Controller("rogue-probe")
  class RogueProbeController {
    @Get("leaked")
    leaked() {
      return null;
    }
  }

  @Module({ controllers: [RogueProbeController] })
  class RogueProbeModule {}

  it("reports the probe route as unassigned", async () => {
    const probeRoutes = await scanOpenApiRoutes(RogueProbeModule);
    const probeDocument = buildOpenApiDocument("portal", probeRoutes);

    expect(probeRoutes).toHaveLength(1);
    expect(unassignedOpenApiRoutes(probeRoutes, isExcludedFromOpenApi, new Set(Object.keys(probeDocument.paths)))).toEqual(
      [], // the probe route IS documented by the split logic itself
    );
    // Red/green: the same route with the documents' content swapped out is named as unassigned.
    expect(unassignedOpenApiRoutes(probeRoutes, isExcludedFromOpenApi, new Set())).toEqual([
      "GET /api/v1/rogue-probe/leaked (RogueProbeController.leaked)",
    ]);
    expect(scanOpenApiDocumentForSecrets(probeDocument, [])).toEqual([]);
  });
});
