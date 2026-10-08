import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
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
});
