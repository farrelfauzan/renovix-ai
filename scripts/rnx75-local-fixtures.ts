// legacy tables; update when RNX-251 lands
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";

const url = process.env.DATABASE_URL ?? "";
const target = new URL(url);
if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "55437" || !/test|rnx75/i.test(target.pathname)) {
  throw new Error("Refusing fixtures: DATABASE_URL must be a local 127.0.0.1:55437 test database");
}
const ownerEmail = process.env.RNX75_ENTERPRISE_OWNER_EMAIL;
const memberEmail = process.env.RNX75_ENTERPRISE_MEMBER_EMAIL;
if (!ownerEmail || !memberEmail) throw new Error("Set RNX75_ENTERPRISE_OWNER_EMAIL and RNX75_ENTERPRISE_MEMBER_EMAIL");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
  const plan = await prisma.subscriptionPlan.upsert({
    where: { slug: "enterprise" },
    update: { name: "Enterprise", isActive: true },
    create: { slug: "enterprise", name: "Enterprise", maxAgents: 999, maxIntegrations: 999, maxWorkspaceUsers: 100, maxTokensPerMonth: BigInt(100_000_000), allowedChannels: ["web", "api"], priceMonthly: 0 },
  });
  const now = new Date();
  const end = new Date(now); end.setDate(end.getDate() + 30);
  await prisma.userSubscription.upsert({ where: { userId: owner.id }, update: { planId: plan.id, status: "active", currentPeriodStart: now, currentPeriodEnd: end }, create: { userId: owner.id, planId: plan.id, status: "active", currentPeriodStart: now, currentPeriodEnd: end } });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { ownerId: owner.id, isDefault: true } });
  await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } }, update: { role: "member", status: "active", joinedAt: now }, create: { workspaceId: workspace.id, userId: member.id, role: "member", status: "active", joinedAt: now } });
  console.log(JSON.stringify({ owner: owner.email, member: member.email, workspace: workspace.id, plan: plan.slug }));
} finally { await prisma.$disconnect(); }
