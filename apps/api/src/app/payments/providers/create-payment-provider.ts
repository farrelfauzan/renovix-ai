import type { PaymentProvider } from "../types/payment-provider";
import type { PaymentProviderName } from "../types/payment-provider-name";
import { AutoGoPayProvider } from "./autogopay.provider";
import { FakePaymentProvider } from "./fake-payment.provider";
import { FetchAutoGoPayTransport } from "./fetch-autogopay.transport";

/**
 * The provider named by PAYMENT_PROVIDER (RNX-35). The fake signs webhooks with PAYMENT_FAKE_WEBHOOK_SECRET (local
 * development only); AutoGoPay (RNX-229) uses PAYMENT_PROVIDER_API_KEY, required at boot by resolvePaymentProviderName.
 */
export function createPaymentProvider(name: PaymentProviderName, env: NodeJS.ProcessEnv): PaymentProvider {
  switch (name) {
    case "fake":
      return new FakePaymentProvider({ webhookSecret: env.PAYMENT_FAKE_WEBHOOK_SECRET });
    case "autogopay": {
      const apiKey = env.PAYMENT_PROVIDER_API_KEY ?? "";
      return new AutoGoPayProvider({ apiKey, transport: new FetchAutoGoPayTransport(apiKey) });
    }
  }
}
