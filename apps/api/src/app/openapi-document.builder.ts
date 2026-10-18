/**
 * Builds the two OpenAPI 3.0 documents (RX-170) from the route table of the real `AppModule`:
 * `docs/openapi/backoffice.openapi.json` (every `/admin` route) and `docs/openapi/portal.openapi.json`
 * (the product API: everything else that is not on the exclusion list). Deterministic by construction:
 * paths and operations are emitted in sorted order, every object's keys are written in a fixed order,
 * and no timestamp is included, so regenerating writes byte-identical files.
 *
 * The route table is read the way `app.module.access.spec.ts` reads it: the module is booted in
 * preview mode (`NestFactory.createApplicationContext(AppModule, { preview: true })`), which scans
 * every module reachable from `AppModule` without instantiating anything (no database, no secrets),
 * and each handler's Nest metadata (`METHOD_METADATA`, `PATH_METADATA`, `VERSION_METADATA`,
 * `ROUTE_ARGS_METADATA`, `HTTP_CODE_METADATA`, the throttler's metadata and `@Access`) is read
 * through `Reflect`.
 */
import { RequestMethod, Type } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  VERSION_METADATA,
} from "@nestjs/common/constants";
import { MetadataScanner, ModulesContainer, NestFactory, Reflector } from "@nestjs/core";
import { Access } from "../common/decorators/access.decorator";
import type { AccessOptions } from "../common/types/access-options";
import { isExcludedFromOpenApi } from "../common/utils/is-excluded-from-openapi";
import { openApiDocumentKind, type OpenApiDocumentKind } from "../common/utils/openapi-route-split";
import { OPENAPI_SECURITY_SCHEMES } from "../common/utils/openapi-security-schemes";
import { openApiSecuritySchemeName } from "../common/utils/openapi-security-scheme";
import { ROUTE_BODY_SCHEMAS, ROUTE_QUERY_SCHEMAS } from "../common/utils/route-body-schemas";
import { zodSchemaToOpenApi } from "../common/utils/zod-schema-to-openapi";
import type { ZodType } from "zod";

/** The global prefix (`main.ts`) and the URI-versioning prefix every versioned route carries. */
const GLOBAL_PREFIX = "/api";
const VERSION_PREFIX = "v1";
/** The metadata key `@Throttle` writes its route limit under (throttler 6: `THROTTLER:LIMIT` + the named throttler). */
const THROTTLER_LIMIT_KEY = "THROTTLER:LIMITdefault";
/** `ALL` handlers (better-auth's catch-all) answer every method; the documents show them as POST+GET+PUT+PATCH+DELETE. */
const ALL_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE"] as const;

/** The route facts the document builder needs, as the preview scanner reads them off a handler. */
export type ScannedRoute = {
  /** `METHOD /controller-path[/handler-path]`, no prefixes; the key of the schema registries. */
  readonly routeKey: string;
  /** The route's full path, `/api` prefix and `v1` version prefix included (version-neutral: no version). */
  readonly fullPath: string;
  /** `METHOD /full-path (Controller.handler)`: the label the drift report names a route by. */
  readonly label: string;
  readonly method: string;
  readonly httpCode: number | undefined;
  readonly access: AccessOptions | undefined;
  readonly throttled: boolean;
  /** The handler's `@Param`/`@Query` arguments: kind ("path"/"query") and the argument's name. */
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  /** The handler reads the request body (`@Body`) or a multipart file. */
  readonly hasBody: boolean;
  readonly hasFile: boolean;
};

/** An OpenAPI 3.0 document built by this generator (only the parts it emits). */
export type OpenApiDocument = {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly description: string; readonly version: string };
  readonly servers: ReadonlyArray<{ readonly url: string }>;
  readonly tags: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: { readonly securitySchemes: typeof OPENAPI_SECURITY_SCHEMES };
};

const methodNames = ["get", "post", "put", "patch", "delete", "head", "options", "all"] as const;
const methodName = (method: string): string | undefined =>
  methodNames.find((name) => name === method.toLowerCase());

