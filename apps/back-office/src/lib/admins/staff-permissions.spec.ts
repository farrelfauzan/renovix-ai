/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OWNER_ONLY_PERMISSIONS, STAFF_PERMISSIONS } from "./staff-permissions";

// RNX-269: the apps share no code, so the back-office copy of the list is checked against the API's file text.
const API_FILE = resolve(__dirname, "../../../../api/src/app/admin-auth/config/staff-permissions.ts");

/** The quoted entries of the API's `STAFF_PERMISSIONS` array, in order (comment lines are skipped). */
const readApiPermissions = (): string[] => {
  const source = readFileSync(API_FILE, "utf8");
  const body = source.slice(source.indexOf("STAFF_PERMISSIONS = ["), source.indexOf("] as const"));
  return body.split("\n").flatMap((line) => (line.trim().startsWith("//") ? [] : [...line.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((match) => match[1])));
};

describe("STAFF_PERMISSIONS copy (RNX-269)", () => {
  it("holds the same permissions, in the same order, as the API's list", () => {
    const expectedApiPermissions = readApiPermissions();

    expect(expectedApiPermissions.length).toBeGreaterThan(20);
    expect([...STAFF_PERMISSIONS]).toEqual(expectedApiPermissions);
  });

  it("keeps profit:read and reconciliation:write off the owner-only list (D134)", () => {
    expect(STAFF_PERMISSIONS).toEqual(expect.arrayContaining(["profit:read", "reconciliation:write"]));
    expect(OWNER_ONLY_PERMISSIONS).toEqual(["admins:write", "roles:write"]);
  });
});
