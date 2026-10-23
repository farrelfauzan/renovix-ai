import type { PaymentOrder } from "@generated/prisma/client.js";
import type { PaidPurchaseInput } from "../../offers/types/paid-purchase-input";

/** The purchase snapshot input of a paid order (RNX-35): its buyer, version and the price it was quoted and paid at; the payment id is the provider reference. */
export function toPaidPurchaseInput(order: PaymentOrder, providerRef: string): PaidPurchaseInput {
  return {
    buyerUserId: order.userId,
    packageVersionId: order.packageVersionId,
    topUpPackVersionId: order.topUpPackVersionId,
    price: {
      priceUsdCents: order.priceUsdCents,
      exchangeRate: order.exchangeRate,
      exchangeRateDate: order.exchangeRateDate,
      exchangeRateSource: order.exchangeRateSource,
      priceRupiah: order.amountRupiah,
    },
    paymentId: providerRef,
  };
}
