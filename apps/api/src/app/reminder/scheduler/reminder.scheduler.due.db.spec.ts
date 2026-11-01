import { TestingModule } from "@nestjs/testing";
import { ReminderScheduler } from "./reminder.scheduler";
import { ReminderService } from "../service/reminder.service";
import { ReminderRoomService } from "../service/reminder-room.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-139: which reminders the scheduler picks up (active, not deleted, due), what a fire stores (the prompt and the
// answer in the room, the next fire time) and that the room's history reaches the model (this agent's last 10 messages
// of the room, oldest first). Real ReminderScheduler, ReminderService, run policy, meter and CreditService on the test
// database; fake provider. AgentToolService loads ESM-only packages and is stubbed.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));

describe("RNX-139: the scheduler's pick-up of due reminders (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: ReminderScheduler;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ReminderScheduler,
          ReminderRoomService,
          ReminderService,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined },
          },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "" } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    scheduler = moduleRef.get(ReminderScheduler);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** A subscribed, funded user with a channel, an agent and a room. */
  const seedRoom = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    return { user, agent, channel, room };
  };

  const addReminder = (
    s: Awaited<ReturnType<typeof seedRoom>>,
    data: { prompt: string; nextRunAt: Date; status?: "ACTIVE" | "PAUSED"; deletedAt?: Date },
  ) =>
    prisma.reminder.create({
      data: {
        userId: s.user.id,
        agentId: s.agent.id,
        channelId: s.channel.id,
        chatRoomId: s.room.id,
        cronExpression: "0 8 * * *",
        timezone: "UTC",
        ...data,
      },
    });

  const past = () => new Date(Date.now() - 60_000);

  it("fires only the active, not deleted, due reminders; the others are untouched", async () => {
    const s = await seedRoom();
    const due = await addReminder(s, { prompt: "DUE", nextRunAt: past() });
    const deleted = await addReminder(s, { prompt: "DELETED", nextRunAt: past(), deletedAt: new Date() });
    const paused = await addReminder(s, { prompt: "PAUSED", nextRunAt: past(), status: "PAUSED" });
    const future = await addReminder(s, { prompt: "FUTURE", nextRunAt: new Date(Date.now() + 3_600_000) });
    fake.enqueue({ content: "Done", usage: { prompt_tokens: 10, completion_tokens: 2 } });

    await scheduler.processReminders();

    expect(fake.requests).toHaveLength(1);
    expect((fake.requests[0].messages.at(-1) as { content: string }).content).toBe("DUE");
    const firedDue = await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } });
    expect(firedDue.lastRunAt).not.toBeNull();
    expect(firedDue.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    for (const untouched of [deleted, paused, future]) {
      expect(await prisma.reminder.findUniqueOrThrow({ where: { id: untouched.id } })).toEqual(untouched);
    }
  });

  it("RNX-124 AC3: a due, active reminder of a deleted agent does not fire: no model call, message, reservation or ledger entry; the reminder row unchanged", async () => {
    const s = await seedRoom();
    const due = await addReminder(s, { prompt: "DUE", nextRunAt: past() });
    await prisma.agent.updateMany({ where: { id: s.agent.id }, data: { deletedAt: new Date(), deletedById: s.user.id } });
    const ledgerBefore = await prisma.creditLedgerEntry.count();
    fake.enqueue({ content: "Done", usage: { prompt_tokens: 10, completion_tokens: 2 } });

    await scheduler.processReminders();

    expect(fake.requests).toHaveLength(0);
    expect(await prisma.channelMessage.count()).toBe(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(ledgerBefore);
    expect(await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } })).toEqual(due);
    // Control: once the agent is live again the same reminder fires (and takes the reply queued above)
    await prisma.agent.updateMany({ where: { id: s.agent.id }, data: { deletedAt: null, deletedById: null } });
    await scheduler.processReminders();
    expect(fake.requests).toHaveLength(1);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } })).lastRunAt).not.toBeNull();
  });

  it("a fire stores the reminder's prompt and the answer in the room, marked as from the reminder", async () => {
    const s = await seedRoom();
    const due = await addReminder(s, { prompt: "Summarise", nextRunAt: past() });
    fake.enqueue({ content: "Here you go", usage: { prompt_tokens: 10, completion_tokens: 2 } });

    await scheduler.processReminders();

    const messages = await prisma.channelMessage.findMany({ orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => [m.role, m.content, m.chatRoomId, m.agentId])).toEqual([
      ["user", "Summarise", s.room.id, s.agent.id],
      ["assistant", "Here you go", s.room.id, s.agent.id],
    ]);
    expect(messages[1].metadata).toMatchObject({ source: "reminder", reminderId: due.id });
  });

  it("the room's last 10 messages of this agent reach the model, oldest first; other agents' messages do not", async () => {
    const s = await seedRoom();
    const otherAgent = await createAgent(prisma, { userId: s.user.id });
    for (let i = 0; i < 12; i++) {
      await prisma.channelMessage.create({
        data: { chatRoomId: s.room.id, agentId: s.agent.id, role: "user", content: `m${i}`, createdAt: new Date(Date.now() - (100 - i) * 1000) },
      });
    }
    await prisma.channelMessage.create({ data: { chatRoomId: s.room.id, agentId: otherAgent.id, role: "user", content: "other-agent" } });
    await addReminder(s, { prompt: "DUE", nextRunAt: past() });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 2 } });

    await scheduler.processReminders();

    const sent = (fake.requests[0].messages as { role: string; content: string }[]).filter((m) => m.role !== "system");
    expect(sent.map((m) => m.content)).toEqual([...Array.from({ length: 10 }, (_, i) => `m${i + 2}`), "DUE"]);
  });

  it("a fire that fails is counted on the reminder with its error", async () => {
    const s = await seedRoom();
    const due = await addReminder(s, { prompt: "DUE", nextRunAt: past() });
    await prisma.agent.update({ where: { id: s.agent.id }, data: { model: "no-such-model" } });

    await scheduler.processReminders();

    expect(await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({
      consecutiveFailures: 1,
      status: "ACTIVE",
    });
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } })).lastError).toEqual(expect.any(String));
  });
});
