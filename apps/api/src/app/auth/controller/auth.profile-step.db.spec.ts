import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthController } from "./auth.controller";
import { AuthService } from "../service/auth.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-33: the profile step after first sign-in, PUT /auth/me/profile (session only, the session user's own row),
// and GET /auth/me's profileCompleted. Real controller and service, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("RNX-33: PUT /auth/me/profile and GET /auth/me (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ controllers: [AuthController], providers: [AuthService] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const validProfile = {
    name: "Dewi Anggraini",
    role: "Operations",
    country: "ID",
    timezone: "Asia/Jakarta",
    language: "id",
    goal: "Reports and documents, Data analysis",
  };

  const saveProfile = (user: { id: string; email: string } | null, payload: unknown) =>
    app.inject({ method: "PUT", url: "/auth/me/profile", headers: user ? asSessionUser(user) : {}, payload: payload as object });

  const getMe = (user: { id: string; email: string }) =>
    app.inject({ method: "GET", url: "/auth/me", headers: asSessionUser(user) });

  it("a valid profile: 200, every field stored on the session user, profile_completed_at set", async () => {
    const user = await createUser(prisma, { name: "From Google" });
    const before = Date.now();

    const res = await saveProfile(user, validProfile);

    expect(res.statusCode).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({
      name: "Dewi Anggraini",
      jobTitle: "Operations",
      country: "ID",
      timezone: "Asia/Jakarta",
      locale: "id",
      signupGoal: "Reports and documents, Data analysis",
    });
    expect(stored.profileCompletedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(res.json()).toMatchObject({ id: user.id, profileCompleted: true, country: "ID", signupGoal: validProfile.goal });
  });

  it("a second save stores the new answers and keeps the first completion time", async () => {
    const user = await createUser(prisma);
    await saveProfile(user, validProfile);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).profileCompletedAt;

    const res = await saveProfile(user, { ...validProfile, name: "Dewi A.", timezone: "Asia/Makassar" });

    expect(res.statusCode).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ name: "Dewi A.", timezone: "Asia/Makassar" });
    expect(first).not.toBeNull();
    expect(stored.profileCompletedAt).toEqual(first);
  });

  it.each([
    ["an unknown timezone", { timezone: "Mars/Base" }, "timezone"],
    ["an offset instead of an IANA zone", { timezone: "+07:00" }, "timezone"],
    ["a country name instead of an ISO code", { country: "Indonesia" }, "country"],
    ["an unassigned country code", { country: "XX" }, "country"],
    ["a language outside the allowed set", { language: "fr" }, "language"],
    ["an empty name", { name: "  " }, "name"],
    ["an empty goal", { goal: "" }, "goal"],
    // An unknown key is refused as a whole (Zod reports it as a form error, so no field is named).
    ["another user's id in the body", { userId: "00000000-0000-4000-8000-000000000000" }, undefined],
  ])("%s: 400, nothing stored", async (_name, change, field) => {
    const user = await createUser(prisma, { name: "Before" });

    const res = await saveProfile(user, { ...validProfile, ...change });

    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.details)).toEqual(field ? [field] : []);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      name: "Before",
      country: null,
      signupGoal: null,
      profileCompletedAt: null,
      timezone: "UTC",
      locale: "en",
    });
  });

  it("no session: 401, nothing stored", async () => {
    const user = await createUser(prisma);

    const res = await saveProfile(null, validProfile);

    expect(res.statusCode).toBe(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ profileCompletedAt: null, country: null });
  });

  it("writes only the session user's row; another user is untouched", async () => {
    const alice = await createUser(prisma, { name: "Alice" });
    const bob = await createUser(prisma, { name: "Bob" });

    await saveProfile(alice, validProfile);

    expect(await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).toMatchObject({
      name: "Bob",
      country: null,
      profileCompletedAt: null,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).profileCompletedAt).not.toBeNull();
  });

  it("GET /auth/me: profileCompleted false before the step, true after, with the new fields", async () => {
    const user = await createUser(prisma);

    const before = await getMe(user);
    await saveProfile(user, validProfile);
    const after = await getMe(user);

    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ id: user.id, profileCompleted: false, country: null, signupGoal: null, profileCompletedAt: null });
    expect(after.json()).toMatchObject({
      id: user.id,
      profileCompleted: true,
      name: "Dewi Anggraini",
      jobTitle: "Operations",
      country: "ID",
      timezone: "Asia/Jakarta",
      locale: "id",
      signupGoal: validProfile.goal,
    });
    expect(after.json().profileCompletedAt).toEqual(expect.any(String));
  });
});
