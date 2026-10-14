import { readRequiredSecret } from "./read-required-secret";

// RX-110: a required secret has no fallback; outside development and test, placeholders and short values are refused.
const REAL = "a-real-looking-secret-with-more-than-32-characters";

describe("readRequiredSecret", () => {
  it.each(["production", "development", "test", undefined])(
    "refuses a missing value (NODE_ENV=%s): no fallback in any mode",
    (mode) => {
      expect(() => readRequiredSecret({ NODE_ENV: mode }, "JWT_SECRET")).toThrow(
        "JWT_SECRET is required and is not set",
      );
    },
  );

  it.each(["", "   "])("refuses an empty value %j", (value) => {
    expect(() => readRequiredSecret({ NODE_ENV: "development", JWT_SECRET: value }, "JWT_SECRET")).toThrow(
      "JWT_SECRET is required",
    );
  });

  it.each([
    "change-me",
    "change-me-in-production",
    "random-secret-for-signing-change-me",
    "random-secret-change-me",
    "dev-only-jwt-secret-never-use-in-production",
  ])("refuses the placeholder %j in production", (value) => {
    expect(() => readRequiredSecret({ NODE_ENV: "production", JWT_SECRET: value }, "JWT_SECRET")).toThrow(
      "JWT_SECRET is a placeholder value",
    );
  });

  it("treats an unset NODE_ENV as production", () => {
    expect(() => readRequiredSecret({ JWT_SECRET: "change-me-in-production" }, "JWT_SECRET")).toThrow(
      "JWT_SECRET is a placeholder value",
    );
  });

  it("refuses a value shorter than 32 characters in production", () => {
    expect(() => readRequiredSecret({ NODE_ENV: "production", JWT_SECRET: "x".repeat(31) }, "JWT_SECRET")).toThrow(
      "JWT_SECRET must have at least 32 characters",
    );
  });

  it("accepts a real value in production", () => {
    expect(readRequiredSecret({ NODE_ENV: "production", JWT_SECRET: REAL }, "JWT_SECRET")).toBe(REAL);
  });

  it.each(["development", "test"])("accepts an explicit dev value in %s", (mode) => {
    const value = "dev-only-jwt-secret-never-use-in-production";
    expect(readRequiredSecret({ NODE_ENV: mode, JWT_SECRET: value }, "JWT_SECRET")).toBe(value);
  });

  it("never puts the value in the error message", () => {
    const value = "short-marker-value";
    expect(() => readRequiredSecret({ NODE_ENV: "production", IP_HASH_SECRET: value }, "IP_HASH_SECRET")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(value) }),
    );
  });
});
