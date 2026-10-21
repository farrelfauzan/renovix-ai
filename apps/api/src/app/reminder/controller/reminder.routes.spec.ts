import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ReminderController } from "./reminder.controller";
import { ReminderService } from "../service/reminder.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-184: the reminder request schemas live in reminder/dto/reminder.dto.ts; an invalid body is
// refused with 400 on both routes that parse one, and nothing is stored or changed. Real controller
// and ReminderService, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("RX-184: reminder routes, invalid body (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ReminderController],
      providers: [ReminderService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => asSessionUser(user);

  // Alice owns a channel with a linked agent, a room and one active reminder.
  const setup = async () => {
    const alice = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: alice.id });
    const channel = await prisma.channel.create({ data: { userId: alice.id, name: "Alice channel" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const chatRoom = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });
    const reminder = await prisma.reminder.create({
      data: {
        userId: alice.id,
        agentId: agent.id,
        channelId: channel.id,
        chatRoomId: chatRoom.id,
        prompt: "Daily summary",
        cronExpression: "0 8 * * *",
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    return { alice, agent, channel, chatRoom, reminder };
  };

  // RX-184 follow-up (QA's note): the invalid field must be one CreateReminderSchema itself
  // refuses. A valid agentId with an EMPTY prompt makes the schema the refusing layer: relaxing
  // the schema turns this test red (the request would pass validation and reach the service).
  it("POST /reminders with an invalid body: 400, nothing stored", async () => {
    const { alice, agent, channel, chatRoom } = await setup();

    const res = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: auth(alice),
      payload: {
        agentId: agent.id,
        channelId: channel.id,
        chatRoomId: chatRoom.id,
        prompt: "",
        cronExpression: "0 9 * * 1",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.reminder.count()).toBe(1);
  });

  it("PATCH /reminders/:id with an invalid body: 400, the reminder unchanged", async () => {
    const { alice, reminder } = await setup();

    const res = await app.inject({
      method: "PATCH",
      url: `/reminders/${reminder.id}`,
      headers: auth(alice),
      payload: { status: "BOGUS" },
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.reminder.count()).toBe(1);
    expect(await prisma.reminder.findUnique({ where: { id: reminder.id } })).toMatchObject({
      status: "ACTIVE",
      prompt: "Daily summary",
    });
  });
});
