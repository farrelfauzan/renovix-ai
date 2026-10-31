import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ReminderController } from "./reminder.controller";
import { ReminderService } from "../service/reminder.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-33: POST /reminders without a timezone uses the user's saved timezone (the profile step); a given timezone
// wins; a user with no saved timezone keeps the old default, UTC. Real controller and ReminderService, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("RNX-33: POST /reminders, default timezone (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ReminderController],
      providers: [ReminderService, AgentRunPolicyService, WorkspaceQuotaService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  /** A user with this saved timezone, owning a channel with a linked agent and a room; POSTs a reminder. */
  const createReminderAs = async (savedTimezone: string | null, timezone?: string) => {
    const user = await createUser(prisma, { timezone: savedTimezone });
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Team" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const chatRoom = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });
    return app.inject({
      method: "POST",
      url: "/reminders",
      headers: asSessionUser(user),
      payload: { agentId: agent.id, channelId: channel.id, chatRoomId: chatRoom.id, prompt: "Daily summary", cronExpression: "0 8 * * *", ...(timezone ? { timezone } : {}) },
    });
  };

  it("without a timezone: the user's saved timezone", async () => {
    const res = await createReminderAs("Asia/Jakarta");

    expect(res.statusCode).toBe(201);
    expect((await prisma.reminder.findFirstOrThrow()).timezone).toBe("Asia/Jakarta");
  });

  it("with a timezone: that one, not the saved one", async () => {
    const res = await createReminderAs("Asia/Jakarta", "Europe/Berlin");

    expect(res.statusCode).toBe(201);
    expect((await prisma.reminder.findFirstOrThrow()).timezone).toBe("Europe/Berlin");
  });

  it("without a timezone, the user has none saved: the existing default, UTC", async () => {
    const res = await createReminderAs(null);

    expect(res.statusCode).toBe(201);
    expect((await prisma.reminder.findFirstOrThrow()).timezone).toBe("UTC");
  });
});
