import { AuditReasonDto } from "./audit-reason.dto";

const MAX_REASON_LENGTH = 500;

describe("AuditReasonDto", () => {
  it("rejects a reason that is only spaces", () => {
    expect(AuditReasonDto.safeParse("   ").success).toBe(false);
  });
  it("accepts a one-character reason", () => {
    expect(AuditReasonDto.safeParse("a")).toEqual({ success: true, data: "a" });
  });
  it("accepts exactly 500 characters", () => {
    const inputReason = "r".repeat(MAX_REASON_LENGTH);
    expect(AuditReasonDto.safeParse(inputReason)).toEqual({ success: true, data: inputReason });
  });
  it("rejects 501 characters", () => {
    expect(AuditReasonDto.safeParse("r".repeat(MAX_REASON_LENGTH + 1)).success).toBe(false);
  });
  it("trims the reason", () => {
    expect(AuditReasonDto.parse("  x  ")).toBe("x");
  });
});
