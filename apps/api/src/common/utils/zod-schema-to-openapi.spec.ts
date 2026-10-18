import { z } from "zod";
import { zodSchemaToOpenApi } from "./zod-schema-to-openapi";

/** The min/max zod v4 adds to every integer (the safe-integer range): stripped for readability here. */
const INTEGER_RANGE = { minimum: -9007199254740991, maximum: 9007199254740991 };

describe("zodSchemaToOpenApi", () => {
  it("emits an OpenAPI 3.0-compatible object schema (no $schema marker, input shape)", () => {
    const schema = z.object({ name: z.string().min(1).max(100), count: z.number().int().optional() });
    expect(zodSchemaToOpenApi(schema)).toEqual({
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        count: { type: "integer", ...INTEGER_RANGE },
      },
      required: ["name"],
    });
  });

  it("rewrites nullable unions and const literals the OpenAPI 3.0 way", () => {
    const schema = z.object({ avatar: z.string().url().nullable().optional(), kind: z.literal("x") });
    expect(zodSchemaToOpenApi(schema)).toEqual({
      type: "object",
      properties: {
        avatar: { type: "string", format: "uri", nullable: true },
        kind: { type: "string", enum: ["x"] },
      },
      required: ["kind"],
    });
  });

  it("keeps defaulted fields as input (optional with a default, not required)", () => {
    const schema = z.object({ store: z.boolean().default(false) });
    expect(zodSchemaToOpenApi(schema)).toEqual({
      type: "object",
      properties: { store: { default: false, type: "boolean" } },
    });
  });

  it("keeps a transform's input type instead of throwing (the request describes what the caller sends)", () => {
    const schema = z.object({ code: z.string().min(1).max(50).transform((value) => value.trim().toUpperCase()) });
    expect(zodSchemaToOpenApi(schema)).toEqual({
      type: "object",
      properties: { code: { type: "string", minLength: 1, maxLength: 50 } },
      required: ["code"],
    });
  });

  it("drops the JSON-Schema $schema marker: it is not an OpenAPI keyword", () => {
    expect(JSON.stringify(zodSchemaToOpenApi(z.string()))).not.toContain("$schema");
  });
});
