import { randomBytes } from "node:crypto";
import { ProviderKeyCryptoService } from "./provider-key-crypto.service";

// RX-177: provider keys at rest. Obviously fake keys only.
describe("ProviderKeyCryptoService", () => {
  const inputKey = "fake-provider-key-rx177-Q9Z7";
  const savedEnv = { ...process.env };
  const buildService = (env: Record<string, string | undefined>) => {
    Object.assign(process.env, env);
    return new ProviderKeyCryptoService();
  };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("round-trips a sealed key and stamps LLM_KEY_VERSION (default 1)", () => {
    delete process.env.LLM_KEY_VERSION;
    const service = buildService({});

    const actualSealed = service.seal(inputKey);

    expect(service.reveal(actualSealed.ciphertext)).toBe(inputKey);
    expect(actualSealed.keyVersion).toBe(1);
    expect(actualSealed.ciphertext).not.toContain(inputKey);
  });

  it("stamps the configured LLM_KEY_VERSION", () => {
    expect(buildService({ LLM_KEY_VERSION: "3" }).seal(inputKey).keyVersion).toBe(3);
  });

  it("refuses an LLM_KEY_VERSION that is not a positive integer", () => {
    expect(() => buildService({ LLM_KEY_VERSION: "1.5" })).toThrow("LLM_KEY_VERSION must be a positive integer");
  });

  it("uses a fresh IV on every seal", () => {
    const service = buildService({});

    expect(service.seal(inputKey).ciphertext).not.toBe(service.seal(inputKey).ciphertext);
  });

  it("refuses a tampered ciphertext", () => {
    const service = buildService({});
    const tampered = Buffer.from(service.seal(inputKey).ciphertext, "base64");
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => service.reveal(tampered.toString("base64"))).toThrow();
  });

  it("refuses a truncated ciphertext", () => {
    const service = buildService({});
    const truncated = Buffer.from(service.seal(inputKey).ciphertext, "base64").subarray(0, 28);

    expect(() => service.reveal(truncated.toString("base64"))).toThrow("malformed");
  });

  it("refuses a value sealed under another key", () => {
    const sealed = buildService({}).seal(inputKey).ciphertext;
    const other = buildService({ LLM_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex") });

    expect(() => other.reveal(sealed)).toThrow();
  });

  it("refuses to start without LLM_KEY_ENCRYPTION_KEY, or with one that is not 32 bytes", () => {
    expect(() => buildService({ LLM_KEY_ENCRYPTION_KEY: "" })).toThrow("LLM_KEY_ENCRYPTION_KEY is required");
    expect(() => buildService({ LLM_KEY_ENCRYPTION_KEY: randomBytes(16).toString("hex") })).toThrow("exactly 32 bytes");
  });
});
