import { hasAllPermissions } from "./has-all-permissions";

describe("hasAllPermissions", () => {
  it("true when every required permission is held, and when none is required", () => {
    expect(hasAllPermissions(["users:read", "credits:adjust"], ["credits:adjust", "users:read"])).toBe(true);
    expect(hasAllPermissions([], [])).toBe(true);
  });

  it("false when one required permission is missing", () => {
    expect(hasAllPermissions(["users:read"], ["users:read", "credits:adjust"])).toBe(false);
    expect(hasAllPermissions([], ["users:read"])).toBe(false);
  });

  it("matches whole names only", () => {
    expect(hasAllPermissions(["credits:adjust_all", "credits"], ["credits:adjust"])).toBe(false);
  });
});
