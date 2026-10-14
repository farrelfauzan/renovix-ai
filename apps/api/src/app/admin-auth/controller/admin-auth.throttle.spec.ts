import { APP_GUARD } from "@nestjs/core";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthModule } from "../admin-auth.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { AdminSessionService } from "../service/admin-session.service";
import { adminHttp, createAdmin } from "../../../../test/admin-auth";

// RX-94: sign-in and re-authentication allow 10 calls per minute per caller (the app's ThrottlerGuard,
// registered here as in AppModule with its default of 60 per minute). Real clock: the throttler keeps time itself.
describe("Back-office sign-in throttling (RX-94, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof adminHttp>;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [AdminAuthModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }));
    app = await createFastifyApp(moduleRef);
    http = adminHttp(app);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  it("POST /admin/auth/sign-in: 10 calls in a minute are answered, the 11th gets 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await http.signIn({ email: "not-an-email" })).statusCode);

    expect(statuses).toEqual([...Array(10).fill(400), 429]);
  });

  it("POST /admin/auth/reauth: 10 calls in a minute are answered, the 11th gets 429", async () => {
    const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
    // Started directly: the sign-in route's own limit is used up by the test above.
    const cookie = `rx_admin_access=${(await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest")).accessToken}`;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await http.call("POST", "/admin/auth/reauth", { cookie }, { totp: "x" })).statusCode);

    expect(statuses).toEqual([...Array(10).fill(400), 429]);
  });
});
