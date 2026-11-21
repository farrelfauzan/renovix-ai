import { TestingModule } from "@nestjs/testing";
import { EmailJobService } from "./email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";

const MINUTE = 60 * 1000;
const HOLD_TIMEOUT_MS = 500;
/** How long the locked-row test waits for a claim before it counts as blocked by the lock. */
const LOCK_HOLD_MS = 2000;

describe("EmailJobService.claimPendingJobs (test database, RNX-338)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: EmailJobService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [EmailJobService] }));
    service = moduleRef.get(EmailJobService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  /** A job created `ageMinutes` ago and due since then, unless `overrides` says otherwise. */
  const createJob = (name: string, ageMinutes: number, overrides: { status?: string; nextAttemptAt?: Date; attempts?: number } = {}) => {
    const createdAt = new Date(Date.now() - ageMinutes * MINUTE);
    return prisma.emailJob.create({
      data: {
        type: "workspace_invite", recipientEmail: `${name}@example.test`, payload: { name }, createdAt, nextAttemptAt: createdAt, ...overrides,
      },
    });
  };

  /**
   * A service whose every `emailJob.findMany` hands back its rows only once `callers` reads have finished (or a short
   * time has passed), so two claims that read first and mark afterwards both read before either marks: the race of two
   * API containers.
   */
  const createServiceWithHeldReads = (callers: number): EmailJobService => {
    let finished = 0;
    let releaseAll!: () => void;
    const allFinished = new Promise<void>((resolve) => (releaseAll = resolve));
    const heldFindMany = async (...args: Parameters<typeof prisma.emailJob.findMany>) => {
      const rows = await prisma.emailJob.findMany(...args);
      finished += 1;
      if (finished === callers) releaseAll();
      await Promise.race([allFinished, new Promise((resolve) => setTimeout(resolve, HOLD_TIMEOUT_MS))]);
      return rows;
    };
    const heldJobs = new Proxy(prisma.emailJob, { get: (jobs, key) => (key === "findMany" ? heldFindMany : Reflect.get(jobs, key)) });
    const heldPrisma = new Proxy(prisma, { get: (client, key) => (key === "emailJob" ? heldJobs : Reflect.get(client, key)) });
    return new EmailJobService(heldPrisma);
  };

  it("AC1: two claims at the same moment share the pending jobs; no job is claimed twice and none is left", async () => {
    const expectedIds: string[] = [];
    for (let i = 0; i < 6; i++) expectedIds.push((await createJob(`job-${i}`, 10 - i)).id);
    const racingService = createServiceWithHeldReads(2);

    const [first, second] = await Promise.all([racingService.claimPendingJobs(3), racingService.claimPendingJobs(3)]);

    const actualIds = [...first, ...second].map((job) => job.id);
    expect(new Set(actualIds).size).toBe(actualIds.length);
    expect([...actualIds].sort()).toEqual([...expectedIds].sort());
    expect(await prisma.emailJob.count({ where: { status: "sending" } })).toBe(6);
  });

  it("AC1: a job another container holds locked is skipped without waiting, and the other jobs are claimed", async () => {
    const locked = await createJob("locked", 9);
    const free = await createJob("free", 5);
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => (releaseLock = resolve));
    let reportLocked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (reportLocked = resolve));
    const otherContainer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "email_jobs" WHERE "id" = ${locked.id} FOR UPDATE`;
        reportLocked();
        await lockReleased;
      },
      { timeout: LOCK_HOLD_MS * 5 },
    );
    await lockTaken;

    const claim = service.claimPendingJobs();
    const actual = await Promise.race([claim, new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), LOCK_HOLD_MS))]);
    releaseLock();
    await Promise.all([otherContainer, claim]);

    expect(actual).not.toBe("waited");
    expect((actual as Awaited<typeof claim>).map((job) => job.id)).toEqual([free.id]);
  });

  it("AC2: one claim takes the oldest due pending jobs, in creation order, up to its limit", async () => {
    const newest = await createJob("newest", 1);
    const oldest = await createJob("oldest", 9);
    const middle = await createJob("middle", 5);
    await createJob("not-due", 20, { nextAttemptAt: new Date(Date.now() + 10 * MINUTE) });
    await createJob("already-sent", 30, { status: "sent" });
    await createJob("failed", 40, { status: "failed" });

    const actualFirst = await service.claimPendingJobs(2);
    const actualSecond = await service.claimPendingJobs(2);

    expect(actualFirst.map((job) => job.id)).toEqual([oldest.id, middle.id]);
    expect(actualSecond.map((job) => job.id)).toEqual([newest.id]);
    expect(actualFirst[0]).toMatchObject({ type: "workspace_invite", recipientEmail: "oldest@example.test", payload: { name: "oldest" } });
    expect(await prisma.emailJob.count({ where: { status: "pending" } })).toBe(1);
    expect(await service.claimPendingJobs()).toEqual([]);
  });

  it("AC2: without a limit a claim takes 10 jobs", async () => {
    for (let i = 0; i < 12; i++) await createJob(`job-${i}`, 20 - i);

    const actualJobs = await service.claimPendingJobs();

    expect(actualJobs).toHaveLength(10);
    expect(await prisma.emailJob.count({ where: { status: "pending" } })).toBe(2);
  });

  it("AC3: recovery is as before: a job a crashed container left in \"sending\" is not claimed again, and a job marked for retry is claimed once it is due", async () => {
    const abandoned = await createJob("abandoned", 60, { status: "sending" });
    const retried = await createJob("retried", 5);
    await service.claimPendingJobs();
    await service.markFailed(retried.id, "connection reset", true);

    const actualBeforeDue = await service.claimPendingJobs();
    await prisma.emailJob.update({ where: { id: retried.id }, data: { nextAttemptAt: new Date(Date.now() - MINUTE) } });
    const actualWhenDue = await service.claimPendingJobs();

    expect(actualBeforeDue).toEqual([]);
    expect(actualWhenDue.map((job) => job.id)).toEqual([retried.id]);
    expect(actualWhenDue[0]).toMatchObject({ attempts: 1, lastError: "connection reset" });
    expect(await prisma.emailJob.findUniqueOrThrow({ where: { id: abandoned.id } })).toMatchObject({ status: "sending" });
  });
});
