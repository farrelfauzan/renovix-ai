import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { ProviderRouter } from "../../providers/provider-router";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-115: a whatsapp (GOWA) channel cannot be saved without a webhookSecret, because the
// webhook refuses every call for a channel that has none. Other channel types are unaffected.
// Made-up secrets only. The user has no subscription, so every channel type is allowed.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx115-test-jwt-secret";

const REQUIRED = "webhookSecret is required for a whatsapp (GOWA) channel";

describe("RX-115: saving a whatsapp (GOWA) channel needs a webhookSecret (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController],
      providers: [AgentService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const setup = async () => {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const headers = {
      authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
    };
    return { agent, headers };
  };

  describe("POST /agents/:id/channels", () => {
    it.each([
      ["no config", undefined],
      ["a config without webhookSecret", { phoneNumber: "628111000111" }],
      ["an empty webhookSecret", { phoneNumber: "628111000111", webhookSecret: "" }],
      ["a webhookSecret that is not a string", { phoneNumber: "628111000111", webhookSecret: 12345 }],
    ])("whatsapp with %s: 400 validation error, no channel saved", async (_name, config) => {
      const { agent, headers } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers,
        payload: { channelType: "whatsapp", config },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toBe("Invalid request body");
      expect(res.body).toContain(REQUIRED);
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("whatsapp with a webhookSecret is saved (positive control)", async () => {
      const { agent, headers } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers,
        payload: { channelType: "whatsapp", config: { phoneNumber: "628111000111", webhookSecret: "made-up-secret" } },
      });

      expect(res.statusCode).toBe(201);
      expect(await prisma.agentChannel.count({ where: { agentId: agent.id, channelType: "whatsapp" } })).toBe(1);
    });

    it.each(["web", "api"])("%s without a webhookSecret is saved as before", async (channelType) => {
      const { agent, headers } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers,
        payload: { channelType },
      });

      expect(res.statusCode).toBe(201);
      expect(await prisma.agentChannel.count({ where: { agentId: agent.id, channelType } })).toBe(1);
    });
  });

  describe("PATCH /agents/:id/channels/:channelId (the body is the new config)", () => {
    const SAVED = { phoneNumber: "628111000111", webhookSecret: "made-up-secret" };

    it.each([
      ["a config without webhookSecret", { phoneNumber: "628111000999" }],
      ["an empty webhookSecret", { phoneNumber: "628111000999", webhookSecret: "" }],
    ])("whatsapp with %s: 400 validation error, config unchanged", async (_name, config) => {
      const { agent, headers } = await setup();
      const channel = await prisma.agentChannel.create({
        data: { agentId: agent.id, channelType: "whatsapp", config: SAVED },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/channels/${channel.id}`,
        headers,
        payload: config,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toBe("Invalid request body");
      expect(res.body).toContain(REQUIRED);
      expect((await prisma.agentChannel.findUnique({ where: { id: channel.id } }))?.config).toEqual(SAVED);
    });

    it("whatsapp with a webhookSecret is updated (positive control)", async () => {
      const { agent, headers } = await setup();
      const channel = await prisma.agentChannel.create({
        data: { agentId: agent.id, channelType: "whatsapp", config: SAVED },
      });
      const config = { phoneNumber: "628111000999", webhookSecret: "another-made-up-secret" };

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/channels/${channel.id}`,
        headers,
        payload: config,
      });

      expect(res.statusCode).toBe(200);
      expect((await prisma.agentChannel.findUnique({ where: { id: channel.id } }))?.config).toEqual(config);
    });

    it("web without a webhookSecret is updated as before", async () => {
      const { agent, headers } = await setup();
      const channel = await prisma.agentChannel.create({
        data: { agentId: agent.id, channelType: "web", config: {} },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/channels/${channel.id}`,
        headers,
        payload: { theme: "dark" },
      });

      expect(res.statusCode).toBe(200);
      expect((await prisma.agentChannel.findUnique({ where: { id: channel.id } }))?.config).toEqual({ theme: "dark" });
    });
  });
});
