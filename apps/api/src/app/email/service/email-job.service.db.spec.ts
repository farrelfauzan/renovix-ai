import { TestingModule } from "@nestjs/testing";
import { EmailJobService } from "./email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { EMAIL_JOB_CLAIM_LEASE_MS } from "../config/email-job-claim-lease-ms";
import { EMAIL_JOB_MAX_ATTEMPTS } from "../config/email-job-max-attempts";

const MINUTE = 60 * 1000;
const HOLD_TIMEOUT_MS = 500;
/** How long the locked-row test waits for a claim before it counts as blocked by the lock. */
const LOCK_HOLD_MS = 2000;

describe("EmailJobService.claimPendingJobs (test database, RNX-338, RNX-352)", () => {
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
  const createJob = (
    name: string,
    ageMinutes: number,
    overrides: { status?: string; nextAttemptAt?: Date; attempts?: number; claimedUntil?: Date | null } = {},
  ) => {
    const createdAt = new Date(Date.now() - ageMinutes * MINUTE);
    return prisma.emailJob.create({
      data: {
        type: "workspace_invite", recipientEmail: `${name}@example.test`, payload: { name }, createdAt, nextAttemptAt: createdAt, ...overrides,
      },
    });
  };

  const findJob = (id: string) => prisma.emailJob.findUniqueOrThrow({ where: { id } });

  /** Ends the job's claim lease a minute ago, as if its container had died. */
  const expireLease = (id: string) => prisma.emailJob.update({ where: { id }, data: { claimedUntil: new Date(Date.now() - MINUTE) } });

  /** Sets the job's updatedAt (Prisma's @updatedAt would set it to now). */
  const setUpdatedAt = (id: string, updatedAt: Date) => prisma.$executeRaw`UPDATE "email_jobs" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;

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

  it("AC3 (RNX-352 rule): a job a crashed container left in \"sending\" is claimed again once its lease has ended, ordered with the pending jobs by creation, and a job marked for retry is claimed once it is due", async () => {
    const abandoned = await createJob("abandoned", 60, { status: "sending", claimedUntil: new Date(Date.now() - MINUTE) });
    const retried = await createJob("retried", 5);
    const actualFirst = await service.claimPendingJobs();
    await service.markFailed(retried.id, "connection reset", true);

    const actualBeforeDue = await service.claimPendingJobs();
    await prisma.emailJob.update({ where: { id: retried.id }, data: { nextAttemptAt: new Date(Date.now() - MINUTE) } });
    const actualWhenDue = await service.claimPendingJobs();

    expect(actualFirst.map((job) => job.id)).toEqual([abandoned.id, retried.id]);
    expect(actualFirst[0]).toMatchObject({ status: "sending", attempts: 1 });
    expect(actualBeforeDue).toEqual([]);
    expect(actualWhenDue.map((job) => job.id)).toEqual([retried.id]);
    expect(actualWhenDue[0]).toMatchObject({ attempts: 1, lastError: "connection reset" });
    expect(await findJob(abandoned.id)).toMatchObject({ status: "sending", attempts: 1 });
  });

  it("RNX-352 AC1: a job left in \"sending\" whose lease has ended is claimed once, as one more attempt; after markSent it is \"sent\" with no lease", async () => {
    const lost = await createJob("lost", 30, { status: "sending", claimedUntil: new Date(Date.now() - MINUTE) });

    const actualFirst = await service.claimPendingJobs();
    const actualSecond = await service.claimPendingJobs();
    await service.markSent(lost.id, "provider-message-1");

    expect(actualFirst.map((job) => job.id)).toEqual([lost.id]);
    expect(actualFirst[0]).toMatchObject({ status: "sending", attempts: 1 });
    expect(actualSecond).toEqual([]);
    expect(await findJob(lost.id)).toMatchObject({ status: "sent", providerMessageId: "provider-message-1", claimedUntil: null });
  });

  it("RNX-352 AC2: a job in \"sending\" still inside its lease is not taken by another claim", async () => {
    const claimedByOther = await createJob("claimed-by-other", 9);
    const leasedAhead = await createJob("leased-ahead", 30, { status: "sending", claimedUntil: new Date(Date.now() + MINUTE) });
    await service.claimPendingJobs();

    const actualJobs = await service.claimPendingJobs();

    expect(actualJobs).toEqual([]);
    expect(await findJob(claimedByOther.id)).toMatchObject({ status: "sending", attempts: 0 });
    expect(await findJob(leasedAhead.id)).toMatchObject({ status: "sending", attempts: 0 });
  });

  it("RNX-352 AC3: a job tried EMAIL_JOB_MAX_ATTEMPTS times (one claim, then a claim after each ended lease) is \"failed\" with \"claim lease expired\" when its last lease ends, and is not claimed again", async () => {
    const lost = await createJob("lost", 30);
    const actualClaims: string[][] = [];
    for (let i = 0; i < EMAIL_JOB_MAX_ATTEMPTS; i++) {
      actualClaims.push((await service.claimPendingJobs()).map((job) => job.id));
      await expireLease(lost.id);
    }

    const actualAfterLastLease = await service.claimPendingJobs();
    const actualAgain = await service.claimPendingJobs();

    expect(actualClaims).toEqual(Array.from({ length: EMAIL_JOB_MAX_ATTEMPTS }, () => [lost.id]));
    expect(actualAfterLastLease).toEqual([]);
    expect(actualAgain).toEqual([]);
    expect(await findJob(lost.id)).toMatchObject({
      status: "failed", attempts: EMAIL_JOB_MAX_ATTEMPTS, lastError: "claim lease expired", claimedUntil: null,
    });
  });

  it("RNX-352 AC4: two claims at the same moment share the \"sending\" jobs whose lease has ended; no job is claimed twice and none is left", async () => {
    const expectedIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      expectedIds.push((await createJob(`expired-${i}`, 10 - i, { status: "sending", claimedUntil: new Date(Date.now() - MINUTE) })).id);
    }
    const racingService = createServiceWithHeldReads(2);

    const [first, second] = await Promise.all([racingService.claimPendingJobs(3), racingService.claimPendingJobs(3)]);

    const actualIds = [...first, ...second].map((job) => job.id);
    expect(new Set(actualIds).size).toBe(actualIds.length);
    expect([...actualIds].sort()).toEqual([...expectedIds].sort());
    expect(await prisma.emailJob.count({ where: { status: "sending", attempts: 1, claimedUntil: { gt: new Date() } } })).toBe(6);
  });

  it("RNX-352 AC4: a \"sending\" job whose lease has ended and that another container holds locked is skipped without waiting, and the other expired job is claimed", async () => {
    const leaseEnded = new Date(Date.now() - MINUTE);
    const locked = await createJob("locked", 9, { status: "sending", claimedUntil: leaseEnded });
    const free = await createJob("free", 5, { status: "sending", claimedUntil: leaseEnded });
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
    expect(await findJob(locked.id)).toMatchObject({ status: "sending", attempts: 0, claimedUntil: leaseEnded });
  });

  it("RNX-352: a claim of a pending job gives it a lease of EMAIL_JOB_CLAIM_LEASE_MS from the claim and counts no attempt", async () => {
    const fresh = await createJob("fresh", 5);
    const before = Date.now();

    const [actualJob] = await service.claimPendingJobs();
    const after = Date.now();

    expect(actualJob).toMatchObject({ id: fresh.id, status: "sending", attempts: 0 });
    expect(actualJob.claimedUntil?.getTime()).toBeGreaterThanOrEqual(before + EMAIL_JOB_CLAIM_LEASE_MS);
    expect(actualJob.claimedUntil?.getTime()).toBeLessThanOrEqual(after + EMAIL_JOB_CLAIM_LEASE_MS);
  });

  it("RNX-352: markFailed ends the lease, both when the job is retried and when it fails", async () => {
    const retried = await createJob("retried", 9);
    const failed = await createJob("failed", 5);
    await service.claimPendingJobs();
    const actualLeasedAfterClaim = await prisma.emailJob.count({ where: { claimedUntil: { not: null } } });

    await service.markFailed(retried.id, "connection reset", true);
    await service.markFailed(failed.id, "mailbox unavailable", false);

    expect(actualLeasedAfterClaim).toBe(2);
    expect(await findJob(retried.id)).toMatchObject({ status: "pending", attempts: 1, claimedUntil: null });
    expect(await findJob(failed.id)).toMatchObject({ status: "failed", attempts: 1, claimedUntil: null });
  });

  it("RNX-352: a \"sending\" job without a lease (claimed before RNX-352) is claimed again once EMAIL_JOB_CLAIM_LEASE_MS has passed since its last update, not before", async () => {
    const recent = await createJob("recent", 30, { status: "sending" });
    const stale = await createJob("stale", 20, { status: "sending" });
    await setUpdatedAt(recent.id, new Date(Date.now() - EMAIL_JOB_CLAIM_LEASE_MS + MINUTE));
    await setUpdatedAt(stale.id, new Date(Date.now() - EMAIL_JOB_CLAIM_LEASE_MS - MINUTE));

    const actualJobs = await service.claimPendingJobs();

    expect(actualJobs.map((job) => job.id)).toEqual([stale.id]);
    expect(actualJobs[0]).toMatchObject({ status: "sending", attempts: 1 });
    expect(await findJob(recent.id)).toMatchObject({ status: "sending", attempts: 0, claimedUntil: null });
  });
});
