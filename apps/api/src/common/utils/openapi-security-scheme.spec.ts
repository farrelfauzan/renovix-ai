import { openApiSecuritySchemeName } from "./openapi-security-scheme";
import type { AccessOptions } from "../types/access-options";

describe("openApiSecuritySchemeName", () => {
  it("maps each accepted method to its scheme", () => {
    expect(openApiSecuritySchemeName({ auth: ["apiKey"] })).toBe("BearerApiKey");
    expect(openApiSecuritySchemeName({ auth: ["portal"] })).toBe("PortalSession");
    expect(openApiSecuritySchemeName({ auth: ["staff"] })).toBe("BackOfficeSession");
    expect(openApiSecuritySchemeName({ auth: ["session"] })).toBe("SessionCookie");
  });

  it("maps a public route (or a missing declaration) to no scheme", () => {
    expect(openApiSecuritySchemeName({ public: true, reason: "probe" })).toBeUndefined();
    expect(openApiSecuritySchemeName(undefined)).toBeUndefined();
  });

  it("prefers apiKey over the others when several are accepted (it is the header the caller must set)", () => {
    const mixed: AccessOptions = { auth: ["session", "apiKey"] };
    expect(openApiSecuritySchemeName(mixed)).toBe("BearerApiKey");
  });
});
