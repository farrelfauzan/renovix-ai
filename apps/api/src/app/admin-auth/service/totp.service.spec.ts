import type { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { AdminUserRepository } from "../repository/admin-user.repository";
import { parseAdminAuthConfig } from "../utils/parse-admin-auth-config";
import { TotpService } from "./totp.service";

// RNX-349: the otpauth URI the back office turns into a QR code names the issuer and the admin's email.
describe("TotpService.createSecret", () => {
  const config = { getOrThrow: () => randomBytes(32).toString("base64") } as unknown as ConfigService;
  const service = new TotpService(config, parseAdminAuthConfig(() => undefined), {} as AdminUserRepository);

  it("builds an otpauth URI with issuer Renovix Admin as parameter and label prefix, and the admin's email as label", () => {
    const { secret, otpauthUri } = service.createSecret("admin-1", "ops@example.com");

    const uri = new URL(otpauthUri);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("issuer")).toBe("Renovix Admin");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Renovix Admin:ops@example.com");
  });
});
