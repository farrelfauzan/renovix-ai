import { isAllowedAdminOrigin } from "./is-allowed-admin-origin";

const BACK_OFFICE = "https://admin.renovix.id";

describe("isAllowedAdminOrigin (RX-156)", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("%s with the back-office origin: allowed", (method) => {
    expect(isAllowedAdminOrigin(BACK_OFFICE, method, BACK_OFFICE)).toBe(true);
  });

  it.each(["https://chat.renovix.id", "https://admin.renovix.id.evil.example", "http://admin.renovix.id", "null", ""])(
    "Origin %p: refused, also on GET",
    (origin) => {
      expect(isAllowedAdminOrigin(origin, "GET", BACK_OFFICE)).toBe(false);
      expect(isAllowedAdminOrigin(origin, "POST", BACK_OFFICE)).toBe(false);
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s without Origin: refused", (method) => {
    expect(isAllowedAdminOrigin(undefined, method, BACK_OFFICE)).toBe(false);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s without Origin: allowed", (method) => {
    expect(isAllowedAdminOrigin(undefined, method, BACK_OFFICE)).toBe(true);
  });
});
