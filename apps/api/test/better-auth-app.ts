import type { TestingModule } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { createFastifyAdapter } from "../src/common/utils/create-fastify-adapter";
import { BetterAuthController } from "../src/app/auth/controller/better-auth.controller";
import { createTestModule } from "./test-module";
import { resetDatabase } from "./test-database";

// The real better-auth behind the real BetterAuthController, on the test database (RNX-168). The spec loads
// the real better-auth and lib/auth through the jest.mock factories in real-better-auth.ts.

/** Four wrong-password sign-ins in one better-auth bucket: three answered (401), the fourth limited (429). */
export const LIMITED_ON_FOURTH = [401, 401, 401, 429];
/** Four wrong-password sign-ins that better-auth does not limit. */
export const NOT_LIMITED = [401, 401, 401, 401];

export interface BetterAuthTestApp {
  readonly moduleRef: TestingModule;
  readonly prisma: PrismaService;
  readonly app: NestFastifyApplication;
}

/**
 * Starts BetterAuthController on the test database (emptied first) under /api, as main.ts does (better-auth's
 * basePath is /api/auth/better). Close with `app.close()`.
 */
export async function startBetterAuthApp(): Promise<BetterAuthTestApp> {
  const { moduleRef, prisma } = await createTestModule({ controllers: [BetterAuthController] });
  await resetDatabase(prisma);
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
  app.setGlobalPrefix("api");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { moduleRef, prisma, app };
}

/** One POST to a better-auth endpoint from a socket address, with the given headers. */
const postToBetterAuth = (
  app: NestFastifyApplication,
  path: string,
  remoteAddress: string,
  headers: Record<string, string>,
  payload: object,
): Promise<LightMyRequestResponse> =>
  app.inject({ method: "POST", url: `/api/auth/better${path}`, remoteAddress, headers, payload });

/** The status codes of four wrong-password sign-ins from one socket address; `headers(i)` gives attempt i's. */
export async function fourSignInStatuses(
  app: NestFastifyApplication,
  remoteAddress: string,
  headers: (i: number) => Record<string, string>,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < LIMITED_ON_FOURTH.length; i++) {
    const response = await postToBetterAuth(app, "/sign-in/email", remoteAddress, headers(i), {
      email: "nobody@renovix.test",
      password: "wrong-password",
    });
    statuses.push(response.statusCode);
  }
  return statuses;
}

/** Signs up a new user (better-auth signs it in at once) and returns the ipAddress stored on its session. */
export async function sessionIpAfterSignUp(
  { app, prisma }: BetterAuthTestApp,
  email: string,
  headers: Record<string, string>,
): Promise<string | null | undefined> {
  const response = await postToBetterAuth(app, "/sign-up/email", "10.0.0.1", headers, {
    email,
    password: "a-long-test-password",
    name: "RNX-168",
  });
  expect(response.statusCode).toBe(200);
  const session = await prisma.session.findFirst({ where: { user: { email } } });
  return session?.ipAddress;
}
