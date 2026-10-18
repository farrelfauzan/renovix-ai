/**
 * Turns a Zod schema into an OpenAPI 3.0-compatible JSON Schema fragment (RX-170): zod v4's
 * `toJSONSchema` (input shape: a request schema describes what the caller sends, so defaulted and
 * transform-piped fields show their input type and defaults are not required), then nestjs-zod's
 * `convertToOpenApi3Point0` rewrite (`anyOf` with `null` → `nullable`, `const` → single-value
 * `enum`), which is the same normalization `cleanupOpenApiDoc` applies inside `@nestjs/swagger`
 * documents. `unrepresentable: "any"` keeps transform-only schemas (e.g. a cursor) as their input
 * type instead of throwing. The `$schema` marker is dropped: it is JSON-Schema meta, not OpenAPI.
 */
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import { z, type ZodType } from "zod";

// The rewrite is not on nestjs-zod's public API (`cleanupOpenApiDoc` applies it to whole documents
// built by @nestjs/swagger), and the package's `exports` map hides its dist files, so it is loaded
// from the on-disk path (pinned dependency nestjs-zod 5.3.0).
const nodeRequire = createRequire(__filename);
const { convertToOpenApi3Point0 }: { convertToOpenApi3Point0: (schema: Record<string, unknown>) => Record<string, unknown> } =
  nodeRequire(nodePath.join(nodePath.dirname(nodeRequire.resolve("nestjs-zod")), "symbols-uv4cJ8eW.cjs"));

/** A Zod schema as an OpenAPI 3.0-compatible JSON Schema fragment (request: input shape, `$schema` dropped). */
export function zodSchemaToOpenApi(schema: ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  const openApiSchema = convertToOpenApi3Point0(jsonSchema);
  delete openApiSchema.$schema;
  return openApiSchema;
}
