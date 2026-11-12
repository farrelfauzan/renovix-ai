import { randomBytes } from "node:crypto";
import { parseEnv } from "./parse-env";

// RNX-43: the environment is validated once at boot; every refusal names the variable and never its value.
const validEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: randomBytes(48).toString("base64"),
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  IP_HASH_SECRET: randomBytes(48).toString("base64"),
  MCP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  MCP_OAUTH_STATE_SECRET: randomBytes(48).toString("base64"),
  LLM_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  API_KEY_HASH_SECRET: randomBytes(48).toString("base64"),
  ADMIN_JWT_SECRET: randomBytes(48).toString("base64"),
  ADMIN_TOTP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});

const SECRETS = [
  "JWT_SECRET",
  "BETTER_AUTH_SECRET",
  "IP_HASH_SECRET",
  "MCP_ENCRYPTION_KEY",
  "MCP_OAUTH_STATE_SECRET",
  "LLM_KEY_ENCRYPTION_KEY",
  "API_KEY_HASH_SECRET",
  "ADMIN_JWT_SECRET",
  "ADMIN_TOTP_ENCRYPTION_KEY",
];

const messageOf = (env: NodeJS.ProcessEnv): string => {
  try {
    parseEnv(env);
  } catch (err) {
    return (err as Error).message;
  }
  return "";
};

describe("parseEnv", () => {
  it("control: nine valid secrets and no OPENROUTER_API_KEY start (AC3)", () => {
    const inputEnv = validEnv();
    expect(inputEnv.OPENROUTER_API_KEY).toBeUndefined();
    expect(() => parseEnv(inputEnv)).not.toThrow();
  });

  it.each(SECRETS)("AC1: refuses %s missing, and names it", (name) => {
    const inputEnv = validEnv();
    const secretValue = inputEnv[name] as string;
    delete inputEnv[name];
    const actualMessage = messageOf(inputEnv);
    expect(actualMessage).toContain(name);
    expect(actualMessage).not.toContain(secretValue);
  });

  it.each(SECRETS)("AC1: refuses %s empty, and names it", (name) => {
    const actualMessage = messageOf({ ...validEnv(), [name]: "" });
    expect(actualMessage).toContain(`${name} is required`);
  });

  it.each(SECRETS)("AC2: refuses %s with a leading space, and prints no value", (name) => {
    const inputEnv = validEnv();
    const inputValue = ` ${inputEnv[name]}`;
    const actualMessage = messageOf({ ...inputEnv, [name]: inputValue });
    expect(actualMessage).toContain(`${name} must not have leading or trailing whitespace`);
    expect(actualMessage).not.toContain(inputValue.trim());
  });

  it.each(SECRETS)("AC2: refuses %s with a trailing newline, and prints no value", (name) => {
    const inputEnv = validEnv();
    const inputValue = `${inputEnv[name]}\n`;
    const actualMessage = messageOf({ ...inputEnv, [name]: inputValue });
    expect(actualMessage).toContain(`${name} must not have leading or trailing whitespace`);
    expect(actualMessage).not.toContain(inputValue.trim());
  });

  it("AC2: refuses whitespace in development too (no trimming)", () => {
    const actualMessage = messageOf({ ...validEnv(), NODE_ENV: "development", MCP_ENCRYPTION_KEY: `${randomBytes(32).toString("hex")}\n` });
    expect(actualMessage).toContain("MCP_ENCRYPTION_KEY");
  });

  it("refuses an ADMIN_TOTP_ENCRYPTION_KEY that is not 32 bytes", () => {
    const actualMessage = messageOf({ ...validEnv(), ADMIN_TOTP_ENCRYPTION_KEY: randomBytes(16).toString("base64") });
    expect(actualMessage).toContain("ADMIN_TOTP_ENCRYPTION_KEY must be 32 bytes");
  });

  it("AC4: starts without S3_CDN_DOMAIN and S3_ENDPOINT", () => {
    const inputEnv = validEnv();
    expect(inputEnv.S3_CDN_DOMAIN).toBeUndefined();
    expect(inputEnv.S3_ENDPOINT).toBeUndefined();
    expect(() => parseEnv(inputEnv)).not.toThrow();
  });

  it("parses the typed values to their type, empty meaning unset", () => {
    const actualEnv = parseEnv({ ...validEnv(), PORT: "3100", SMTP_SECURE: "true", API_PUBLIC_URL: "https://api.renovix.test", LLM_KEY_VERSION: "" });
    expect(actualEnv).toMatchObject({ PORT: 3100, SMTP_SECURE: true, API_PUBLIC_URL: "https://api.renovix.test" });
    expect(actualEnv.LLM_KEY_VERSION).toBeUndefined();
  });

  it.each([
    ["PORT", "not-a-number"],
    ["SMTP_PORT", "0"],
    ["ANON_DAILY_IP_CAP", "12.5"],
    ["SMTP_SECURE", "yes"],
    ["API_PUBLIC_URL", "not a url"],
    ["S3_ENDPOINT", "localhost-without-scheme"],
  ])("AC5: refuses a malformed %s, naming it and not its value", (name, inputValue) => {
    const actualMessage = messageOf({ ...validEnv(), [name]: inputValue });
    expect(actualMessage).toContain(`${name} must be`);
    expect(actualMessage).not.toContain(inputValue);
  });
});
