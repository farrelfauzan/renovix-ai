import { decodeAuditLogCursor } from "./decode-audit-log-cursor";
import { encodeAuditLogCursor } from "./encode-audit-log-cursor";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

// RX-164: the audit log page cursor is opaque; anything not written by encodeAuditLogCursor is refused.
describe("decodeAuditLogCursor", () => {
  it("reads back what encodeAuditLogCursor wrote", () => {
    const cursor = { createdAt: "2026-10-15T08:00:01.123456Z", id: "3f952ed0-8ee2-81b5-8378-fa5a975a0c0f" };

    expect(decodeAuditLogCursor(encodeAuditLogCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ["not base64 JSON", "%%%"],
    ["an object", encode({ createdAt: "2026-10-15T08:00:01.123456Z", id: "a" })],
    ["milliseconds only", encode(["2026-10-15T08:00:01.123Z", "a"])],
    ["an impossible date", encode(["2026-13-45T08:00:01.123456Z", "a"])],
    ["an id with SQL in it", encode(["2026-10-15T08:00:01.123456Z", "a' OR 1=1 --"])],
    ["three parts", encode(["2026-10-15T08:00:01.123456Z", "a", "b"])],
  ])("refuses %s", (_case, value) => {
    expect(decodeAuditLogCursor(value)).toBeNull();
  });
});
