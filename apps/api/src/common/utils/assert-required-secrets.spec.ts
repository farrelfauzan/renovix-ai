import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { assertRequiredSecrets } from "./assert-required-secrets";

// RX-110: the API refuses to start (bootstrap calls this first) without real auth and encryption secrets.
const productionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: randomBytes(48).toString("base64"),
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  IP_HASH_SECRET: randomBytes(48).toString("base64"),
  MCP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  MCP_OAUTH_STATE_SECRET: randomBytes(48).toString("base64"),
  LLM_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});

const SECRETS = ["JWT_SECRET", "BETTER_AUTH_SECRET", "IP_HASH_SECRET", "MCP_ENCRYPTION_KEY", "MCP_OAUTH_STATE_SECRET", "LLM_KEY_ENCRYPTION_KEY"];

describe("assertRequiredSecrets", () => {
  it("control: starts in production with real values", () => {
    expect(() => assertRequiredSecrets(productionEnv())).not.toThrow();
  });

  it.each(SECRETS)("refuses to start in production without %s", (name) => {
    const env = productionEnv();
    delete env[name];
    expect(() => assertRequiredSecrets(env)).toThrow(`${name} is required and is not set`);
  });

  it.each(SECRETS)("refuses to start in production when %s is empty", (name) => {
    expect(() => assertRequiredSecrets({ ...productionEnv(), [name]: "" })).toThrow(`${name} is required`);
  });

  it.each(["JWT_SECRET", "BETTER_AUTH_SECRET", "IP_HASH_SECRET", "MCP_OAUTH_STATE_SECRET"])(
    "refuses to start in production when %s is the placeholder \"change-me-in-production\"",
    (name) => {
      expect(() => assertRequiredSecrets({ ...productionEnv(), [name]: "change-me-in-production" })).toThrow(
        `${name} is a placeholder value`,
      );
    },
  );

  it.each(["JWT_SECRET", "BETTER_AUTH_SECRET", "IP_HASH_SECRET", "MCP_OAUTH_STATE_SECRET"])(
    "refuses to start in production when %s is shorter than 32 characters",
    (name) => {
      expect(() => assertRequiredSecrets({ ...productionEnv(), [name]: "x".repeat(31) })).toThrow(
        `${name} must have at least 32 characters`,
      );
    },
  );

  it("refuses to start in production when MCP_ENCRYPTION_KEY is not 32 bytes", () => {
    const env = { ...productionEnv(), MCP_ENCRYPTION_KEY: randomBytes(31).toString("hex") };
    expect(() => assertRequiredSecrets(env)).toThrow("MCP_ENCRYPTION_KEY must decode to exactly 32 bytes");
  });

  // RX-177 (AC10): the provider key encryption key is required and must be 32 bytes.
  it("refuses to start in production when LLM_KEY_ENCRYPTION_KEY is not 32 bytes", () => {
    const env = { ...productionEnv(), LLM_KEY_ENCRYPTION_KEY: randomBytes(31).toString("hex") };
    expect(() => assertRequiredSecrets(env)).toThrow("LLM_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  });

  describe("the explicit dev values of .env.example", () => {
    const example = parse(readFileSync(join(__dirname, "../../../../../.env.example")));

    it.each(["development", "test"])("start the API in %s", (mode) => {
      expect(() => assertRequiredSecrets({ ...example, NODE_ENV: mode })).not.toThrow();
    });

    it("refuse to start it in production", () => {
      expect(() => assertRequiredSecrets({ ...example, NODE_ENV: "production" })).toThrow("placeholder value");
    });

    it("RX-177: its LLM_KEY_ENCRYPTION_KEY is refused in production", () => {
      const env = { ...productionEnv(), LLM_KEY_ENCRYPTION_KEY: example.LLM_KEY_ENCRYPTION_KEY };
      expect(() => assertRequiredSecrets(env)).toThrow("LLM_KEY_ENCRYPTION_KEY is a placeholder value");
    });
  });
});
