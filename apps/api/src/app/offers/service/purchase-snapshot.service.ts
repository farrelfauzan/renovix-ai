import { Injectable, NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import type { PurchaseSnapshot } from "@generated/prisma/client.js";
import { FRANKFURTER_SOURCE } from "../../exchange-rates/config/frankfurter-source";
import { ExchangeRateRepository } from "../../exchange-rates/repository/exchange-rate.repository";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { PackageRepository } from "../repository/package.repository";
import { PurchaseSnapshotRepository } from "../repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../repository/top-up-pack.repository";
import type { CodeGrantInput } from "../types/code-grant-input";
import type { PaidPurchaseInput } from "../types/paid-purchase-input";
import type { PurchaseInput } from "../types/purchase-input";
import { buildPurchasePriceColumns } from "../utils/build-purchase-price-columns";

/** RNX-251: the rate source recorded on a code grant when no rate was ever stored (its price is 0 either way). */
const NO_RATE_SOURCE = "none";

/**
 * Purchase snapshots (RX-86, D37): what a buyer bought, copied from the version in the same transaction, so
 * it stays correct whatever later versions say. Snapshots are append-only in the database. No checkout
 * calls these two yet; a checkout records with recordPaidPurchase (RNX-35). The rupiah amount charged is the version's USD price x the purchase rate (RNX-53, D235),
 * and the rate, its date and its source are stored on the snapshot; without a current rate the purchase is
 * refused (503) before anything is written.
 */
@Injectable()
export class PurchaseSnapshotService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly packs: TopUpPackRepository,
    private readonly snapshots: PurchaseSnapshotRepository,
    private readonly transactions: TransactionService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly rates: ExchangeRateRepository,
  ) {}

  /** Records the purchase of a package version: its price, credits and limits as they are now. 404 for an unknown version, 503 without a current rate. */
  async recordPackagePurchase(input: PurchaseInput, tx?: DbTransaction): Promise<PurchaseSnapshot> {
    const purchaseRate = await this.exchangeRates.getPurchaseRate();
    return this.transactions.run(async (db) => {
      const version = await this.packages.findVersionById(input.versionId, db);
      if (!version) throw new NotFoundException("Package version not found");
      const { priceUsdCents, creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled } = version;
      const copied = { creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled, ...buildPurchasePriceColumns(priceUsdCents, purchaseRate) };
      return this.snapshots.create({ ...copied, buyerUserId: input.buyerUserId, packageVersionId: version.id, paymentId: input.paymentId }, db);
    }, undefined, tx);
  }

  /** Records the purchase of a top-up pack version: its price and credits as they are now. 404 for an unknown version, 503 without a current rate. */
  async recordTopUpPurchase(input: PurchaseInput, tx?: DbTransaction): Promise<PurchaseSnapshot> {
    const purchaseRate = await this.exchangeRates.getPurchaseRate();
    return this.transactions.run(async (db) => {
      const version = await this.packs.findVersionById(input.versionId, db);
      if (!version) throw new NotFoundException("Top-up pack version not found");
      const copied = { creditsGranted: version.creditsGranted, allowedChannels: [], allowedTiers: [], ...buildPurchasePriceColumns(version.priceUsdCents, purchaseRate) };
      return this.snapshots.create({ ...copied, buyerUserId: input.buyerUserId, topUpPackVersionId: version.id, paymentId: input.paymentId }, db);
    }, undefined, tx);
  }

  /**
   * Records a paid checkout (RNX-35) in `tx`, the grant's transaction: the version's credits and limits as they are
   * (versions are append-only), and the price the order was quoted and paid at, not a new quote. 404 for an unknown version.
   */
  async recordPaidPurchase(input: PaidPurchaseInput, tx: DbTransaction): Promise<PurchaseSnapshot> {
    const { buyerUserId, packageVersionId, topUpPackVersionId, price, paymentId } = input;
    if (packageVersionId) {
      const version = await this.packages.findVersionById(packageVersionId, tx);
      if (!version) throw new NotFoundException("Package version not found");
      const { creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled } = version;
      return this.snapshots.create({ creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled, ...price, buyerUserId, packageVersionId, paymentId }, tx);
    }
    const version = topUpPackVersionId ? await this.packs.findVersionById(topUpPackVersionId, tx) : null;
    if (!version) throw new NotFoundException("Top-up pack version not found");
    return this.snapshots.create({ creditsGranted: version.creditsGranted, allowedChannels: [], allowedTiers: [], ...price, buyerUserId, topUpPackVersionId: version.id, paymentId }, tx);
  }

  /**
   * Records a package granted by an invitation code (RNX-251, D36, D37) in `tx`, the redemption's transaction: the
   * version's limits as they are, price 0 and no credits (a "both" code's credits go through the ledger). THE RULE: a
   * package snapshot with paymentId null is a code grant. The rate columns are only a record: the latest stored rate,
   * never a live fetch (a redemption is never refused for want of a rate); with no stored rate at all, 0 dated today
   * from source "none". 404 for an unknown version.
   */
  async recordCodeGrant(input: CodeGrantInput, tx: DbTransaction): Promise<PurchaseSnapshot> {
    const version = await this.packages.findVersionById(input.packageVersionId, tx);
    if (!version) throw new NotFoundException("Package version not found");
    const { billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled } = version;
    const latest = await this.rates.findLatest(FRANKFURTER_SOURCE.base, FRANKFURTER_SOURCE.quote);
    const rate = latest
      ? { exchangeRate: latest.rate, exchangeRateDate: latest.rateDate, exchangeRateSource: latest.source }
      : { exchangeRate: new Decimal(0), exchangeRateDate: new Date(), exchangeRateSource: NO_RATE_SOURCE };
    const limits = { billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers, collaborationEnabled };
    return this.snapshots.create({ ...limits, ...rate, priceUsdCents: 0, priceRupiah: 0, creditsGranted: 0, buyerUserId: input.buyerUserId, packageVersionId: version.id, paymentId: null }, tx);
  }
}
