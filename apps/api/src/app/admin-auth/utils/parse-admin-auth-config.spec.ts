import { parseAdminAuthConfig } from "./parse-admin-auth-config";

describe("parseAdminAuthConfig (RX-94 security values)", () => {
  const from = (env: Record<string, string>) => parseAdminAuthConfig((name) => env[name]);

  it("has the decided defaults when nothing is set (D54, D61, R-6)", () => {
    expect(from({})).toEqual({
      passwordMinLength: 12,
      argon2MemoryKib: 19456,
      argon2TimeCost: 2,
      argon2Parallelism: 1,
      maxFailedAttempts: 5,
      lockoutMinutes: 15,
      accessTokenSeconds: 900,
      idleMinutes: 30,
      absoluteHours: 12,
      totpToleranceSeconds: 30,
      recoveryCodeCount: 10,
    });
  });

  it("takes an environment override", () => {
    expect(from({ ADMIN_AUTH_LOCKOUT_MINUTES: "20" }).lockoutMinutes).toBe(20);
  });

  it.each([["abc"], ["0"], ["-5"], ["1.5"]])("refuses %s as a value", (value) => {
    expect(() => from({ ADMIN_AUTH_MAX_FAILED_ATTEMPTS: value })).toThrow("ADMIN_AUTH_MAX_FAILED_ATTEMPTS");
  });

  it("refuses a password minimum below the breached list's cut (12)", () => {
    expect(() => from({ ADMIN_AUTH_PASSWORD_MIN_LENGTH: "11" })).toThrow("at least 12");
  });
});
