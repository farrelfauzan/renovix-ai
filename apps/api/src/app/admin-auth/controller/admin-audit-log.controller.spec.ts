import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../admin-auth.module";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import { AdminSessionService } from "../service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";

// RX-164 (PRD 09 F11, F16, §5; D138): the audit log read route and its CSV export through real HTTP
// (Fastify `inject`) on the test database. Obviously fake personal data only.

const ACCESS = "rx_admin_access";
const BASE = new Date("2026-10-01T00:00:00Z");
const SECOND = 1000;
const EMAIL = "jane.rx164@example.com";
const PHONE = "+62 812-3456-7890";
const LOCAL_PHONE = "081234567890";

type ListBody = { rows: Record<string, unknown>[]; nextCursor: string | null };

describe("Audit log screen API (RX-164, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  /** An admin of this role with a full session; returns the admin id and the access cookie. */
  const signedIn = async (role: string, email = `${role}@example.com`) => {
    const admin = await createAdmin(prisma, moduleRef, { email, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  /** `count` audit rows by `adminId`, one second apart from `start` (row 0 oldest); `pick` sets other columns. */
  const seedRows = (adminId: string, count: number, pick: (i: number) => Record<string, unknown> = () => ({}), start = BASE) =>
    prisma.adminAuditLog.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        adminId,
        resource: "probe",
        action: "update",
        before: { step: i },
        after: { step: i + 1 },
        reason: `reason ${i}`,
        requestId: `req-${i}`,
        effectiveAt: new Date(start.getTime() + i * SECOND),
        createdAt: new Date(start.getTime() + i * SECOND),
        ...pick(i),
      })),
    });
  const get = (url: string, cookie?: string) =>
    app.inject({ method: "GET", url, headers: cookie ? { ...BACK_OFFICE_ORIGIN, cookie } : BACK_OFFICE_ORIGIN });
  const list = async (cookie: string, query = ""): Promise<ListBody> => {
    const res = await get(`/admin/audit-log${query}`, cookie);
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  /** Every page, following nextCursor; returns the page sizes and all rows in order. */
  const listAll = async (cookie: string, query: Record<string, string> = {}) => {
    const sizes: number[] = [];
    const rows: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams(cursor ? { ...query, cursor } : query).toString();
      const body = await list(cookie, params ? `?${params}` : "");
      sizes.push(body.rows.length);
      rows.push(...body.rows);
      cursor = body.nextCursor;
    } while (cursor);
    return { sizes, rows };
  };
  const exportRows = () => prisma.adminAuditLog.findMany({ where: { resource: "audit_log", action: "export" } });
  /** The data lines of a CSV body (after the header), for rows whose cells have no line breaks. */
  const csvLines = (body: string) => body.split("\r\n").slice(1, -1);

  describe("AC1: newest first, 50 per page", () => {
    it("120 rows come as pages of 50, 50 and 20, newest first, each once, with every column", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      await seedRows(adminId, 120);

      const { sizes, rows } = await listAll(cookie);

      expect(sizes).toEqual([50, 50, 20]);
      expect(rows.map((row) => row.reason)).toEqual(Array.from({ length: 120 }, (_, i) => `reason ${119 - i}`));
      expect(new Set(rows.map((row) => row.id)).size).toBe(120);
      expect(rows[0]).toEqual({
        id: expect.any(String),
        adminId,
        adminEmail: "viewer@example.com",
        resource: "probe",
        action: "update",
        before: { step: 119 },
        after: { step: 120 },
        reason: "reason 119",
        effectiveAt: new Date(BASE.getTime() + 119 * SECOND).toISOString(),
        createdAt: new Date(BASE.getTime() + 119 * SECOND).toISOString(),
      });
    });

    it("rows recorded within the same millisecond are neither skipped nor repeated across pages", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      // 120 rows 1 microsecond apart: a cursor cut to milliseconds would lose some of them.
      await prisma.$executeRaw`
        INSERT INTO "admin_audit_log" ("id", "admin_id", "resource", "action", "before", "after", "reason", "request_id", "effective_at", "created_at")
        SELECT gen_random_uuid()::text, ${adminId}, 'probe', 'update', '{}', '{}', 'micro ' || n, 'req', ${BASE}, ${BASE}::timestamptz + n * interval '1 microsecond'
        FROM generate_series(1, 120) AS n`;

      const { sizes, rows } = await listAll(cookie);

      expect(sizes).toEqual([50, 50, 20]);
      expect(rows.map((row) => row.reason)).toEqual(Array.from({ length: 120 }, (_, i) => `micro ${120 - i}`));
    });
  });

  describe("AC2: filters", () => {
    /** Two admins; rows that differ by admin, resource, action and time. */
    const seedMixed = async () => {
      const viewer = await signedIn("viewer");
      const other = await signedIn("finance");
      await seedRows(viewer.adminId, 3, (i) => ({ resource: "package", action: "update", reason: `viewer package ${i}` }));
      await seedRows(viewer.adminId, 2, (i) => ({ resource: "admin_session", action: "revoke", reason: `viewer session ${i}` }), new Date("2026-10-02T00:00:00Z"));
      await seedRows(other.adminId, 2, (i) => ({ resource: "package", action: "create", reason: `other package ${i}` }), new Date("2026-10-03T00:00:00Z"));
      return { viewer, other };
    };
    const reasons = (rows: Record<string, unknown>[]) => rows.map((row) => row.reason).sort();

    it("by admin: only that admin's rows", async () => {
      const { viewer, other } = await seedMixed();

      const { rows } = await listAll(viewer.cookie, { adminId: other.adminId });

      expect(reasons(rows)).toEqual(["other package 0", "other package 1"]);
    });

    it("by resource: only rows of that resource", async () => {
      const { viewer } = await seedMixed();

      const { rows } = await listAll(viewer.cookie, { resource: "admin_session" });

      expect(reasons(rows)).toEqual(["viewer session 0", "viewer session 1"]);
    });

    it("by action: only rows of that action", async () => {
      const { viewer } = await seedMixed();

      const { rows } = await listAll(viewer.cookie, { action: "create" });

      expect(reasons(rows)).toEqual(["other package 0", "other package 1"]);
    });

    it("by date range: from inclusive, to exclusive", async () => {
      const { viewer } = await seedMixed();

      const { rows } = await listAll(viewer.cookie, { from: "2026-10-01T00:00:01Z", to: "2026-10-02T00:00:01Z" });

      expect(reasons(rows)).toEqual(["viewer package 1", "viewer package 2", "viewer session 0"]);
    });

    it("combined: admin, resource, action and range together", async () => {
      const { viewer } = await seedMixed();

      const { rows } = await listAll(viewer.cookie, {
        adminId: viewer.adminId,
        resource: "package",
        action: "update",
        from: "2026-10-01T00:00:01+00:00",
        to: "2026-10-04T00:00:00Z",
      });

      expect(reasons(rows)).toEqual(["viewer package 1", "viewer package 2"]);
    });

    it.each([
      ["a cursor that was never issued", "?cursor=not-a-cursor"],
      ["a cursor with a time cut to milliseconds", `?cursor=${Buffer.from(JSON.stringify(["2026-10-01T00:00:00.000Z", "x"])).toString("base64url")}`],
      ["from after to", "?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z"],
      ["from equal to to", "?from=2026-10-02T00:00:00Z&to=2026-10-02T00:00:00Z"],
      ["a time that is not ISO 8601", "?from=yesterday"],
      ["a time without a time zone", "?from=2026-10-02T00:00:00"],
      ["an unknown parameter", "?limit=1000"],
      ["a repeated parameter", "?action=a&action=b"],
      ["an empty filter", "?resource="],
    ])("400 for %s, on the read route and the export", async (_case, query) => {
      const { cookie } = await signedIn("viewer");

      const [read, exported] = await Promise.all([get(`/admin/audit-log${query}`, cookie), get(`/admin/audit-log/export${query}`, cookie)]);

      expect([read.statusCode, exported.statusCode]).toEqual([400, 400]);
      expect(await exportRows()).toEqual([]);
    });
  });

  describe("AC3: CSV export", () => {
    it("holds exactly the filtered rows across every batch, with the header, and one audit row records the export", async () => {
      const { adminId, cookie } = await signedIn("finance");
      // More than two batches of 500 that match; created in one statement, so they share created_at
      // and the batches are cut by id alone. Plus rows that do not match.
      await seedRows(adminId, 1103, (i) => ({ resource: "package", createdAt: BASE, reason: `match ${i}` }));
      await seedRows(adminId, 40, (i) => ({ resource: "credits", reason: `other ${i}` }));
      const findPage = jest.spyOn(moduleRef.get(AdminAuditLogRepository), "findPage");

      const res = await get("/admin/audit-log/export?resource=package&from=2026-09-30T00:00:00Z", cookie);

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="audit-log.csv"');
      expect(res.body.split("\r\n")[0]).toBe("id,created_at,admin_id,admin_email,resource,action,before,after,reason,effective_at");
      const lines = csvLines(res.body);
      expect(lines).toHaveLength(1103);
      expect(lines.map((line) => line.split(",")[8]).sort()).toEqual(Array.from({ length: 1103 }, (_, i) => `match ${i}`).sort());
      expect(findPage.mock.calls.map(([, , limit]) => limit)).toEqual([500, 500, 500]);
      const audit = await exportRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        adminId,
        resource: "audit_log",
        action: "export",
        before: {},
        after: { adminId: null, resource: "package", action: null, from: "2026-09-30T00:00:00.000Z", to: null, personalDataUnmasked: false },
        reason: "",
      });
      expect(JSON.stringify(audit[0])).not.toMatch(/match \d/);
    });

    it("cells are RFC 4180 quoted and protected against formula injection", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      const dangerous = ["=HYPERLINK(\"http://x\")", "+1+1", "-2", "@SUM(A1)", "\tTAB", "\rCR", "a,b", 'say "hi"', "two\nlines"];
      await seedRows(adminId, dangerous.length, (i) => ({ reason: dangerous[i] }));

      const res = await get("/admin/audit-log/export", cookie);

      expect(res.statusCode).toBe(200);
      for (const cell of ['"\'=HYPERLINK(""http://x"")"', "'+1+1", "'-2", "'@SUM(A1)", "'\tTAB", "\"'\rCR\"", '"a,b"', '"say ""hi"""', '"two\nlines"']) {
        expect(res.body).toContain(`,${cell},`);
      }
      expect(res.body).toContain(',"{""step"":0}","{""step"":1}",');
    });

    it("the export audit row cannot be written: 500, nothing streamed, no row", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      await seedRows(adminId, 3);
      jest.spyOn(moduleRef.get(AdminAuditLogRepository), "create").mockRejectedValueOnce(new Error("audit insert failed (test)"));
      const findPage = jest.spyOn(moduleRef.get(AdminAuditLogRepository), "findPage");

      const res = await get("/admin/audit-log/export", cookie);

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("reason 0");
      expect(findPage).not.toHaveBeenCalled();
      expect(await exportRows()).toEqual([]);
    });
  });

  describe("AC4: who may read the audit log (D138)", () => {
    it.each(["owner", "operations", "finance", "viewer"])("%s: 200 on the read route and the export", async (role) => {
      const { cookie } = await signedIn(role);

      const [read, exported] = await Promise.all([get("/admin/audit-log", cookie), get("/admin/audit-log/export", cookie)]);

      expect([read.statusCode, exported.statusCode]).toEqual([200, 200]);
    });

    it("support (no audit:read): 403 and no rows on the read route and the export, and no export audit row", async () => {
      const viewer = await signedIn("viewer");
      await seedRows(viewer.adminId, 5);
      const { cookie } = await signedIn("support");

      const [read, exported] = await Promise.all([get("/admin/audit-log", cookie), get("/admin/audit-log/export", cookie)]);

      expect([read.statusCode, exported.statusCode]).toEqual([403, 403]);
      expect(read.body).not.toContain("reason");
      expect(exported.body).not.toContain("reason");
      expect(await exportRows()).toEqual([]);
    });

    it("no session: 401 on the read route and the export, and no export audit row", async () => {
      const [read, exported] = await Promise.all([get("/admin/audit-log"), get("/admin/audit-log/export")]);

      expect([read.statusCode, exported.statusCode]).toEqual([401, 401]);
      expect(await exportRows()).toEqual([]);
    });
  });

  describe("AC5: personal data in before, after and reason (PRD 09 §5)", () => {
    const PERSONAL_BEFORE = { email: EMAIL, contact: { phone: PHONE, tags: ["vip", EMAIL] }, note: `call ${LOCAL_PHONE}`, plan: "pro" };
    const PERSONAL_AFTER = { phoneNumber: "not-a-number-shape", userId: "user-1", count: 3 };
    const PERSONAL_REASON = `user ${EMAIL} asked`;
    const RAW_VALUES = [EMAIL, PHONE, LOCAL_PHONE, "not-a-number-shape"];
    // The export of one role writes an audit row of its own (resource audit_log): the reads below filter it out.
    const seedPersonal = async () => {
      const writer = await signedIn("owner", "writer@example.com");
      await seedRows(writer.adminId, 1, () => ({ before: PERSONAL_BEFORE, after: PERSONAL_AFTER, reason: PERSONAL_REASON }));
    };

    it("masked for an admin without users:read_pii (Viewer, Finance) on the read route and in the CSV", async () => {
      await seedPersonal();
      for (const role of ["viewer", "finance"]) {
        const { cookie } = await signedIn(role);

        const { rows } = await list(cookie, "?resource=probe");
        const csv = await get("/admin/audit-log/export?resource=probe", cookie);

        expect(rows[0]).toMatchObject({
          before: { email: "***", contact: { phone: "***", tags: ["vip", "***"] }, note: "***", plan: "pro" },
          after: { phoneNumber: "***", userId: "user-1", count: 3 },
          reason: "***",
        });
        for (const raw of RAW_VALUES) {
          expect(JSON.stringify(rows)).not.toContain(raw);
          expect(csv.body).not.toContain(raw);
        }
      }
    });

    it("shown as recorded for an admin with users:read_pii (Operations), on the read route and in the CSV", async () => {
      await seedPersonal();
      const { cookie } = await signedIn("operations");

      const { rows } = await list(cookie, "?resource=probe");
      const csv = await get("/admin/audit-log/export?resource=probe", cookie);

      expect(rows[0]).toMatchObject({ before: PERSONAL_BEFORE, after: PERSONAL_AFTER, reason: PERSONAL_REASON });
      for (const raw of RAW_VALUES) expect(csv.body).toContain(raw);
      expect((await exportRows())[0].after).toMatchObject({ personalDataUnmasked: true });
    });
  });
});
