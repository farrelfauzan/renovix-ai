import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@generated/prisma/client.js";
import { ProviderKeyCryptoService } from "../src/app/admin-providers/service/provider-key-crypto.service";
import { API_KEY_FORMAT } from "../src/app/auth/config/api-key-format";
import { MODEL_TIERS } from "../src/app/offers/config/model-tiers";
import { hashApiKey } from "../src/app/auth/utils/hash-api-key";
import { ensureDefaultWorkspace } from "../src/app/workspace/repository/ensure-default-workspace";

// Small factories for the test database: required fields only, unique values
// by default, any field can be overridden.

const unique = () => randomUUID().slice(0, 8);

export function createUser(
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  return prisma.user.create({
    data: { email: `user-${unique()}@test.local`, ...data },
  });
}

/**
 * A fixed, well-formed API key for a spec (RNX-18): `rnx_live_` + 76 hex characters derived from `seed`, so a spec
 * can name its key in a constant. Different seeds give different prefixes. Store it with `createApiKey`.
 */
export function testApiKey(seed: string): string {
  const hex = createHash("sha512").update(seed).digest("hex");
  return `${API_KEY_FORMAT.marker}${hex.slice(0, API_KEY_FORMAT.randomBytes * 2)}`;
}

/**
 * An API key of this user (RNX-18), stored as the API stores one: its prefix and its HMAC under the test
 * API_KEY_HASH_SECRET (setup-env.ts), never the plaintext. Returns the plaintext: `apiKey` when given (e.g. from
 * `testApiKey`), else a random key. `revokedAt`, `expiresAt` and `name` can be set. RNX-232: the key may call every
 * tier unless `allowedTiers` is given, and has no monthly cap unless `monthlyCreditCap` is given.
 */
export async function createApiKey(
  prisma: PrismaClient,
  userId: string,
  {
    apiKey,
    ...data
  }: Partial<Pick<Prisma.ApiKeyUncheckedCreateInput, "name" | "revokedAt" | "expiresAt" | "allowedTiers" | "monthlyCreditCap">> & {
    apiKey?: string;
  } = {},
): Promise<string> {
  const plaintext = apiKey ?? `${API_KEY_FORMAT.marker}${randomBytes(API_KEY_FORMAT.randomBytes).toString("hex")}`;
  const prefixStart = API_KEY_FORMAT.marker.length;
  await prisma.apiKey.create({
    data: {
      userId,
      name: `key-${unique()}`,
      prefix: plaintext.slice(prefixStart, prefixStart + API_KEY_FORMAT.prefixLength),
      keyHash: hashApiKey(plaintext, process.env.API_KEY_HASH_SECRET as string),
      allowedTiers: [...MODEL_TIERS],
      ...data,
    },
  });
  return plaintext;
}

export function createPlan(
  prisma: PrismaClient,
  data: Partial<Prisma.SubscriptionPlanUncheckedCreateInput> = {},
) {
  const slug = data.slug ?? `plan-${unique()}`;
  return prisma.subscriptionPlan.create({
    data: {
      slug,
      name: slug,
      maxAgents: 3,
      maxIntegrations: 1,
      maxWorkspaceUsers: 3,
      maxTokensPerMonth: 1_000_000n,
      allowedChannels: ["web"],
      ...data,
    },
  });
}

export function createSubscription(
  prisma: PrismaClient,
  data: Pick<Prisma.UserSubscriptionUncheckedCreateInput, "userId" | "planId"> &
    Partial<Prisma.UserSubscriptionUncheckedCreateInput>,
) {
  const now = Date.now();
  return prisma.userSubscription.create({
    data: {
      currentPeriodStart: new Date(now),
      currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000),
      ...data,
    },
  });
}

/**
 * A purchased package (RNX-76 B1): a package, its version and the buyer's purchase snapshot, which is what
 * EntitlementService reads. Not a UserSubscription. Pass `maxAgents` / `maxConnectedTools` / `displayOrder` /
 * `apiAccess` / `allowedTiers` / `allowedChannels` (RNX-76 B2) to override.
 */
