import { parseAdminOrigin } from "./parse-admin-origin";

describe("parseAdminOrigin (RX-156)", () => {
  it.each(["https://admin.renovix.id", "http://localhost:4400"])("takes the origin %s", (origin) => {
    expect(parseAdminOrigin(origin)).toBe(origin);
  });

  it.each([[undefined], [""]])("refuses %p: the value is required", (raw) => {
    expect(() => parseAdminOrigin(raw)).toThrow("ADMIN_ORIGIN is required");
  });

  it.each([
    ["https://admin.renovix.id/"],
    ["https://admin.renovix.id/login"],
    ["admin.renovix.id"],
    ["*"],
    ["null"],
    ["https://admin.renovix.id,https://chat.renovix.id"],
  ])("refuses %s: not exactly one origin", (raw) => {
    expect(() => parseAdminOrigin(raw)).toThrow("ADMIN_ORIGIN must be an origin");
  });
});
