import { toAuditSettingValue } from "./to-audit-setting-value";

describe("toAuditSettingValue (RNX-35)", () => {
  it("a list becomes its JSON text; a number, a boolean and null stay as they are", () => {
    expect(toAuditSettingValue(["user-1", "user-2"])).toBe('["user-1","user-2"]');
    expect(toAuditSettingValue([])).toBe("[]");
    expect(toAuditSettingValue(100)).toBe(100);
    expect(toAuditSettingValue(true)).toBe(true);
    expect(toAuditSettingValue(null)).toBeNull();
  });
});
