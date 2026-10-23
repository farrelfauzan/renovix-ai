import { createHmac } from "node:crypto";
import { autoGoPayFixtures as fx } from "../../../../test/autogopay-fixtures";
import { createPaymentProvider } from "./create-payment-provider";

// RNX-229: the factory builds each provider from its own variables. Nothing is called: building makes no request.
describe("createPaymentProvider (RNX-229)", () => {
  it("builds the fake for fake", () => {
    expect(createPaymentProvider("fake", {}).name).toBe("fake");
  });

  it("builds AutoGoPay keyed with PAYMENT_PROVIDER_API_KEY (its webhooks verify under that key)", async () => {
    const provider = createPaymentProvider("autogopay", { PAYMENT_PROVIDER_API_KEY: fx.apiKey });
    const raw = fx.webhook.rawBody;
    const signature = createHmac("sha256", fx.apiKey).update(raw).digest("hex");

    const actual = await provider.verifyWebhook({ rawBody: Buffer.from(raw), headers: { "x-signature": signature } });

    expect(provider.name).toBe("autogopay");
    expect(actual.isVerified).toBe(true);
  });
});
