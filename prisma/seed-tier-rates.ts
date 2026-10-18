// Tier-rate seed (RX-21). Reads prisma/tier-rates.seed.json (or the file given as the first argument),
// validates it with Zod, and applies it through TierRateSeedService in one transaction: every write
// records a catalog_changes row, by "seed:<SEED_OPERATOR>" (default "seed:seed") with the file's reason.
// Idempotent: the same file twice writes nothing; a changed rate updates the row and writes a change
// record. The adopted rates (Standard 1/1/1, Advanced 5/4/6, Premium 10/11/20, Frontier 17/25/17)
// live only in the file, never in code.
//
// It writes to the database that DATABASE_URL names (from the environment or .env). Check it first.
//   SEED_OPERATOR=<your name> bun run seed:tier-rates [path/to/file.json]
import "dotenv/config";
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import type { PrismaService } from "../apps/api/src/app/prisma/prisma.service";
import { TransactionService } from "../apps/api/src/app/prisma/transaction.service";
import { CatalogChangeRepository } from "../apps/api/src/app/offers/repository/catalog-change.repository";
import { TierRateSeedDto } from "../apps/api/src/app/offers/dto/tier-rate-seed.dto";
import { TierRateSeedService } from "../apps/api/src/app/offers/service/tier-rate-seed.service";

const file = resolve(process.argv[2] ?? resolve(import.meta.dirname, "tier-rates.seed.json"));
const operator = process.env.SEED_OPERATOR?.trim() || "seed";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const parsed = TierRateSeedDto.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.success) {
  console.error(`${file} is not valid; nothing written:`);
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const target = new URL(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }) as unknown as PrismaService;
const transactions = new TransactionService(prisma);
const seeder = new TierRateSeedService(new CatalogChangeRepository(), transactions);
try {
  const before = await prisma.catalogChange.count();
  await seeder.applySeed(parsed.data, operator);
  const written = (await prisma.catalogChange.count()) - before;
  console.log(`Applied ${file} as "seed:${operator}" to database "${target.pathname.slice(1)}" on ${target.hostname}:${target.port || 5432}: ${written} change record(s) written.`);
} finally {
  await prisma.$disconnect();
}
