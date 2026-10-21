import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@generated/prisma/client.js";

// RNX-228: seeds model calls (a usage ledger entry and its model_call_costs row, joined on call_id), purchase snapshots
// and purchase entries straight into the tables, for the usage, cost and profit reports. Made-up values only. The
// ledger rows are inserted with SQL (the table is append-only; inserts are allowed): balances are not kept consistent,
// since the reports never read them.

/** A credit account's id (a user's or a company's wallet), created when missing. */
export async function seedAccount(
  prisma: PrismaClient,
  { userId = null, companyId = null, wallet }: { userId?: string | null; companyId?: string | null; wallet: "paid" | "weekly_free" },
): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO credit_accounts (id, user_id, company_id, wallet, balance, updated_at)
    VALUES (${id}, ${userId}, ${companyId}, ${wallet}::"CreditWallet", 1000, now())`;
  return id;
}

/** One model call's cost figures in USD and rupiah, as decimal strings; null where the figure is unknown. */
export type SeedCost = { lowUsd: string | null; highUsd: string | null; lowIdr: string | null; highIdr: string | null };

/** One model call to seed: the usage entry (on `accountId`, by `memberUserId`) and its cost row. */
export type SeedCall = {
  readonly accountId: string;
  readonly wallet: "paid" | "weekly_free";
  readonly memberUserId: string;
  /** Credits charged, positive (the entry's amount is minus this). */
  readonly credits: string;
  readonly at: string;
  readonly providerId: string | null;
  readonly model: string;
  readonly tier: string;
  readonly workspaceId?: string | null;
  readonly tokens: { new: number; cached: number; out: number; reasoning: number | null };
  readonly cost: SeedCost;
};

/** Inserts the call's usage entry and its model_call_costs row with the same call_id; returns the call_id. */
export async function seedCall(prisma: PrismaClient, call: SeedCall): Promise<string> {
  const callId = `call-${randomUUID()}`;
  const { tokens, cost } = call;
  await prisma.$executeRaw`
    INSERT INTO credit_ledger_entries (id, account_id, wallet, seq, type, amount, balance_after, member_user_id, request_id, call_id,
      model_id, tier, rate_new, rate_cached, rate_out, tokens_new, tokens_cached, tokens_out, outcome, idempotency_key, created_at)
    VALUES (${randomUUID()}, ${call.accountId}, ${call.wallet}::"CreditWallet",
      (SELECT COALESCE(max(seq), 0) + 1 FROM credit_ledger_entries WHERE account_id = ${call.accountId}), 'usage',
      -(${call.credits}::numeric), 0, ${call.memberUserId}, ${`req-${callId}`}, ${callId}, ${call.model}, ${call.tier}, 1, 1, 1,
      ${tokens.new}, ${tokens.cached}, ${tokens.out}, 'completed', ${callId}, ${call.at}::timestamptz)`;
  await prisma.$executeRaw`
    INSERT INTO model_call_costs (id, call_id, provider_id, provider_model_id, tokens_new, tokens_cached, tokens_out, tokens_reasoning,
      cost_low_usd, cost_high_usd, cost_low_idr, cost_high_idr, wallet, workspace_id, tier, created_at)
    VALUES (${randomUUID()}, ${callId}, ${call.providerId}, ${call.model}, ${tokens.new}, ${tokens.cached}, ${tokens.out}, ${tokens.reasoning},
      ${cost.lowUsd}::numeric, ${cost.highUsd}::numeric, ${cost.lowIdr}::numeric, ${cost.highIdr}::numeric, ${call.wallet}::"CreditWallet",
      ${call.workspaceId ?? null}, ${call.tier}, ${call.at}::timestamptz)`;
  return callId;
}

/** A package with one version; returns the version id. */
export async function seedPackageVersion(prisma: PrismaClient, { priceUsdCents, credits }: { priceUsdCents: number; credits: string }): Promise<string> {
  const pkg = await prisma.package.create({ data: { name: `package-${randomUUID()}`, displayOrder: 1, active: true, visible: true } });
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id, versionNumber: 1, priceUsdCents, creditsGranted: credits, billing: "monthly", maxAgents: 1, maxConnectedTools: 1,
      apiAccess: false, allowedChannels: [], allowedTiers: ["standard"], createdBy: "test", reason: "test",
    },
  });
  return version.id;
}

/** A purchase snapshot of a package version at `at`, and its paid-wallet top_up entry (reference = the payment id). */
export async function seedPurchase(
  prisma: PrismaClient,
  p: { buyerUserId: string; accountId: string; packageVersionId: string; priceUsdCents: number; priceRupiah: number; credits: string; at: string },
): Promise<string> {
  const paymentId = `pay-${randomUUID()}`;
  await prisma.$executeRaw`
    INSERT INTO purchase_snapshots (id, buyer_user_id, package_version_id, price_usd_cents, exchange_rate, exchange_rate_date, exchange_rate_source,
      price_rupiah, credits_granted, allowed_channels, allowed_tiers, payment_id, created_at)
    VALUES (${randomUUID()}, ${p.buyerUserId}, ${p.packageVersionId}, ${p.priceUsdCents}, 16500, ${p.at}::date, 'test', ${p.priceRupiah},
      ${p.credits}::numeric, ARRAY[]::text[], ARRAY[]::text[], ${paymentId}, ${p.at}::timestamptz)`;
  await prisma.$executeRaw`
    INSERT INTO credit_ledger_entries (id, account_id, wallet, seq, type, amount, balance_after, member_user_id, reference, idempotency_key, created_at)
    VALUES (${randomUUID()}, ${p.accountId}, 'paid', (SELECT COALESCE(max(seq), 0) + 1 FROM credit_ledger_entries WHERE account_id = ${p.accountId}),
      'top_up', ${p.credits}::numeric, ${p.credits}::numeric, ${p.buyerUserId}, ${paymentId}, ${`top_up:${paymentId}`}, ${p.at}::timestamptz)`;
  return paymentId;
}
