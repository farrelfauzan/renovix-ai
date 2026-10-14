import { Controller, Get, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import type { LightMyRequestResponse } from "fastify";
import { generateSync } from "otplib";
import { PasswordService } from "../src/app/admin-auth/service/password.service";
import { TotpService } from "../src/app/admin-auth/service/totp.service";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { Access } from "../src/common/decorators/access.decorator";

// Shared tooling of the back-office sign-in specs (RX-94). Obviously fake values only.

/** A password that passes every rule. */
export const ADMIN_PASSWORD = "Tq8#vLm2Pz!w-rx94-test";
export const WRONG_PASSWORD = "Wrong#Pass-rx94-test";
export const MINUTE = 60_000;
/** Base time of the fake clock: one second into a 30-second TOTP step. */
export const START = new Date("2026-10-14T08:00:01Z");
/** Only Date is faked: the database driver and Fastify keep their real timers. The clock stands still. */
const NOT_DATE = [
  "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
  "clearInterval", "setTimeout", "clearTimeout",
] as const;

/** Fakes Date only, at START. Undo with `jest.useRealTimers()`. */
export const useFakeDate = () => jest.useFakeTimers({ doNotFake: [...NOT_DATE], now: START });
/** Moves the fake clock forward. */
export const advance = (ms: number) => jest.setSystemTime(Date.now() + ms);
/** Moves to the next 30-second TOTP step. */
export const nextStep = () => advance(30_000);
/** The current TOTP code of a secret, on the fake clock. */
export const totpCode = (secret: string): string => generateSync({ secret });

/** A test-only back-office route (criterion 1: "every other back-office route answers 403"). */
@Controller("admin/probe")
export class BackOfficeProbeController {
  @Get()
  @Access({ auth: ["staff"] })
  probe(@Req() request: { admin?: unknown }) {
    return { admin: request.admin ?? null };
  }

  @Get("sensitive")
  @Access({ auth: ["staff"], reauth: true })
  sensitive(@Req() request: { admin?: unknown }) {
    return { admin: request.admin ?? null };
  }
}

/** Creates an admin with ADMIN_PASSWORD; `enrolled` gives them an active TOTP secret (returned). */
export async function createAdmin(
  prisma: PrismaService,
  moduleRef: TestingModule,
  { email, enrolled = false, role = "admin" }: { email: string; enrolled?: boolean; role?: string },
): Promise<{ id: string; email: string; secret: string }> {
  const passwordHash = await moduleRef.get(PasswordService).hash(ADMIN_PASSWORD);
  const row = await prisma.adminUser.create({ data: { email, passwordHash, role } });
  if (!enrolled) return { id: row.id, email, secret: "" };
  const { secret, encrypted } = moduleRef.get(TotpService).createSecret(row.id, email);
  await prisma.adminUser.update({ where: { id: row.id }, data: { totpSecretEncrypted: encrypted, totpEnrolledAt: new Date() } });
  return { id: row.id, email, secret };
}

/** The Set-Cookie values of a response, as an array. */
export const setCookies = (res: LightMyRequestResponse): string[] => {
  const header = res.headers["set-cookie"];
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
};

/** `name=value` of the named cookie set by the response, ready for a Cookie header. */
export const cookieOf = (res: LightMyRequestResponse, name: string): string => {
  const found = setCookies(res).find((cookie) => cookie.startsWith(`${name}=`));
  if (!found) throw new Error(`no ${name} cookie in the response`);
  return found.split(";")[0];
};
export const accessCookie = (res: LightMyRequestResponse) => cookieOf(res, "rx_admin_access");
export const refreshCookie = (res: LightMyRequestResponse) => cookieOf(res, "rx_admin_refresh");

/** HTTP helpers on the app (routes have no /api/v1 prefix in tests). */
export const adminHttp = (app: NestFastifyApplication) => ({
  signIn: (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/admin/auth/sign-in", payload: body }),
  refresh: (cookie?: string) =>
    app.inject({ method: "POST", url: "/admin/auth/refresh", headers: cookie ? { cookie } : {} }),
  call: (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string> = {}, payload?: object) =>
    app.inject({ method, url, headers, payload }),
});
