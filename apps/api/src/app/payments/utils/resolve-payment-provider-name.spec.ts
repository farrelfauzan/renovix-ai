import { resolvePaymentProviderName } from "./resolve-payment-provider-name";

// RNX-35: PAYMENT_PROVIDER is checked at boot. Made-up environments only.
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
    ["unset in production", { NODE_ENV: "production" }, "PAYMENT_PROVIDER must be set in production"],
    ["unknown outside production", { NODE_ENV: "development", PAYMENT_PROVIDER: "autogopay" }, 'PAYMENT_PROVIDER must be "fake" (got "autogopay")'],
    ["unknown in production", { NODE_ENV: "production", PAYMENT_PROVIDER: "stripe", PAYMENTS_FORCE_OFF: "true" }, 'PAYMENT_PROVIDER must be "fake" (got "stripe")'],
    ["fake in production without the force-off", { NODE_ENV: "production", PAYMENT_PROVIDER: "fake" }, "PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true"],
    ["fake in production with PAYMENTS_FORCE_OFF=1", { NODE_ENV: "production", PAYMENT_PROVIDER: "fake", PAYMENTS_FORCE_OFF: "1" }, "PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true"],
  ])("%s: refuses to boot", (_case, env, message) => {
    expect(() => resolvePaymentProviderName(env)).toThrow(message);
  });
});
