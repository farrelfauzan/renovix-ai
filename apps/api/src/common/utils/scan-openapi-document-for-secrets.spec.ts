import { scanOpenApiDocumentForSecrets } from "./scan-openapi-document-for-secrets";

describe("scanOpenApiDocumentForSecrets", () => {
  const envValues = ["postgresql://none@127.0.0.1:1/no_test_database_test", "short", "test-jwt-secret"];

  it("accepts a clean document (the generated docs contain none of the patterns)", () => {
    const cleanDocument = {
      openapi: "3.0.3",
      info: { title: "Renovix AI API", description: "Generated from the code" },
      servers: [{ url: "https://api.renovix.id" }],
      paths: { "/api/v1/models": { get: { description: "Public: model list" } } },
    };
    expect(scanOpenApiDocumentForSecrets(cleanDocument, envValues)).toEqual([]);
  });

  it("flags secret-ish names, key prefixes and internal hostnames wherever they appear", () => {
    expect(scanOpenApiDocumentForSecrets({ paths: { "/x": { get: { description: "the JWT_SECRET value" } } } }, [])).toContain("secret name");
    expect(scanOpenApiDocumentForSecrets({ paths: { "/x": { get: { example: "sk_live_abc123" } } } }, [])).toContain("API key prefix");
    expect(scanOpenApiDocumentForSecrets({ paths: { "/x": { get: { example: "rnx_live_abc123" } } } }, [])).toContain("API key prefix");
    expect(scanOpenApiDocumentForSecrets({ servers: [{ url: "http://localhost:3000" }] }, [])).toContain("internal hostname");
    expect(scanOpenApiDocumentForSecrets({ servers: [{ url: "http://10.0.0.1.internal:80" }] }, [])).toContain("internal hostname");
  });

  it("flags the values of the given env vars (the dummy test env)", () => {
    expect(scanOpenApiDocumentForSecrets({ paths: { "/x": { get: { description: "connect to postgresql://none@127.0.0.1:1/no_test_database_test" } } } }, envValues)).toContain(
      'env value "post…"',
    );
    expect(scanOpenApiDocumentForSecrets({ info: { description: "signed with test-jwt-secret" } }, envValues)).toContain('env value "test…"');
  });

  it("ignores env values too short to be worth flagging (they match everywhere)", () => {
    expect(scanOpenApiDocumentForSecrets({ info: { description: "a short string appears in most documents" } }, ["short"])).toEqual([]);
  });
});
