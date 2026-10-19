import { buildAuditChange } from "./build-audit-change";

// RX-177, D197: the audit names the changed fields only; no value is recorded, secret or not.
describe("buildAuditChange", () => {
  it("names the changed fields (a changed secret too) and records no value, old or new", () => {
    const actualChange = buildAuditChange({
      subject: { providerId: "p1" },
      before: { name: "A", baseUrl: "https://a.test" },
      after: { name: "A", baseUrl: "https://b.test" },
      changedSecrets: ["apiKey"],
    });

    expect(actualChange).toEqual({
      before: { providerId: "p1" },
      after: { providerId: "p1", changedFields: "baseUrl,apiKey" },
    });
    expect(JSON.stringify(actualChange)).not.toContain("a.test");
    expect(JSON.stringify(actualChange)).not.toContain("b.test");
  });

  it("on create (nothing before), names every field without values", () => {
    const actualChange = buildAuditChange({ subject: { modelId: "m1" }, before: {}, after: { slug: "x/y", active: true } });

    expect(actualChange).toEqual({ before: { modelId: "m1" }, after: { modelId: "m1", changedFields: "slug,active" } });
  });
});
