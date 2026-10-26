// legacy tables; update when RNX-251 lands
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";

const API_URL = "http://127.0.0.1:3351";
const ORIGIN = "http://127.0.0.1:4351";
const PASSWORD = "Rnx75-local-test-2026!";
const accounts = [
  { name: "RNX75 Individual", email: "rnx75-individual@local.test" },
  { name: "RNX75 Enterprise Owner", email: "rnx75-enterprise-owner@local.test" },
  { name: "RNX75 Enterprise Member", email: "rnx75-enterprise-member@local.test" },
] as const;
const url = process.env.DATABASE_URL ?? "";
const target = new URL(url);
if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "55437" || !/test|rnx75/i.test(target.pathname)) {
  throw new Error("Refusing fixtures: DATABASE_URL must be a local 127.0.0.1:55437 test database");
}

async function request(path: string, body: Record<string, string>) {
  const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  console.log(`${path} HTTP ${response.status}`);
}

for (const account of accounts) await request("/api/auth/better/sign-up/email", { ...account, password: PASSWORD });
await request("/api/auth/better/sign-in/email", { email: accounts[0].email, password: PASSWORD });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: accounts[1].email } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: accounts[2].email } });
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
  console.log("DB fixtures HTTP local");
  console.log(JSON.stringify({ owner: owner.email, member: member.email, workspace: workspace.id, plan: plan.slug }));
} finally { await prisma.$disconnect(); }
