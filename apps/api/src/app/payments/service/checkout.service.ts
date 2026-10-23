import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { PaymentOrder } from "@generated/prisma/client.js";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { PackageRepository } from "../../offers/repository/package.repository";
import { TopUpPackRepository } from "../../offers/repository/top-up-pack.repository";
import { buildPurchasePriceColumns } from "../../offers/utils/build-purchase-price-columns";
import { TransactionService } from "../../prisma/transaction.service";
import { PAYMENT_PROVIDER } from "../config/payment-provider.token";
import { PAYMENTS_PAUSED_MESSAGE } from "../config/payments-paused-message";
import type { CheckoutBodyDto } from "../dto/checkout-body.dto";
import { PaymentOrderChangeRepository } from "../repository/payment-order-change.repository";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import type { BuyerOrderView } from "../types/buyer-order-view";
import type { CheckoutOffer } from "../types/checkout-offer";
import type { CreatedCharge } from "../types/created-charge";
import type { NewOrderInput } from "../types/new-order-input";
import type { PaymentProvider } from "../types/payment-provider";
import { errorNameOf } from "../utils/error-name-of";
import { findPaymentLimitProblem } from "../utils/find-payment-limit-problem";
import { jakartaDayRange } from "../utils/jakarta-day-range";
import { toBuyerOrderView } from "../utils/to-buyer-order-view";
import { toJakartaDay } from "../utils/to-jakarta-day";
import { PaymentSettingsService } from "./payment-settings.service";

const MINUTE_MS = 60_000;

/**
 * Checkout (RNX-35, docs/payments.md section 3): an order for a package (Starter or Pro, one-time, D23) or a top-up pack
 * (only with a package, D36), priced from the catalog at the purchase rate and snapshotted on the order. In order: the
 * kill switch and the pilot list, the offer, the limits' settings, the rate quote (before any transaction: a refused
 * quote is a 503 with nothing written), then one short transaction that sums today's totals under a lock and inserts
 * the order, and only then the provider call (outside any transaction). Every refusal before the insert calls no provider.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly packageOwnership: PackageOwnershipService,
    private readonly packages: PackageRepository,
    private readonly packs: TopUpPackRepository,
    private readonly exchangeRates: ExchangeRateService,
    private readonly orders: PaymentOrderRepository,
    private readonly changes: PaymentOrderChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Starts a checkout for the user; the pending order with its payment code. */
  async startCheckout(userId: string, body: CheckoutBodyDto): Promise<BuyerOrderView> {
    if (!(await this.paymentSettings.isEnabled())) throw new ServiceUnavailableException(PAYMENTS_PAUSED_MESSAGE);
    await this.paymentSettings.assertAllowedUser(userId);
    const offer = await this.findOffer(userId, body);
    const limits = await this.paymentSettings.getCheckoutLimits();
    const price = buildPurchasePriceColumns(offer.priceUsdCents, await this.exchangeRates.getPurchaseRate());
    const order = await this.createOrder({ userId, offer, price, limits });
    return toBuyerOrderView(await this.attachCharge(order, offer.description));
  }

  /** The buyer's own order; 404 for an unknown id or another user's order. */
  async getOrder(userId: string, orderId: string): Promise<BuyerOrderView> {
    const order = await this.orders.findForUser(orderId, userId);
    if (!order) throw new NotFoundException("Order not found");
    return toBuyerOrderView(order);
  }

  /** The current version of the offer asked for: 404 unless it is on sale, 400 for a monthly package, 403 for a pack without a package (D36). */
  private async findOffer(userId: string, body: CheckoutBodyDto): Promise<CheckoutOffer> {
    const now = new Date();
    if (body.offer === "package") {
      const found = await this.packages.findPurchasable(body.packageId, now);
      const version = found?.versions[0];
      if (!found || !version) throw new NotFoundException("Package not found");
      if (version.billing !== "one_time") throw new BadRequestException("Only a one-time package (Starter or Pro) can be bought here");
      return { packageVersionId: version.id, topUpPackVersionId: null, priceUsdCents: version.priceUsdCents, description: `Renovix AI ${found.name}` };
    }
    if (!(await this.packageOwnership.hasPackage(userId))) throw new ForbiddenException("A top-up pack needs a package; buy Starter or Pro first");
    const pack = await this.packs.findPurchasable(body.packId, now);
    const version = pack?.versions[0];
    if (!pack || !version) throw new NotFoundException("Top-up pack not found");
    return { packageVersionId: null, topUpPackVersionId: version.id, priceUsdCents: version.priceUsdCents, description: `Renovix AI ${pack.name}` };
  }

  /** Inserts the pending order in one transaction, under the checkout lock, after checking the limits against today's totals (422 naming the limit). */
  private createOrder(input: NewOrderInput): Promise<PaymentOrder> {
    const { userId, offer, price, limits } = input;
    return this.transactions.run(async (tx) => {
      await this.orders.lockCheckouts(tx);
      const today = jakartaDayRange(toJakartaDay(new Date()));
      const problem = findPaymentLimitProblem({
        amountRupiah: price.priceRupiah,
        limits,
        providerMinRupiah: this.provider.minAmountRupiah,
        providerMaxRupiah: this.provider.maxAmountRupiah,
        accountTodayRupiah: await this.orders.sumOpenAmount(today, userId, tx),
        platformTodayRupiah: await this.orders.sumOpenAmount(today, null, tx),
      });
      if (problem) throw new UnprocessableEntityException(`Checkout refused: ${problem}`);
      const { priceRupiah, ...quote } = price;
      const order = await this.orders.create(
        { userId, packageVersionId: offer.packageVersionId, topUpPackVersionId: offer.topUpPackVersionId, ...quote, amountRupiah: priceRupiah, provider: this.provider.name, expiresAt: new Date(Date.now() + limits.orderExpiryMinutes * MINUTE_MS) },
        tx,
      );
      await this.changes.create({ orderId: order.id, event: "created", toStatus: "pending", source: "checkout" }, tx);
      return order;
    });
  }

  /**
   * Asks the provider for the charge, outside any transaction; a refused charge fails the order (502). A charge that
   * cannot be stored is cancelled (a failing cancel is only logged) and the order fails, then the original error is rethrown.
   */
  private async attachCharge(order: PaymentOrder, description: string): Promise<PaymentOrder> {
    const charge = await this.requestCharge(order, description);
    if (!charge) {
      await this.failOrder(order.id);
      throw new BadGatewayException("The payment provider did not create the charge; please try again");
    }
    try {
      return await this.orders.attachCharge(order.id, charge);
    } catch (err) {
      await this.provider.cancel(charge.providerRef).catch((cancelErr: unknown) => this.logger.warn(`Payment order ${order.id}: cancelling the charge failed (${errorNameOf(cancelErr)})`));
      await this.failOrder(order.id);
      throw err;
    }
  }

  /** The created charge, or null when the provider refused or failed (only the error's class is logged). */
  private async requestCharge(order: PaymentOrder, description: string): Promise<CreatedCharge | null> {
    try {
      return await this.provider.createCharge({ orderId: order.id, amountRupiah: order.amountRupiah, expiresAt: order.expiresAt, description });
    } catch (err) {
      this.logger.warn(`Payment order ${order.id}: the provider did not create the charge (${errorNameOf(err)})`);
      return null;
    }
  }

  private async failOrder(orderId: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const fromStatus = await this.orders.moveStatus(orderId, ["pending"], "failed", tx);
      if (fromStatus) await this.changes.create({ orderId, event: "charge_failed", fromStatus, toStatus: "failed", source: "checkout" }, tx);
    });
  }
}
