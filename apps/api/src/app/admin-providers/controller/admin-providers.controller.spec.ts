import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminProvidersModule } from "../admin-providers.module";
import { ProviderKeyCryptoService } from "../service/provider-key-crypto.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createModel, createProvider, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";

// RX-177 (D148, D149): provider records and their models through the admin API, real HTTP (Fastify
// `inject`) on the test database, with the fake provider (no request leaves the machine). Obviously fake
// keys only: MARKER_KEY is a marker that must never appear in a response, a log line or an audit row.

const ACCESS = "rx_admin_access";
const MARKER_KEY = "fake-marker-key-rx177-never-real-Zq81";
const MARKER_HINT = "Zq81";
const SECOND_KEY = "fake-second-key-rx177-never-real-Wv42";
/** LLM_KEY_VERSION for this file: not the default, so the stamped version is the configured one. */
const KEY_VERSION = 2;

type Json = Record<string, any>;

describe("Provider records and their models (RX-177, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const fake = new FakeProviderAdapter();
  const savedKeyVersion = process.env.LLM_KEY_VERSION;
  const output: string[] = [];

  beforeAll(async () => {
    process.env.LLM_KEY_VERSION = String(KEY_VERSION);
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminProvidersModule] }, (b) => withFakeProvider(b, fake)));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.setTestResult({ isSuccessful: true, reason: null });
    fake.testRequests.splice(0);
    output.splice(0);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    if (savedKeyVersion === undefined) delete process.env.LLM_KEY_VERSION;
    else process.env.LLM_KEY_VERSION = savedKeyVersion;
  });

  /** Captures every line written to stdout, stderr and the console (Nest's logger writes to stdout). */
  const captureOutput = () => {
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      jest.spyOn(stream, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        output.push(String(chunk));
        return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write);
    }
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.map(String).join(" ")));
    }
    // Nest's Logger, whether or not the testing logger prints it.
    for (const method of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => void output.push(args.map(String).join(" ")));
    }
  };
  /** An admin of this role with a full session; returns the admin id and the access cookie. */
  const signedIn = async (role: string) => {
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-${randomUUID().slice(0, 6)}@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const createVia = async (cookie: string, body: Json = {}) => {
    const res = await call("POST", "/admin/providers", cookie, {
      type: "9router",
      name: `router-${randomUUID().slice(0, 6)}`,
      baseUrl: "http://fake-router.invalid/v1",
      apiKey: MARKER_KEY,
      ...body,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Json;
  };
  const modelBody = (body: Json = {}): Json => ({
    slug: `cc/fake-model-${randomUUID().slice(0, 6)}`,
    modelName: "Fake Model",
    tier: "standard",
    inputPrice: "0.000001",
    outputPrice: "0.000002",
    maxTokens: 8192,
    active: true,
    ...body,
  });
  /** The stored row of a live provider (PrismaService hides deleted ones). */
  const storedProvider = (id: string) => prisma.provider.findFirstOrThrow({ where: { id } });
  /** deleted_at of any provider row, deleted or not (raw SQL is not filtered). */
  const deletedAtOf = async (id: string) =>
    (await prisma.$queryRaw<{ deleted_at: Date | null }[]>`SELECT deleted_at FROM providers WHERE id = ${id}`)[0].deleted_at;
  const reveal = (ciphertext: string) => moduleRef.get(ProviderKeyCryptoService, { strict: false }).reveal(ciphertext);
  const auditRows = (action?: string) =>
    prisma.adminAuditLog.findMany({ where: { resource: "provider", ...(action && { action }) }, orderBy: { createdAt: "asc" } });

  describe("AC1: the key is never shown", () => {
    it("responses show only hasApiKey and the last 4 characters; the column decrypts to the key; no log line or audit row holds it", async () => {
      captureOutput();
      const { cookie } = await signedIn("owner");

      const created = await createVia(cookie);
      const listed = await call("GET", "/admin/providers", cookie);
      const one = await call("GET", `/admin/providers/${created.id}`, cookie);
      const tested = await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const renamed = await call("PATCH", `/admin/providers/${created.id}`, cookie, { name: "renamed" });

      const row = await storedProvider(created.id);
      expect(created).toEqual(
        expect.objectContaining({ type: "9router", status: "inactive", hasApiKey: true, apiKeyHint: MARKER_HINT, modelCount: 0 }),
      );
      expect(Object.keys(created).sort()).toEqual(
        ["apiKeyHint", "baseUrl", "createdAt", "hasApiKey", "id", "lastTestResult", "lastTestedAt", "modelCount", "name", "status", "type", "updatedAt"].sort(),
      );
      for (const body of [JSON.stringify(created), listed.body, one.body, tested.body, renamed.body]) {
        expect(body).not.toContain(MARKER_KEY);
        expect(body).not.toContain(row.apiKeyCiphertext);
      }
      expect(one.json()).toEqual({ ...created, updatedAt: expect.any(String) });
      expect(reveal(row.apiKeyCiphertext)).toBe(MARKER_KEY);
      expect(row.apiKeyCiphertext).not.toContain(MARKER_KEY);
      expect(row.credentialKeyVersion).toBe(KEY_VERSION);
      expect(fake.testRequests).toEqual([{ baseUrl: "http://fake-router.invalid/v1", apiKey: MARKER_KEY, slug: "cc/claude-sonnet-5" }]);
      const audit = await auditRows();
      expect(audit.map((entry) => entry.action)).toEqual(["create", "test", "update"]);
      for (const entry of audit) {
        expect(JSON.stringify(entry)).not.toContain(MARKER_KEY);
        expect(JSON.stringify([entry.before, entry.after])).not.toContain(MARKER_HINT);
      }
      expect(output.some((line) => line.includes("[testConnection] host=fake-router.invalid"))).toBe(true);
      expect(output.filter((line) => line.includes(MARKER_KEY) || line.includes(row.apiKeyCiphertext))).toEqual([]);
    });

    it("the audit names the changed fields only (negative: no unchanged field, no key value)", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie, { name: "before-name" });

      await call("PATCH", `/admin/providers/${created.id}`, cookie, { name: "after-name" });

      const [create, update] = await auditRows();
      expect(create.before).toEqual({ providerId: created.id });
      expect(create.after).toEqual({
        providerId: created.id,
        type: "9router",
        name: "before-name",
        baseUrl: "http://fake-router.invalid/v1",
        status: "inactive",
        changedFields: "type,name,baseUrl,status,apiKey",
      });
      expect(update.before).toEqual({ providerId: created.id, name: "before-name" });
      expect(update.after).toEqual({ providerId: created.id, name: "after-name", changedFields: "name" });
    });
  });

  describe("AC2: the key is kept, or rotated", () => {
    it("a PATCH without a key keeps the stored key; a PATCH with K2 stores K2 and the audit names apiKey without its value", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);
      const original = await storedProvider(created.id);

      const kept = await call("PATCH", `/admin/providers/${created.id}`, cookie, { name: "kept-key" });
      const afterKeep = await storedProvider(created.id);
      const rotated = await call("PATCH", `/admin/providers/${created.id}`, cookie, { apiKey: SECOND_KEY });
      const afterRotate = await storedProvider(created.id);

      expect(kept.statusCode).toBe(200);
      expect(afterKeep.apiKeyCiphertext).toBe(original.apiKeyCiphertext);
      expect(reveal(afterKeep.apiKeyCiphertext)).toBe(MARKER_KEY);
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().apiKeyHint).toBe("Wv42");
      expect(rotated.body).not.toContain(SECOND_KEY);
      expect(afterRotate.apiKeyCiphertext).not.toBe(original.apiKeyCiphertext);
      expect(reveal(afterRotate.apiKeyCiphertext)).toBe(SECOND_KEY);
      expect(afterRotate.credentialKeyVersion).toBe(KEY_VERSION);
      const rotation = (await auditRows("update"))[1];
      expect(rotation.after).toEqual({ providerId: created.id, changedFields: "apiKey" });
      expect(JSON.stringify(rotation)).not.toContain(SECOND_KEY);
      expect(JSON.stringify([rotation.before, rotation.after])).not.toContain("Wv42");
    });

    it("a type change is refused with 400 and nothing changes", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);

      const res = await call("PATCH", `/admin/providers/${created.id}`, cookie, { type: "openai_compatible" });

      expect(res.statusCode).toBe(400);
      expect((await storedProvider(created.id)).type).toBe("nine_router");
      expect(await auditRows("update")).toEqual([]);
    });

    it("PATCH may set status inactive at any time, but never active (activation is its own route)", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);
      await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      await call("POST", `/admin/providers/${created.id}/activate`, cookie);

      const toActive = await call("PATCH", `/admin/providers/${created.id}`, cookie, { status: "active" });
      const toInactive = await call("PATCH", `/admin/providers/${created.id}`, cookie, { status: "inactive" });

      expect(toActive.statusCode).toBe(400);
      expect(toInactive.statusCode).toBe(200);
      expect(toInactive.json().status).toBe("inactive");
    });
  });

  describe("AC3: test, then activate", () => {
    it("a new provider is inactive and activate answers 409 until a test succeeds", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);

      const early = await call("POST", `/admin/providers/${created.id}/activate`, cookie);
      fake.setTestResult({ isSuccessful: false, reason: "The provider answered 401: the key was refused" });
      const failed = await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const afterFailure = await call("POST", `/admin/providers/${created.id}/activate`, cookie);
      fake.setTestResult({ isSuccessful: true, reason: null });
      const passed = await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const activated = await call("POST", `/admin/providers/${created.id}/activate`, cookie);

      expect(created.status).toBe("inactive");
      expect(early.statusCode).toBe(409);
      expect(failed.statusCode).toBe(200);
      expect(failed.json()).toEqual({ isSuccessful: false, reason: "The provider answered 401: the key was refused", testedAt: expect.any(String) });
      expect(afterFailure.statusCode).toBe(409);
      expect(passed.statusCode).toBe(200);
      expect(passed.json()).toEqual({ isSuccessful: true, reason: null, testedAt: expect.any(String) });
      expect(activated.statusCode).toBe(200);
      expect(activated.json().status).toBe("active");
      expect((await storedProvider(created.id)).status).toBe("active");
    });

    it("a failed test stores its reason; each test writes its own audit row", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);
      fake.setTestResult({ isSuccessful: false, reason: "No answer within 15 seconds" });

      await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });

      const row = await storedProvider(created.id);
      expect(row.lastTestResult).toBe("No answer within 15 seconds");
      expect(row.lastTestedAt).toBeInstanceOf(Date);
      const [testRow] = await auditRows("test");
      expect(testRow.after).toEqual({
        providerId: created.id,
        slug: "cc/claude-sonnet-5",
        isSuccessful: false,
        changedFields: "lastTestedAt,lastTestResult",
      });
    });

    it.each([
      ["a base URL change", { baseUrl: "http://other-router.invalid/v1" }],
      ["a key change", { apiKey: SECOND_KEY }],
    ])("a successful test followed by %s makes activate answer 409 again", async (_label, change) => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);
      await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });

      const patched = await call("PATCH", `/admin/providers/${created.id}`, cookie, change);
      const activate = await call("POST", `/admin/providers/${created.id}/activate`, cookie);

      expect(patched.json()).toEqual(expect.objectContaining({ lastTestedAt: null, lastTestResult: null }));
      expect(activate.statusCode).toBe(409);
      expect((await storedProvider(created.id)).status).toBe("inactive");
    });

    // D195: a design decision the ticket does not state. A key or base URL change on an ACTIVE provider sets it
    // inactive (as well as clearing the test), so it must be tested and activated again.
    it.each([
      ["a base URL change", { baseUrl: "http://other-router.invalid/v1" }, "inactive"],
      ["a key change", { apiKey: SECOND_KEY }, "inactive"],
      ["a name-only change (control)", { name: "Renamed router" }, "active"],
    ])("an active provider after %s is %s", async (_label, change, expectedStatus) => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie);
      await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const activated = await call("POST", `/admin/providers/${created.id}/activate`, cookie);

      const patched = await call("PATCH", `/admin/providers/${created.id}`, cookie, change);
      const reactivated = await call("POST", `/admin/providers/${created.id}/activate`, cookie);

      expect(activated.statusCode).toBe(200);
      expect(patched.statusCode).toBe(200);
      expect(patched.json().status).toBe(expectedStatus);
      expect((await storedProvider(created.id)).status).toBe(expectedStatus);
      // Deactivated: activate answers 409 until a new test succeeds. Control: still tested, activate is allowed.
      expect(reactivated.statusCode).toBe(expectedStatus === "inactive" ? 409 : 200);
    });

    it("a test writes no usage log, reserves no credits and makes no chat request", async () => {
      const { cookie } = await signedIn("owner");
      const user = await createUser(prisma, { balance: 10 });
      const created = await createVia(cookie);

      const res = await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });

      expect(res.statusCode).toBe(200);
      expect(await prisma.usageLog.count()).toBe(0);
      expect(await prisma.transaction.count()).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance.toFixed()).toBe("10");
      expect(fake.requests).toEqual([]);
    });

    it("a test of an unknown or deleted provider is a 404; a bad slug is a 400", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const deleted = await createProvider(prisma, { createdByAdminId: adminId, deletedAt: new Date() });

      const unknown = await call("POST", `/admin/providers/${randomUUID()}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const gone = await call("POST", `/admin/providers/${deleted.id}/test`, cookie, { slug: "cc/claude-sonnet-5" });
      const created = await createVia(cookie);
      const badSlug = await call("POST", `/admin/providers/${created.id}/test`, cookie, { slug: "-bad slug" });

      expect([unknown.statusCode, gone.statusCode, badSlug.statusCode]).toEqual([404, 404, 400]);
      expect(fake.testRequests).toEqual([]);
    });
  });

  describe("AC5: model count", () => {
    it("provider A with 3 models (2 active, 1 inactive) shows 3, provider B with none shows 0", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const providerA = await createProvider(prisma, { createdByAdminId: adminId, name: "A" });
      const providerB = await createProvider(prisma, { createdByAdminId: adminId, name: "B" });
      await createModel(prisma, { providerRecordId: providerA.id });
      await createModel(prisma, { providerRecordId: providerA.id });
      await createModel(prisma, { providerRecordId: providerA.id, active: false });

      const res = await call("GET", "/admin/providers", cookie);

      expect(res.statusCode).toBe(200);
      expect(res.json().map((provider: Json) => [provider.name, provider.modelCount])).toEqual([
        ["A", 3],
        ["B", 0],
      ]);
      expect((await call("GET", `/admin/providers/${providerB.id}`, cookie)).json().modelCount).toBe(0);
    });
  });

  describe("AC6: models nested under their provider", () => {
    it("GET /A/models lists m and none of B's; PATCH /B/models/m is a 404 and m is unchanged", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const providerA = await createProvider(prisma, { createdByAdminId: adminId });
      const providerB = await createProvider(prisma, { createdByAdminId: adminId });
      const created = await call("POST", `/admin/providers/${providerA.id}/models`, cookie, modelBody({ slug: "cc/model-m" }));
      const other = await createModel(prisma, { providerRecordId: providerB.id, slug: "cc/model-n" });
      const m = created.json();

      const listA = await call("GET", `/admin/providers/${providerA.id}/models`, cookie);
      const crossPatch = await call("PATCH", `/admin/providers/${providerB.id}/models/${m.id}`, cookie, { modelName: "hijacked" });
      const ownPatch = await call("PATCH", `/admin/providers/${providerA.id}/models/${m.id}`, cookie, { active: false });

      expect(created.statusCode).toBe(201);
      expect(m).toEqual(
        expect.objectContaining({ providerRecordId: providerA.id, slug: "cc/model-m", inputPrice: "0.000001", cachedInputPrice: null, active: true }),
      );
      expect(listA.json().map((model: Json) => model.slug)).toEqual(["cc/model-m"]);
      expect(listA.body).not.toContain(other.id);
      expect(crossPatch.statusCode).toBe(404);
      expect(ownPatch.statusCode).toBe(200);
      const stored = await prisma.aiModel.findUniqueOrThrow({ where: { id: m.id } });
      expect(stored.modelName).toBe("Fake Model");
      expect(stored.active).toBe(false);
    });

    it("RX-177 pin (D149 option B): a model created through the API stores provider_id = '' and provider is not written", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });

      const created = await call("POST", `/admin/providers/${provider.id}/models`, cookie, modelBody());

      const [row] = await prisma.$queryRaw<{ provider_id: string; provider: string; provider_record_id: string }[]>`
        SELECT provider_id, provider, provider_record_id FROM ai_models WHERE id = ${created.json().id}`;
      expect(row).toEqual({ provider_id: "", provider: "openrouter", provider_record_id: provider.id });
      expect(created.json()).not.toHaveProperty("providerId");
      expect(created.json()).not.toHaveProperty("provider");
    });

    it("model writes are audited with the changed fields", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });
      const m = (await call("POST", `/admin/providers/${provider.id}/models`, cookie, modelBody({ slug: "cc/audited" }))).json();

      await call("PATCH", `/admin/providers/${provider.id}/models/${m.id}`, cookie, { active: false, tier: "standard" });

      const rows = await prisma.adminAuditLog.findMany({ where: { resource: "ai_model" }, orderBy: { createdAt: "asc" } });
      expect(rows.map((row) => row.action)).toEqual(["create", "update"]);
      expect(rows[0].after).toEqual(expect.objectContaining({ providerId: provider.id, modelId: m.id, slug: "cc/audited", active: true }));
      expect(rows[1].before).toEqual({ providerId: provider.id, modelId: m.id, active: true });
      expect(rows[1].after).toEqual({ providerId: provider.id, modelId: m.id, active: false, changedFields: "active" });
    });
  });

  describe("AC7: permissions", () => {
    /** Every write route, against a real provider and model. */
    const writes = (providerId: string, modelId: string): [string, "POST" | "PATCH" | "DELETE", string, object?][] => [
      ["create provider", "POST", "/admin/providers", { type: "9router", name: "x", baseUrl: "http://x.invalid", apiKey: MARKER_KEY }],
      ["update provider", "PATCH", `/admin/providers/${providerId}`, { name: "y" }],
      ["test provider", "POST", `/admin/providers/${providerId}/test`, { slug: "cc/x" }],
      ["activate provider", "POST", `/admin/providers/${providerId}/activate`],
      ["delete provider", "DELETE", `/admin/providers/${providerId}`],
      ["create model", "POST", `/admin/providers/${providerId}/models`, modelBody()],
      ["update model", "PATCH", `/admin/providers/${providerId}/models/${modelId}`, { active: false }],
    ];

    it("a staff user without the write permissions (viewer) gets 403 on every write and can read", async () => {
      const { adminId } = await signedIn("owner");
      const { cookie } = await signedIn("viewer");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });
      const model = await createModel(prisma, { providerRecordId: provider.id });

      const statuses: Record<string, number> = {};
      for (const [label, method, url, payload] of writes(provider.id, model.id)) {
        statuses[label] = (await call(method, url, cookie, payload)).statusCode;
      }
      const reads = [
        (await call("GET", "/admin/providers", cookie)).statusCode,
        (await call("GET", `/admin/providers/${provider.id}/models`, cookie)).statusCode,
      ];

      expect(Object.values(statuses).every((status) => status === 403)).toBe(true);
      expect(Object.keys(statuses)).toHaveLength(7);
      expect(reads).toEqual([200, 200]);
      expect(fake.testRequests).toEqual([]);
      expect(await prisma.provider.count()).toBe(1);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("operations (models:write, no providers permission) gets 403 on provider reads and writes", async () => {
      const { adminId } = await signedIn("owner");
      const { cookie } = await signedIn("operations");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });
      const model = await createModel(prisma, { providerRecordId: provider.id });

      const providerWrites = writes(provider.id, model.id).slice(0, 5);
      const statuses = [];
      for (const [, method, url, payload] of providerWrites) statuses.push((await call(method, url, cookie, payload)).statusCode);
      statuses.push((await call("GET", "/admin/providers", cookie)).statusCode);
      statuses.push((await call("GET", `/admin/providers/${provider.id}`, cookie)).statusCode);

      expect(statuses).toEqual([403, 403, 403, 403, 403, 403, 403]);
    });

    it("the support role gets 403 on GET too", async () => {
      const { adminId } = await signedIn("owner");
      const { cookie } = await signedIn("support");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });

      const statuses = [
        (await call("GET", "/admin/providers", cookie)).statusCode,
        (await call("GET", `/admin/providers/${provider.id}`, cookie)).statusCode,
        (await call("GET", `/admin/providers/${provider.id}/models`, cookie)).statusCode,
      ];

      expect(statuses).toEqual([403, 403, 403]);
    });
  });

  describe("AC8: model validation", () => {
    it.each([
      ["a slug that fails the pattern (leading dash)", { slug: "-model" }],
      ["a slug with a space", { slug: "cc/model x" }],
      ["a slug longer than 128 characters", { slug: `a${"b".repeat(128)}` }],
      ["a tier outside MODEL_TIERS", { tier: "ultra" }],
      ["no active field (no silent default)", { active: undefined }],
      ["a price that is not a decimal string", { inputPrice: 0.000001 }],
    ])("%s is a 400 and nothing is written", async (_label, change) => {
      const { cookie, adminId } = await signedIn("owner");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });

      const res = await call("POST", `/admin/providers/${provider.id}/models`, cookie, modelBody(change));

      expect(res.statusCode).toBe(400);
      expect(await prisma.aiModel.count()).toBe(0);
    });

    it("a slug that exists on any provider is a 409", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const providerA = await createProvider(prisma, { createdByAdminId: adminId });
      const providerB = await createProvider(prisma, { createdByAdminId: adminId });
      await createModel(prisma, { providerRecordId: providerA.id, slug: "cc/shared" });

      const res = await call("POST", `/admin/providers/${providerB.id}/models`, cookie, modelBody({ slug: "cc/shared" }));

      expect(res.statusCode).toBe(409);
      expect(await prisma.aiModel.count({ where: { providerRecordId: providerB.id } })).toBe(0);
    });

    it("a PATCH that changes the slug is refused (400) and the slug stays", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const provider = await createProvider(prisma, { createdByAdminId: adminId });
      const model = await createModel(prisma, { providerRecordId: provider.id, slug: "cc/fixed" });

      const res = await call("PATCH", `/admin/providers/${provider.id}/models/${model.id}`, cookie, { slug: "cc/renamed" });

      expect(res.statusCode).toBe(400);
      expect((await prisma.aiModel.findUniqueOrThrow({ where: { id: model.id } })).slug).toBe("cc/fixed");
    });

    it("an unknown or deleted provider id is a 404 on every model route", async () => {
      const { cookie, adminId } = await signedIn("owner");
      const deleted = await createProvider(prisma, { createdByAdminId: adminId, deletedAt: new Date() });
      const model = await createModel(prisma, { providerRecordId: deleted.id, active: false });

      const statuses = [];
      for (const providerId of [randomUUID(), deleted.id]) {
        statuses.push((await call("GET", `/admin/providers/${providerId}/models`, cookie)).statusCode);
        statuses.push((await call("POST", `/admin/providers/${providerId}/models`, cookie, modelBody())).statusCode);
        statuses.push((await call("PATCH", `/admin/providers/${providerId}/models/${model.id}`, cookie, { active: true })).statusCode);
      }

      expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
      expect(await prisma.aiModel.count()).toBe(1);
    });
  });

  describe("AC9: delete", () => {
    it("with an active model DELETE is a 409; once deactivated, deletedAt is set and the provider disappears from GET", async () => {
      const { cookie } = await signedIn("owner");
      const created = await createVia(cookie, { name: "to-delete" });
      const m = (await call("POST", `/admin/providers/${created.id}/models`, cookie, modelBody())).json();

      const refused = await call("DELETE", `/admin/providers/${created.id}`, cookie);
      await call("PATCH", `/admin/providers/${created.id}/models/${m.id}`, cookie, { active: false });
      const deleted = await call("DELETE", `/admin/providers/${created.id}`, cookie);
      const list = await call("GET", "/admin/providers", cookie);
      const one = await call("GET", `/admin/providers/${created.id}`, cookie);
      const again = await call("DELETE", `/admin/providers/${created.id}`, cookie);

      expect(refused.statusCode).toBe(409);
      expect(deleted.statusCode).toBe(204);
      expect(await deletedAtOf(created.id)).toBeInstanceOf(Date);
      expect(list.json()).toEqual([]);
      expect(one.statusCode).toBe(404);
      expect(again.statusCode).toBe(404);
      expect((await auditRows("delete")).map((row) => row.after)).toEqual([{ providerId: created.id, deleted: true, changedFields: "deleted" }]);
    });

    it("a name is unique among live providers only: a duplicate live name is a 409, a deleted one's name is free", async () => {
      const { cookie } = await signedIn("owner");
      const first = await createVia(cookie, { name: "same-name" });

      const duplicate = await call("POST", "/admin/providers", cookie, {
        type: "openai_compatible",
        name: "same-name",
        baseUrl: "https://fake-openai.invalid/v1",
        apiKey: SECOND_KEY,
      });
      await call("DELETE", `/admin/providers/${first.id}`, cookie);
      const reused = await createVia(cookie, { name: "same-name" });

      expect(duplicate.statusCode).toBe(409);
      expect(reused.id).not.toBe(first.id);
    });
  });
});
