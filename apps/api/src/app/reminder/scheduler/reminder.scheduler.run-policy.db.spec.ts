import { TestingModule } from "@nestjs/testing";
import { ReminderScheduler } from "./reminder.scheduler";
import { ReminderService } from "../service/reminder.service";
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
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-119 (D257): a reminder fire applies the run policy and the D192 subscription gate for the reminder's owner (who
// runs and pays) at fire time, not only when the reminder was created. A refused fire is skipped: no model call, no
// reservation or ledger entry, no message, a log line without the reminder's content, and the next fire time is set
// (no failure counted, no retry loop). Real ReminderScheduler, ReminderService, run policy, meter, CreditService and
// UsageService on the test database (processReminders picks the due reminders from it); fake provider. AgentToolService
// loads ESM-only packages and is stubbed.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));

const PROMPT = "SECRET DAILY PROMPT";

describe("RNX-119: the run policy at reminder fire time (test database, fake provider)", () => {
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

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A user on a plan with this slug; subscribed (active) and funded with 1 credit unless told otherwise. */
  const newUser = async ({ planSlug, subscribed = true }: { planSlug?: string; subscribed?: boolean } = {}) => {
    const user = await createUser(prisma);
    // RNX-251: "subscribed" is a package snapshot (the run gate reads it); RNX-76 B3 (D297): an "enterprise" user's
    // snapshot also enables collaboration. An unsubscribed user has no package.
    if (subscribed) await createPackageSnapshot(prisma, { userId: user.id, collaborationEnabled: planSlug === "enterprise" });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /**
   * An Enterprise owner's workspace with an active agent (public when asked), and a due daily reminder of `runner` in
   * the runner's own channel, set up while the agent was runnable. `member`: the runner is an active member.
   */
  const seed = async ({ isPublic = false, member = true, subscribed = true } = {}) => {
    const owner = await newUser({ planSlug: "enterprise" });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active", isPublic });
    const runner = await newUser({ subscribed });
    const membership = member
      ? await prisma.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: runner.id, role: "member", status: "active", joinedAt: new Date() },
        })
      : null;
    const channel = await prisma.channel.create({ data: { userId: runner.id, name: "My room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    const reminder = await prisma.reminder.create({
      data: {
        userId: runner.id,
        agentId: agent.id,
        channelId: channel.id,
        chatRoomId: room.id,
        prompt: PROMPT,
        cronExpression: "0 8 * * *",
        timezone: "UTC",
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });
    return { owner, workspace, agent, runner, membership, reminder };
  };

  /** The reminder was skipped: nothing ran or was charged, the next fire time is set, no failure was counted. */
  const expectSkipped = async (reminderId: string, before: Date) => {
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
    expect(await prisma.channelMessage.count()).toBe(0);
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect([after.status, after.consecutiveFailures, after.lastError, after.lastRunAt]).toEqual(["ACTIVE", 0, null, null]);
    expect(before.getTime()).toBeLessThan(after.nextRunAt.getTime());
  };

  it("a collaborator's reminder fires and reserves on the collaborator's own paid wallet (control)", async () => {
    const { owner, runner, reminder } = await seed();
    // RNX-251: the runner's package is a purchase snapshot; no user_subscriptions row exists.
    expect(await prisma.userSubscription.count()).toBe(0);
    fake.enqueue({ content: "Here is your summary", usage: { prompt_tokens: 100, completion_tokens: 10 } });

    await scheduler.processReminders();

    const reservations = await prisma.creditReservation.findMany({ include: { account: true } });
    expect(reservations.map((r) => [r.account.userId, r.wallet, r.status])).toEqual([[runner.id, "paid", "settled"]]);
    const ownerAccount = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: owner.id, wallet: "paid" } } });
    expect(ownerAccount.balance.toFixed(6)).toBe("1.000000");
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(after.lastRunAt).not.toBeNull();
  });

  it("AC2: the member is removed before the fire time: the fire is skipped, nothing charged, logged without content", async () => {
    const { membership, reminder } = await seed();
    await prisma.workspaceMember.update({ where: { id: membership!.id }, data: { status: "removed" } });
    const { lines } = captureLogLines();

    await scheduler.processReminders();

    await expectSkipped(reminder.id, reminder.nextRunAt);
    expect(lines.filter((line) => line.includes(`Skipped reminder ${reminder.id}: not_runnable`))).toHaveLength(1);
    expect(lines.filter((line) => line.includes(PROMPT))).toEqual([]);
  });

  it("AC2: the public agent is unpublished before the fire time of an outsider's reminder: the fire is skipped, nothing charged", async () => {
    const { agent, reminder } = await seed({ isPublic: true, member: false });
    await prisma.agent.update({ where: { id: agent.id }, data: { isPublic: false } });

    await scheduler.processReminders();

    await expectSkipped(reminder.id, reminder.nextRunAt);
  });

  it("AC3: a collaborator without an active subscription: the fire is skipped (D192), nothing charged", async () => {
    const { reminder } = await seed({ subscribed: false });
    const { lines } = captureLogLines();

    await scheduler.processReminders();

    await expectSkipped(reminder.id, reminder.nextRunAt);
    expect(lines.filter((line) => line.includes(`Skipped reminder ${reminder.id}: no_subscription`))).toHaveLength(1);
  });

  /** A due daily reminder of the workspace owner on their own channel, with the agent added. */
  const ownerReminder = async (ownerId: string, agentId: string) => {
    const channel = await prisma.channel.create({ data: { userId: ownerId, name: "Owner room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    return prisma.reminder.create({
      data: {
        userId: ownerId,
        agentId,
        channelId: channel.id,
        chatRoomId: room.id,
        prompt: PROMPT,
        cronExpression: "0 8 * * *",
        timezone: "UTC",
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });
  };

  describe("RNX-260 (D259)", () => {
    it.each(["draft", "archived"])(
      "AC5: the agent is %s before the fire time of a collaborator's reminder: the fire is skipped, nothing charged",
      async (status) => {
        const { agent, reminder } = await seed();
        await prisma.agent.update({ where: { id: agent.id }, data: { status } });
        const { lines } = captureLogLines();

        await scheduler.processReminders();

        await expectSkipped(reminder.id, reminder.nextRunAt);
        expect(lines.filter((line) => line.includes(`Skipped reminder ${reminder.id}: not_runnable`))).toHaveLength(1);
      },
    );

    it("AC5: the owner's reminder of a draft agent fires (control: the owner runs an agent of any status)", async () => {
      const { owner, agent, reminder: collaboratorReminder } = await seed();
      await prisma.reminder.delete({ where: { id: collaboratorReminder.id } });
      await prisma.agent.update({ where: { id: agent.id }, data: { status: "draft" } });
      const reminder = await ownerReminder(owner.id, agent.id);
      fake.enqueue({ content: "Here is your summary", usage: { prompt_tokens: 100, completion_tokens: 10 } });

      await scheduler.processReminders();

      expect(fake.requests).toHaveLength(1);
      expect((await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).lastRunAt).not.toBeNull();
    });

    it.each(["archived", "deleted"])(
      "AC6: the workspace is %s: the owner's and the collaborator's fires are skipped, nothing charged",
      async (status) => {
        const { owner, workspace, agent, reminder } = await seed();
        const ownersReminder = await ownerReminder(owner.id, agent.id);
        await prisma.workspace.update({ where: { id: workspace.id }, data: { status } });
        const { lines } = captureLogLines();

        await scheduler.processReminders();

        await expectSkipped(reminder.id, reminder.nextRunAt);
        await expectSkipped(ownersReminder.id, ownersReminder.nextRunAt);
        for (const id of [reminder.id, ownersReminder.id]) {
          expect(lines.filter((line) => line.includes(`Skipped reminder ${id}: workspace_closed`))).toHaveLength(1);
        }
      },
    );
  });

  it("a skipped reminder is not picked again in the next minute (no retry loop)", async () => {
    const { membership, reminder } = await seed();
    await prisma.workspaceMember.update({ where: { id: membership!.id }, data: { status: "removed" } });
    const markSkipped = jest.spyOn(moduleRef.get(ReminderService), "markSkipped");

    await scheduler.processReminders();
    await scheduler.processReminders();

    expect(markSkipped.mock.calls.map((call) => call[0])).toEqual([reminder.id]);
    expect(fake.requests).toHaveLength(0);
  });
});