export async function createPackageSnapshot(
  prisma: PrismaClient,
  { userId, maxAgents = 3, maxConnectedTools = 1, displayOrder = 1, name, apiAccess = false, allowedTiers = ["standard"], allowedChannels = ["web"] }: {
    userId: string; maxAgents?: number; maxConnectedTools?: number; displayOrder?: number; name?: string;
    apiAccess?: boolean; allowedTiers?: string[]; allowedChannels?: string[];
  },
) {
  const pkg = await prisma.package.create({ data: { name: name ?? `pkg-${unique()}`, displayOrder, active: true, visible: true } });
  const version = await prisma.packageVersion.create({
    data: {
      packageId: pkg.id, versionNumber: 1, priceUsdCents: 100, creditsGranted: 10, billing: "one_time",
      maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers,
      createdBy: "test", reason: "RNX-76",
    },
  });
  return prisma.purchaseSnapshot.create({
    data: {
      buyerUserId: userId, packageVersionId: version.id, priceUsdCents: 100, exchangeRate: 16500,
      exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 165000, creditsGranted: 10,
      maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers,
    },
  });
}

/** An agent; without a `workspaceId` it goes into its user's default workspace, created if needed (RNX-117). */
export async function createAgent(
  prisma: PrismaClient,
  data: Pick<Prisma.AgentUncheckedCreateInput, "userId"> &
    Partial<Prisma.AgentUncheckedCreateInput>,
) {
  const slug = data.slug ?? `agent-${unique()}`;
  const workspaceId = data.workspaceId ?? (await ensureDefaultWorkspace(prisma, data.userId)).id;
  return prisma.agent.create({
    data: {
      name: slug,
      slug,
      systemPrompt: "You are a test agent.",
      model: "test-model",
      ...data,
      workspaceId,
    },
  });
}

export function createWorkspace(
  prisma: PrismaClient,
  data: Pick<Prisma.WorkspaceUncheckedCreateInput, "ownerId"> &
    Partial<Prisma.WorkspaceUncheckedCreateInput>,
) {
  const slug = data.slug ?? `workspace-${unique()}`;
  return prisma.workspace.create({ data: { name: slug, slug, ...data } });
}

/**
 * A provider record (RX-177) of the fake provider: an OpenAI-compatible entry on a base URL that does not
 * resolve, with an obviously fake key sealed under the test LLM_KEY_ENCRYPTION_KEY (setup-env.ts). Tests
 * reach it through FakeProviderAdapter only. `apiKey` sets the plaintext key; an admin id is required.
 */
export function createProvider(
  prisma: PrismaClient,
  { apiKey = `fake-provider-key-${unique()}`, ...data }: Pick<Prisma.ProviderUncheckedCreateInput, "createdByAdminId"> &
    Partial<Prisma.ProviderUncheckedCreateInput> & { apiKey?: string },
) {
  const sealed = new ProviderKeyCryptoService().seal(apiKey);
  return prisma.provider.create({
    data: {
      type: "openai_compatible",
      name: `provider-${unique()}`,
      baseUrl: "http://fake-provider.invalid/v1",
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyHint: apiKey.slice(-4),
      credentialKeyVersion: sealed.keyVersion,
      updatedByAdminId: data.createdByAdminId,
      ...data,
    },
  });
}

/** A model on a provider record (RX-177): a standard-tier fake slug, active, with small prices. */
export function createModel(
  prisma: PrismaClient,
  data: Pick<Prisma.AiModelUncheckedCreateInput, "providerRecordId"> &
    Partial<Prisma.AiModelUncheckedCreateInput>,
) {
  const slug = data.slug ?? `fake/model-${unique()}`;
  return prisma.aiModel.create({
    data: {
      slug,
      modelName: slug,
      inputPrice: "0.000001",
      outputPrice: "0.000002",
      maxTokens: 8192,
      tier: "standard",
      active: true,
      ...data,
    },
  });
}
