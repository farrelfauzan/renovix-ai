// Offer catalog and platform settings seed (RX-86). Reads prisma/offers.seed.json (or the file given as the
// first argument), validates it with Zod, and applies it through the offers services in one transaction:
// every change is validated and writes its change record, by "seed:<SEED_OPERATOR>" (default "seed:seed")
// with the file's reason. Idempotent: running it again with the same file writes nothing; changed terms
// create a new version. No price, credit amount or limit is written in code: they come from the file.
//
// It writes to the database that DATABASE_URL names (from the environment or .env). Check it first.
//   SEED_OPERATOR=<your name> bun run seed:offers [path/to/file.json]
import "dotenv/config";
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import type { PrismaService } from "../apps/api/src/app/prisma/prisma.service";
import { TransactionService } from "../apps/api/src/app/prisma/transaction.service";
import { OfferSeedDto } from "../apps/api/src/app/offers/dto/offer-seed.dto";
import { CatalogChangeRepository } from "../apps/api/src/app/offers/repository/catalog-change.repository";
import { EnterpriseBundleRepository } from "../apps/api/src/app/offers/repository/enterprise-bundle.repository";
import { PackageRepository } from "../apps/api/src/app/offers/repository/package.repository";
import { PlatformSettingRepository } from "../apps/api/src/app/offers/repository/platform-setting.repository";
import { TopUpPackRepository } from "../apps/api/src/app/offers/repository/top-up-pack.repository";
import { OfferCatalogService } from "../apps/api/src/app/offers/service/offer-catalog.service";
import { OfferSeedService } from "../apps/api/src/app/offers/service/offer-seed.service";
import { PlatformSettingsService } from "../apps/api/src/app/offers/service/platform-settings.service";

const file = resolve(process.argv[2] ?? resolve(import.meta.dirname, "offers.seed.json"));
const operator = process.env.SEED_OPERATOR?.trim() || "seed";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const parsed = OfferSeedDto.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.success) {
  console.error(`${file} is not valid; nothing written:`);
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const target = new URL(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }) as unknown as PrismaService;
const transactions = new TransactionService(prisma);
const changes = new CatalogChangeRepository();
const catalog = new OfferCatalogService(new PackageRepository(prisma), new TopUpPackRepository(prisma), new EnterpriseBundleRepository(prisma), changes, transactions);
const settings = new PlatformSettingsService(new PlatformSettingRepository(prisma), changes, transactions);
try {
  const before = await prisma.catalogChange.count();
  await new OfferSeedService(catalog, settings, transactions).applySeed(parsed.data, operator);
  // RNX-91: the legacy subscription_plans rows, upserted by slug (idempotent; the runtime still reads them).
  for (const plan of parsed.data.subscriptionPlans ?? []) {
    const data = { ...plan, maxTokensPerMonth: BigInt(plan.maxTokensPerMonth) };
    await prisma.subscriptionPlan.upsert({ where: { slug: plan.slug }, update: data, create: data });
  }
  const written = (await prisma.catalogChange.count()) - before;
  console.log(`Applied ${file} as "seed:${operator}" to database "${target.pathname.slice(1)}" on ${target.hostname}:${target.port || 5432}: ${written} change record(s) written.`);
} finally {
  await prisma.$disconnect();
}
