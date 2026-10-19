import { buildAuditChange } from "./build-audit-change";

// RX-177: the audit names the changed fields only; a secret is named, never valued.
describe("buildAuditChange", () => {
  it("keeps only the changed fields, names them, and names a changed secret without a value", () => {
    const actualChange = buildAuditChange({
      subject: { providerId: "p1" },
      before: { name: "A", baseUrl: "https://a.test" },
      after: { name: "A", baseUrl: "https://b.test" },
      changedSecrets: ["apiKey"],
    });

    expect(actualChange).toEqual({
      before: { providerId: "p1", baseUrl: "https://a.test" },
      after: { providerId: "p1", baseUrl: "https://b.test", changedFields: "baseUrl,apiKey" },
    });
  });

  it("on create (nothing before), names every field", () => {
    const actualChange = buildAuditChange({ subject: { modelId: "m1" }, before: {}, after: { slug: "x/y", active: true } });

    expect(actualChange).toEqual({ before: { modelId: "m1" }, after: { modelId: "m1", slug: "x/y", active: true, changedFields: "slug,active" } });
  });
});
