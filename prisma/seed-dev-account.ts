// Dev-only account seed (RNX-355). Gives ONE EXISTING local account a package and a small paid credit balance, through a
// single-use "both" code redeemed for it (the package terms and the default credits come from prisma/dev-account.seed.json).
// Run `bun run seed` first (it creates the Starter package). It never creates a user, refuses NODE_ENV=production (no
// override), and a second run for the same account writes nothing.
//
// It writes to the database that DATABASE_URL names (from the environment or .env). Check it first.
//   bun run seed:dev-account <email> [credits]
import "dotenv/config";
import "reflect-metadata";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import type { PrismaService } from "../apps/api/src/app/prisma/prisma.service";
import { TransactionService } from "../apps/api/src/app/prisma/transaction.service";
import { AdminNotificationRepository } from "../apps/api/src/app/admin-auth/repository/admin-notification.repository";
import { UserRepository } from "../apps/api/src/app/auth/repository/user.repository";
import { CreditAccountRepository } from "../apps/api/src/app/billing/repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../apps/api/src/app/billing/repository/credit-ledger-entry.repository";
import { CreditLedgerService } from "../apps/api/src/app/billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../apps/api/src/app/billing/service/package-ownership.service";
import { CodeRedemptionRepository } from "../apps/api/src/app/codes/repository/code-redemption.repository";
import { InvitationCodeRepository } from "../apps/api/src/app/codes/repository/invitation-code.repository";
import { CodesService } from "../apps/api/src/app/codes/service/codes.service";
import { DevAccountSeedService } from "../apps/api/src/app/dev-seed/service/dev-account-seed.service";
import { ExchangeRateRepository } from "../apps/api/src/app/exchange-rates/repository/exchange-rate.repository";
import { ExchangeRateService } from "../apps/api/src/app/exchange-rates/service/exchange-rate.service";
import { CatalogChangeRepository } from "../apps/api/src/app/offers/repository/catalog-change.repository";
import { EnterpriseBundleRepository } from "../apps/api/src/app/offers/repository/enterprise-bundle.repository";
import { PackageRepository } from "../apps/api/src/app/offers/repository/package.repository";
import { PlatformSettingRepository } from "../apps/api/src/app/offers/repository/platform-setting.repository";
import { PurchaseSnapshotRepository } from "../apps/api/src/app/offers/repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../apps/api/src/app/offers/repository/top-up-pack.repository";
import { OfferCatalogService } from "../apps/api/src/app/offers/service/offer-catalog.service";
import { PlatformSettingsService } from "../apps/api/src/app/offers/service/platform-settings.service";
import { PurchaseSnapshotService } from "../apps/api/src/app/offers/service/purchase-snapshot.service";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run the dev account seed with NODE_ENV=production; nothing written.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const [email, creditsArgument] = process.argv.slice(2);
const credits = creditsArgument === undefined ? undefined : Number(creditsArgument);
if (!email || (credits !== undefined && !(credits > 0))) {
  console.error("Usage: bun run seed:dev-account <email> [credits]  (credits: a positive number)");
  process.exit(1);
}
const target = new URL(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }) as unknown as PrismaService;
const transactions = new TransactionService(prisma);
const changes = new CatalogChangeRepository();
const packages = new PackageRepository(prisma);
const catalog = new OfferCatalogService(packages, new TopUpPackRepository(prisma), new EnterpriseBundleRepository(prisma), changes, transactions);
const rates = new ExchangeRateRepository(prisma);
const snapshots = new PurchaseSnapshotService(packages, new TopUpPackRepository(prisma), new PurchaseSnapshotRepository(prisma), transactions, new ExchangeRateService(rates, new AdminNotificationRepository(prisma)), rates);
const ledger = new CreditLedgerService(transactions, new CreditAccountRepository(prisma), new CreditLedgerEntryRepository(prisma));
const codeRows = new InvitationCodeRepository(prisma);
const redemptions = new CodeRedemptionRepository(prisma);
const codes = new CodesService(codeRows, redemptions, packages, snapshots, ledger, transactions, new PackageOwnershipService(new PurchaseSnapshotRepository(prisma)), new PlatformSettingsService(new PlatformSettingRepository(prisma), changes, transactions));
try {
  const result = await new DevAccountSeedService(new UserRepository(prisma), packages, codeRows, redemptions, catalog, codes).seedAccount({ email, credits });
  const where = `database "${target.pathname.slice(1)}" on ${target.hostname}:${target.port || 5432}`;
  console.log(result.outcome === "granted" ? `Granted a package and ${result.credits} credits to ${email} (code ${result.code}) in ${where}.` : `${email} is already seeded; nothing written (${where}).`);
} catch (err) {
  console.error(`Dev account seed failed; ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
