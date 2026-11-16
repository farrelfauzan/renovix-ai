import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthController } from "./auth.controller";
import { AuthService } from "../service/auth.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { ReminderController } from "../../reminder/controller/reminder.controller";
import { ReminderService } from "../../reminder/service/reminder.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-77a: Settings > General saves the Profile and Preferences sections through PATCH /auth/me, which is strict
// (unknown keys refused), checks the language, country and timezone, and accepts a default model tier only when the
// account's packages allow it. Real controllers and services, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

type SessionUser = { id: string; email: string };

describe("RNX-77a: PATCH /auth/me, Settings > General (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AuthController, ReminderController],
      providers: [AuthService, EntitlementService, ReminderService, AgentRunPolicyService, WorkspaceQuotaService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const patchMe = (user: SessionUser, payload: object) =>
    app.inject({ method: "PATCH", url: "/auth/me", headers: asSessionUser(user), payload });

  const getMe = (user: SessionUser) => app.inject({ method: "GET", url: "/auth/me", headers: asSessionUser(user) });

  /** The columns Settings > General writes, as stored. */
  const readSettings = (userId: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, role: true, jobTitle: true, phone: true, signupGoal: true, locale: true, country: true, timezone: true, defaultModelTier: true },
    });

  /** A user who already has saved settings (non-default values), so a refused PATCH can be checked against them. */
  const createSettledUser = () =>
    createUser(prisma, {
      name: "Dewi Anggraini",
      role: "Finance",
      jobTitle: "Controller",
      phone: "+62 811 0000 1111",
      signupGoal: "Data analysis",
      locale: "id",
      country: "ID",
      timezone: "Asia/Makassar",
      defaultModelTier: "standard",
    });

  const profileSection = {
    name: "Rina Wulandari",
    role: "Operations",
    jobTitle: "Operations Manager",
    phone: "+62 812 3456 4471",
    signupGoal: "Reports and documents, Automation and reminders",
  };

  describe("AC1: each Profile and Preferences field is stored and shown again", () => {
    it("the Profile section's fields: 200, stored, and GET /auth/me returns them", async () => {
      const user = await createSettledUser();

      const res = await patchMe(user, profileSection);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject(profileSection);
      expect(await readSettings(user.id)).toMatchObject(profileSection);
      expect((await getMe(user)).json()).toMatchObject(profileSection);
    });

    it("the Preferences section's fields (a tier the package allows): 200, stored, and GET /auth/me returns them", async () => {
      const user = await createSettledUser();
      await createPackageSnapshot(prisma, { userId: user.id, allowedTiers: ["advanced", "premium"] });
      const preferences = { locale: "en", country: "SG", timezone: "Asia/Singapore", defaultModelTier: "premium" };

      const res = await patchMe(user, preferences);

      expect(res.statusCode).toBe(200);
      expect(await readSettings(user.id)).toMatchObject(preferences);
      expect((await getMe(user)).json()).toMatchObject(preferences);
    });

    it("control: the cheapest tier, which every account keeps, is accepted for a free user", async () => {
      const user = await createUser(prisma);

      const res = await patchMe(user, { defaultModelTier: "standard" });

      expect(res.statusCode).toBe(200);
      expect((await readSettings(user.id)).defaultModelTier).toBe("standard");
    });
  });

  describe("AC2: a default tier the account's packages do not allow is refused", () => {
    it("negative: a free user setting Premium gets 400 PACKAGE_LIMIT_REACHED and nothing changes (also not the other field)", async () => {
      const user = await createSettledUser();
      const before = await readSettings(user.id);

      const res = await patchMe(user, { defaultModelTier: "premium", timezone: "Europe/Berlin" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { type: "PACKAGE_LIMIT_REACHED", feature: "tier", requested: ["premium"] } });
      expect(await readSettings(user.id)).toEqual(before);
    });

    it("negative: a package with Advanced only does not allow Premium either", async () => {
      const user = await createSettledUser();
      await createPackageSnapshot(prisma, { userId: user.id, allowedTiers: ["advanced"] });
      const before = await readSettings(user.id);

      const res = await patchMe(user, { defaultModelTier: "premium" });

      expect(res.statusCode).toBe(400);
      expect(await readSettings(user.id)).toEqual(before);
    });
  });

  it("AC3: a reminder scheduled after the timezone is saved uses that timezone", async () => {
    const user = await createUser(prisma, { timezone: "Asia/Jakarta" });
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Team" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const chatRoom = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });

    const saved = await patchMe(user, { timezone: "America/Sao_Paulo" });
    const res = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: asSessionUser(user),
      payload: { agentId: agent.id, channelId: channel.id, chatRoomId: chatRoom.id, prompt: "Daily summary", cronExpression: "0 8 * * *" },
    });

    expect(saved.statusCode).toBe(200);
    expect(res.statusCode).toBe(201);
    expect((await prisma.reminder.findFirstOrThrow()).timezone).toBe("America/Sao_Paulo");
  });

  describe("AC4: an unknown key, an invalid language, a non-ISO country or tier: 400 and nothing changes", () => {
    it.each([
      ["an unknown key", { name: "Rina", userId: "00000000-0000-4000-8000-000000000000" }],
      ["an unknown key (the photo is RNX-334)", { avatar: "https://example.test/a.png" }],
      ["a language outside the supported set", { locale: "fr" }],
      ["a regional language tag", { locale: "en-US" }],
      ["a country name instead of an ISO code", { country: "Indonesia" }],
      ["an unassigned country code", { country: "XX" }],
      ["a lower-case country code", { country: "sg" }],
      ["an unknown model tier", { defaultModelTier: "ultra" }],
      ["an offset instead of an IANA zone", { timezone: "+08:00" }],
      ["an empty role", { role: "  " }],
    ])("negative: %s", async (_name, change) => {
      const user = await createSettledUser();
      const before = await readSettings(user.id);

      const res = await patchMe(user, { ...profileSection, ...change });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.type).toBe("invalid_request_error");
      expect(await readSettings(user.id)).toEqual(before);
    });
  });
});
