import { randomBytes } from "node:crypto";
import { readEncryptionKey } from "./read-encryption-key";

// RX-110: MCP_ENCRYPTION_KEY decodes to exactly 32 bytes; no padding, no truncation, no fallback.
const NAME = "MCP_ENCRYPTION_KEY";
const read = (value: string | undefined, mode = "production") =>
  readEncryptionKey({ NODE_ENV: mode, [NAME]: value }, NAME);

describe("readEncryptionKey", () => {
  const raw = randomBytes(32);

  it("accepts 64 hex characters as the 32 bytes they encode", () => {
    expect(read(raw.toString("hex")).equals(raw)).toBe(true);
  });

  it("accepts 44 base64 characters as the 32 bytes they encode", () => {
    expect(read(raw.toString("base64")).equals(raw)).toBe(true);
  });

  it("refuses the old hard-coded fallback: a placeholder in production, not 32 bytes in development", () => {
    const oldFallback = "default-dev-key-32-bytes-long!!";
    expect(() => read(oldFallback, "production")).toThrow(`${NAME} is a placeholder value`);
    expect(() => read(oldFallback, "development")).toThrow(`${NAME} must decode to exactly 32 bytes`);
  });

  it.each([
    ["32 plain characters", "x".repeat(32)],
    ["31 bytes in hex", randomBytes(31).toString("hex")],
    ["33 bytes in hex", randomBytes(33).toString("hex")],
    ["16 bytes in base64", randomBytes(16).toString("base64")],
    ["48 bytes in base64", randomBytes(48).toString("base64")],
  ])("refuses %s, in production and in development", (_label, value) => {
    for (const mode of ["production", "development"]) {
      expect(() => read(value, mode)).toThrow(`${NAME} must decode to exactly 32 bytes`);
    }
  });

  it("refuses a missing key in development too (no fallback)", () => {
    expect(() => read(undefined, "development")).toThrow(`${NAME} is required and is not set`);
  });

  it("refuses the .env.example dev key in production and accepts it in development", () => {
    const devKey = "0".repeat(63) + "1";
    expect(() => read(devKey, "production")).toThrow(`${NAME} is a placeholder value`);
    expect(read(devKey, "development")).toHaveLength(32);
  });
});
