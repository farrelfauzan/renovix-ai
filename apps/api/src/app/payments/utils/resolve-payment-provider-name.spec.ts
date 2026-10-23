import { resolvePaymentProviderName } from "./resolve-payment-provider-name";

// RNX-35, RNX-229: PAYMENT_PROVIDER is checked at boot. Made-up environments and obviously fake keys only.
const TEST_KEY = "test-autogopay-key-not-real";

describe("resolvePaymentProviderName (RNX-35)", () => {
  it.each([
    ["unset outside production", { NODE_ENV: "development" }],
    ["unset in tests", { NODE_ENV: "test" }],
    ["fake outside production", { NODE_ENV: "development", PAYMENT_PROVIDER: "fake" }],
    ["fake in production with PAYMENTS_FORCE_OFF=true", { NODE_ENV: "production", PAYMENT_PROVIDER: "fake", PAYMENTS_FORCE_OFF: "true" }],
  ])("%s: fake", (_case, env) => {
    expect(resolvePaymentProviderName(env)).toBe("fake");
  });

  it.each([
    ["in development", { NODE_ENV: "development", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: TEST_KEY }],
    ["in tests", { NODE_ENV: "test", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: TEST_KEY }],
    ["in production", { NODE_ENV: "production", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: TEST_KEY }],
    ["in production with PAYMENTS_FORCE_OFF=true", { NODE_ENV: "production", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: TEST_KEY, PAYMENTS_FORCE_OFF: "true" }],
  ])("autogopay with its key %s: autogopay (RNX-229)", (_case, env) => {
    expect(resolvePaymentProviderName(env)).toBe("autogopay");
  });

  it.each([
    ["unset in production", { NODE_ENV: "production" }, "PAYMENT_PROVIDER must be set in production"],
    ["unknown outside production", { NODE_ENV: "development", PAYMENT_PROVIDER: "midtrans" }, 'PAYMENT_PROVIDER must be "fake" or "autogopay" (got "midtrans")'],
    ["unknown in production", { NODE_ENV: "production", PAYMENT_PROVIDER: "stripe", PAYMENTS_FORCE_OFF: "true" }, 'PAYMENT_PROVIDER must be "fake" or "autogopay" (got "stripe")'],
    ["fake in production without the force-off", { NODE_ENV: "production", PAYMENT_PROVIDER: "fake" }, "PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true"],
    ["fake in production with PAYMENTS_FORCE_OFF=1", { NODE_ENV: "production", PAYMENT_PROVIDER: "fake", PAYMENTS_FORCE_OFF: "1" }, "PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true"],
  ])("%s: refuses to boot", (_case, env, message) => {
    expect(() => resolvePaymentProviderName(env)).toThrow(message);
  });

  it.each([
    ["missing in production", { NODE_ENV: "production", PAYMENT_PROVIDER: "autogopay" }],
    ["missing in development", { NODE_ENV: "development", PAYMENT_PROVIDER: "autogopay" }],
    ["empty", { NODE_ENV: "production", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: "" }],
    ["blank", { NODE_ENV: "test", PAYMENT_PROVIDER: "autogopay", PAYMENT_PROVIDER_API_KEY: "   " }],
    ["missing with payments forced off", { NODE_ENV: "production", PAYMENT_PROVIDER: "autogopay", PAYMENTS_FORCE_OFF: "true" }],
  ])("autogopay with its key %s: refuses to boot, naming the variable (RNX-229)", (_case, env) => {
    expect(() => resolvePaymentProviderName(env)).toThrow("PAYMENT_PROVIDER_API_KEY is required when PAYMENT_PROVIDER=autogopay and is not set");
  });
});
