import { BadRequestException } from "@nestjs/common";
import { PasswordService } from "./password.service";
import { parseAdminAuthConfig } from "../utils/parse-admin-auth-config";

// RX-94: Argon2id with the configured cost, and the real breached list (SecLists Pwdb_top-1000000, 12+ characters).
describe("PasswordService", () => {
  const service = new PasswordService(parseAdminAuthConfig(() => undefined));

  it("hashes with Argon2id, m=19456 KiB, t=2, p=1, and verifies", async () => {
    const hash = await service.hash("Tq8#vLm2Pz!w");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await service.verify(hash, "Tq8#vLm2Pz!w")).toBe(true);
    expect(await service.verify(hash, "Tq8#vLm2Pz!x")).toBe(false);
  });

  it("without a stored hash (unknown email) does the work and answers false", async () => {
    expect(await service.verify(undefined, "Tq8#vLm2Pz!w")).toBe(false);
  });

  it.each([["q1w2e3r4t5y6"], ["1qaz2wsx3edc"], ["Q1W2E3R4T5Y6"]])("refuses %s from the breached list", (password) => {
    expect(() => service.assertAcceptable(password, "owner@example.com")).toThrow(BadRequestException);
    expect(() => service.assertAcceptable(password, "owner@example.com")).toThrow("breached");
  });

  it("accepts a password that is not on the list", () => {
    expect(() => service.assertAcceptable("Tq8#vLm2Pz!w", "owner@example.com")).not.toThrow();
  });
});
