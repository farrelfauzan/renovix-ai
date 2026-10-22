import { Module } from "@nestjs/common";
import { CreditLedgerService } from "../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../billing/service/package-ownership.service";
import { ExchangeRatesModule } from "../exchange-rates/exchange-rates.module";
import { OffersModule } from "../offers/offers.module";
import { PAYMENT_PROVIDER } from "./config/payment-provider.token";
import { PaymentWebhookController } from "./controller/payment-webhook.controller";
import { PaymentsController } from "./controller/payments.controller";
import { createPaymentProvider } from "./providers/create-payment-provider";
import { PaymentReconciliationScheduler } from "./scheduler/payment-reconciliation.scheduler";
import { CheckoutService } from "./service/checkout.service";
import { PaymentReconciliationService } from "./service/payment-reconciliation.service";
import { PaymentSettingsService } from "./service/payment-settings.service";
import { PaymentSettlementService } from "./service/payment-settlement.service";
import { PaymentWebhookService } from "./service/payment-webhook.service";
import { resolvePaymentProviderName } from "./utils/resolve-payment-provider-name";

/**
 * Payments (RNX-35, D240, docs/payments.md): checkout, the provider webhook, the one settlement (grant) path and the
 * reconciliation job. The provider is chosen by PAYMENT_PROVIDER (checked at boot in main.ts too); only the fake
 * exists until the AutoGoPay adapter (RNX-229). CreditLedgerService and PackageOwnershipService need only global
 * providers, so they are provided here (as CodesModule does).
 */
@Module({
  imports: [OffersModule, ExchangeRatesModule],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [
    { provide: PAYMENT_PROVIDER, useFactory: () => createPaymentProvider(resolvePaymentProviderName(process.env), process.env) },
    PaymentSettingsService,
    CheckoutService,
    PaymentSettlementService,
    PaymentWebhookService,
    PaymentReconciliationService,
    PaymentReconciliationScheduler,
    CreditLedgerService,
    PackageOwnershipService,
  ],
})
export class PaymentsModule {}
