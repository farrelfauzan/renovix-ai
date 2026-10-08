import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@generated/prisma/client.js";

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
