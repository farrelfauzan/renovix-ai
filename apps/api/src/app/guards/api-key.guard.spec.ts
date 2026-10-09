import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { ApiKeyGuard } from "./api-key.guard";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

const contextFor = (request: { headers: Record<string, string>; user?: unknown }) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe("ApiKeyGuard (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let guard: ApiKeyGuard;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [ApiKeyGuard] }));
    guard = moduleRef.get(ApiKeyGuard);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  it("allows a user's own API key and attaches the user", async () => {
    const user = await createUser(prisma, { apiKey: "sk_live_valid-key" });
    const request = { headers: { authorization: "Bearer sk_live_valid-key" } } as {
      headers: Record<string, string>;
      user?: unknown;
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: user.id, email: user.email });
  });

  it.each([
    ["no Authorization header", {}],
    ["a key without the sk_live_ prefix", { authorization: "Bearer not-a-live-key" }],
    ["an unknown key", { authorization: "Bearer sk_live_unknown" }],
  ])("denies %s", async (_case, headers: Record<string, string>) => {
    await createUser(prisma, { apiKey: "sk_live_valid-key" });

    await expect(guard.canActivate(contextFor({ headers }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // RX-15 characterization: wrong credential type, malformed header, and the
  // closest thing to "expired" (API keys have no expiry; a replaced key is dead).
  it.each([
    ["a JWT (wrong credential type)", () => `Bearer ${jwt.sign({ userId: "u" }, "any-secret")}`],
    ["a lowercase bearer scheme", () => "bearer sk_live_valid-key"],
    ["a Basic scheme", () => "Basic sk_live_valid-key"],
    ["the key without a scheme", () => "sk_live_valid-key"],
  ])("denies %s", async (_case, header: () => string) => {
    await createUser(prisma, { apiKey: "sk_live_valid-key" });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: header() } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("denies a key after the user's key was replaced (no expiry field; rotation is the only way a key dies)", async () => {
    const user = await createUser(prisma, { apiKey: "sk_live_old-key" });
    await prisma.user.update({ where: { id: user.id }, data: { apiKey: "sk_live_new-key" } });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: "Bearer sk_live_old-key" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // NOTE (RX-15): user.status ("active" | "suspended" | "deleted") is not read
  // by any guard or service today; a suspended user's key still works.
  it("allows the key of a user with status 'suspended' (status is not checked)", async () => {
    const user = await createUser(prisma, { apiKey: "sk_live_suspended", status: "suspended" });
    const request = { headers: { authorization: "Bearer sk_live_suspended" } } as {
      headers: Record<string, string>;
      user?: unknown;
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: user.id });
  });
});
