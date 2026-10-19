import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@generated/prisma/client.js";
import { ProviderKeyCryptoService } from "../src/app/admin-providers/service/provider-key-crypto.service";

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

export function createAgent(
  prisma: PrismaClient,
  data: Pick<Prisma.AgentUncheckedCreateInput, "userId"> &
    Partial<Prisma.AgentUncheckedCreateInput>,
) {
  const slug = data.slug ?? `agent-${unique()}`;
  return prisma.agent.create({
    data: {
      name: slug,
      slug,
      systemPrompt: "You are a test agent.",
      model: "test-model",
      ...data,
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
