import { resolveCorsOrigins } from "./resolve-cors-origins";

describe("RX-156 / D141: resolveCorsOrigins", () => {
  it("adds ADMIN_ORIGIN to the listed product origins", () => {
    const inputEnv = { CORS_ORIGIN: "https://chat.renovix.id, https://renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" };

    const actualOrigins = resolveCorsOrigins(inputEnv);

    expect(actualOrigins).toEqual(["https://chat.renovix.id", "https://renovix.id", "https://admin.renovix.id"]);
  });

  it("does not list ADMIN_ORIGIN twice", () => {
    const inputEnv = { CORS_ORIGIN: "https://chat.renovix.id,https://admin.renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" };

    expect(resolveCorsOrigins(inputEnv)).toEqual(["https://chat.renovix.id", "https://admin.renovix.id"]);
  });

  it("control: a list without ADMIN_ORIGIN stays as it is", () => {
    expect(resolveCorsOrigins({ CORS_ORIGIN: "https://chat.renovix.id" })).toEqual(["https://chat.renovix.id"]);
  });

  it("control: without CORS_ORIGIN every origin is accepted, as before", () => {
    expect(resolveCorsOrigins({ ADMIN_ORIGIN: "https://admin.renovix.id" })).toBe(true);
  });

  it("negative: an origin that is neither listed nor ADMIN_ORIGIN is not accepted", () => {
    const actualOrigins = resolveCorsOrigins({ CORS_ORIGIN: "https://chat.renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" });

    expect(actualOrigins).not.toContain("https://evil.example");
  });
});