/** Reads one controller's route facts out of the module container, as the access spec does. */
function scanControllerRoutes(controller: Type<unknown>, scanner: MetadataScanner, reflector: Reflector): ScannedRoute[] {
  const routes: ScannedRoute[] = [];
  const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
  const controllerVersion = Reflect.getMetadata(VERSION_METADATA, controller);
  for (const name of scanner.getAllMethodNames(controller.prototype)) {
    const handler = (controller.prototype as Record<string, unknown>)[name] as () => unknown;
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (requestMethod === undefined) continue;
    const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const routePath = [controllerPath, handlerPath]
      .filter((part): part is string => typeof part === "string" && part !== "" && part !== "/")
      .join("/");
    const versionNeutral = controllerVersion !== undefined || Reflect.getMetadata(VERSION_METADATA, handler) !== undefined;
    const fullPath = `/${[GLOBAL_PREFIX, versionNeutral ? undefined : VERSION_PREFIX, routePath]
      .filter((part): part is string => part !== undefined)
      .join("/")}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    const method = RequestMethod[requestMethod];
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<string, { index: number; data?: unknown }>;
    const pathParams: string[] = [];
    const queryParams: string[] = [];
    let hasBody = false;
    for (const [key, value] of Object.entries(args)) {
      // The key is "<paramtype>:<index>": 3 body, 4 query, 5 path.
      const kind = key.split(":")[0];
      const argName = typeof value.data === "string" && value.data !== "" ? value.data : undefined;
      if (kind === "3") hasBody = true;
      if (kind === "4" && argName) queryParams.push(argName);
      if (kind === "5" && argName) pathParams.push(argName);
    }
    const routeKey = `${method} /${routePath}`.replace(/\/{2,}/g, "/");
    routes.push({
      routeKey,
      fullPath,
      label: `${method} ${fullPath} (${controller.name}.${name})`,
      method,
      httpCode: Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined,
      access: reflector.getAllAndOverride<AccessOptions>(Access, [handler, controller]),
      throttled: Reflect.getMetadata(THROTTLER_LIMIT_KEY, handler) !== undefined,
      pathParams: [...new Set(pathParams)].sort(),
      queryParams: [...new Set(queryParams)].sort(),
      // A multipart upload reads the file off `req.file()` without `@Body`, so the file routes are
      // listed here too (their body is the multipart form, not JSON).
      hasBody: hasBody || FILE_ROUTES.has(routeKey),
      hasFile: FILE_ROUTES.has(routeKey),
    });
  }
  return routes;
}

/** The routes that take a multipart file (read via `req.file()`), by `METHOD /route`. */
const FILE_ROUTES: ReadonlySet<string> = new Set<string>([
  "POST /channels/upload-icon",
  "POST /channels/:id/icon",
  "POST /v1/knowledge/bases/:id/upload",
  "POST /chat/portal/knowledge/:id/upload",
]);

/** The route table of a module, as the preview scanner sees it (nothing is instantiated). */
export async function scanOpenApiRoutes(module: Type<unknown>): Promise<ScannedRoute[]> {
  const context = await NestFactory.createApplicationContext(module, { preview: true, logger: false });
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const modules = context.get(ModulesContainer);
  const routes: ScannedRoute[] = [];
  for (const moduleRef of modules.values()) {
    for (const { metatype } of moduleRef.controllers.values()) {
      routes.push(...scanControllerRoutes(metatype as Type<unknown>, scanner, reflector));
    }
  }
  await context.close();
  return routes;
}

/** One route's OpenAPI operation object: parameters, body, responses, security — honest and simple (RX-170). */
function buildOperation(route: ScannedRoute, routeKey: string): Record<string, unknown> {
  const operation: Record<string, unknown> = {};
  if (route.access?.public) {
    operation.description = `Public: ${route.access.reason}`;
  } else if (!route.access?.public && route.access?.auth?.includes("staff")) {
    const needs = [
      route.access.permissions?.length ? `staff permissions: ${route.access.permissions.join(", ")}` : "a back-office session",
      route.access.staffScope && route.access.staffScope !== undefined ? `session scope: ${route.access.staffScope}` : undefined,
    ].filter((part): part is string => part !== undefined);
    operation.description = `Back-office route (${needs.join("; ")})`;
  }
  const parameters: Record<string, unknown>[] = [];
  for (const name of route.pathParams) {
    parameters.push({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
  }
  const querySchema = ROUTE_QUERY_SCHEMAS.get(routeKey);
  if (querySchema) {
    for (const param of queryParamsFromSchema(querySchema)) parameters.push(param);
  } else {
    for (const name of route.queryParams) {
      parameters.push({ name, in: "query", required: false, schema: { type: "string" } });
    }
  }
  if (parameters.length) operation.parameters = parameters;
  if (route.hasFile) {
    operation.requestBody = {
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: { file: { type: "string", format: "binary", description: "The uploaded file" } },
            required: ["file"],
          },
        },
      },
    };
  } else if (route.hasBody) {
    const bodySchema = ROUTE_BODY_SCHEMAS.get(routeKey);
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          // Routes whose controller parses a Zod DTO get its schema; the others say free-form JSON
          // (their handlers read the body by hand — a schema would be a guess, not a fact).
          schema: bodySchema ? zodSchemaToOpenApi(bodySchema) : FREE_FORM_JSON,
        },
      },
    };
  }
  operation.responses = buildResponses(route, routeKey);
  const schemeName = openApiSecuritySchemeName(route.access);
  if (schemeName) operation.security = [{ [schemeName]: [] }];
  return ordered(operation, ["description", "parameters", "requestBody", "responses", "security"]);
}

/** The responses of one route: the handler's status code (200 default, 201 where declared), 400 on a parsed body, 401/403/429. */
function buildResponses(route: ScannedRoute, routeKey: string): Record<string, unknown> {
  const successCode = route.httpCode ?? (route.method === "POST" ? 201 : 200);
  const responses: Record<string, unknown> = {
    [String(successCode)]: { description: successCode === 204 ? "Success (no content)" : "Success" },
  };
  if (route.hasBody) {
    responses["400"] = { description: ROUTE_BODY_SCHEMAS.get(routeKey) ? "Invalid request body (Zod validation failed)" : "Invalid request body" };
  }
  if (route.queryParams.length || ROUTE_QUERY_SCHEMAS.has(routeKey)) {
    responses["400"] = responses["400"] ?? { description: "Invalid query parameters" };
  }
  if (!route.access?.public) {
    responses["401"] = { description: "Not authenticated (missing or invalid credentials)" };
    if (route.access?.permissions?.length) {
      responses["403"] = { description: `Forbidden: needs staff permissions ${route.access.permissions.join(", ")}` };
    }
  }
  if (route.throttled) {
    responses["429"] = { description: "Rate limit exceeded (route-specific throttle)" };
  }
  return ordered(responses, ["200", "201", "204", "400", "401", "403", "429"]);
}

/** The query parameters of a route whose controller parses its query string with a Zod schema. */
function queryParamsFromSchema(schema: ZodType): Record<string, unknown>[] {
  const jsonSchema = zodSchemaToOpenApi(schema);
  const properties = (jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((jsonSchema.required ?? []) as string[]);
  return Object.keys(properties)
    .sort()
    .map((name) => ({
      name,
      in: "query",
      required: required.has(name),
      // The audit-log DTOs pipe `from`/`to` through a transform: their input type is documented.
      schema: properties[name],
    }));
}

const FREE_FORM_JSON: Record<string, unknown> = { type: "object", additionalProperties: true, description: "Free-form JSON body (the handler reads it by hand; no Zod schema)" };

/** Writes an object's own enumerable keys in the given order (rest afterwards): stable key order across runs. */
function ordered(object: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of order) if (key in object) result[key] = object[key];
  for (const key of Object.keys(object).sort()) if (!(key in result)) result[key] = object[key];
  return result;
}

/** Builds one of the two documents from the scanned routes of the given kind. */
export function buildOpenApiDocument(kind: OpenApiDocumentKind, routes: readonly ScannedRoute[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const usedSchemes = new Set<string>();
  const tags = new Set<string>();
  for (const route of routes) {
    if (isExcludedFromOpenApi(route.fullPath) !== undefined) continue;
    if (openApiDocumentKind(route.fullPath) !== kind) continue;
    const pathItem = (paths[route.fullPath] ??= {});
    const routeKey = route.routeKey;
    const tag = route.fullPath.split("/")[3] ?? route.fullPath;
    tags.add(tag);
    for (const method of route.method === "ALL" ? ALL_METHODS : [route.method]) {
      const name = methodName(method);
      if (!name) continue;
      pathItem[name] = { ...buildOperation(route, routeKey), tags: [tag] };
    }
    const schemeName = openApiSecuritySchemeName(route.access);
    if (schemeName) usedSchemes.add(schemeName);
  }
  // Deterministic: paths in sorted order, methods in a fixed order, security schemes sorted by name.
  const sortedPaths: Record<string, Record<string, unknown>> = {};
  for (const path of Object.keys(paths).sort()) {
    sortedPaths[path] = ordered(paths[path], ["get", "post", "put", "patch", "delete", "head", "options"]);
  }
  const securitySchemes = Object.fromEntries(
    Object.entries(OPENAPI_SECURITY_SCHEMES)
      .filter(([name]) => usedSchemes.has(name))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return {
    openapi: "3.0.3",
    info: {
      title: kind === "backoffice" ? "Renovix AI Back-Office API" : "Renovix AI Portal and Customer API",
      description:
        kind === "backoffice"
          ? "The back-office (staff) API of Renovix AI: every /api/v1/admin route. Generated from the code by `bun run openapi:generate` (RX-170); the source of truth is the controllers, not this file."
          : "The product API of Renovix AI (api.renovix.id): the routes the chat portal and API customers call. Generated from the code by `bun run openapi:generate` (RX-170); the source of truth is the controllers, not this file.",
      version: "1.0.0",
    },
    servers: [{ url: kind === "backoffice" ? "https://api.renovix.id" : "https://api.renovix.id" }],
    tags: [...tags].sort().map((name) => ({ name, description: `Routes under /${name}` })),
    paths: sortedPaths,
    components: { securitySchemes },
  };
}

/** The registry entries that no scanned route uses (a stale entry: the mapping must follow the code). */
export function staleSchemaEntries(routes: readonly ScannedRoute[]): string[] {
  const routeKeys = new Set(routes.map((route) => route.routeKey));
  return [...ROUTE_BODY_SCHEMAS.keys(), ...ROUTE_QUERY_SCHEMAS.keys()].filter((key) => !routeKeys.has(key)).sort();
}
