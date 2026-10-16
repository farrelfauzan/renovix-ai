import { cursorOf } from "./cursor-of";
import type { AuditLogRecord } from "../types/audit-log-record";

const FILLER: AuditLogRecord = {
  id: "filler",
  adminId: "admin-1",
  adminEmail: "admin@example.test",
  resource: "users",
  action: "update",
  before: {},
  after: {},
  reason: "made-up reason",
  effectiveAt: new Date("2026-10-15T08:00:00.000Z"),
  createdAt: new Date("2026-10-15T08:00:00.000Z"),
  cursorAt: "2026-10-15T08:00:00.000000Z",
};

describe("RX-131: cursorOf (the keyset cursor of an audit log row)", () => {
  it.each([
    {
      name: "cursorAt keeps the microseconds that createdAt loses",
      record: { ...FILLER, id: "a1", createdAt: new Date("2026-10-15T08:00:01.123Z"), cursorAt: "2026-10-15T08:00:01.123456Z" },
      expected: { createdAt: "2026-10-15T08:00:01.123456Z", id: "a1" },
    },
    {
      name: "createdAt is not read",
      record: { ...FILLER, id: "b2", createdAt: new Date("2020-01-01T00:00:00.000Z"), cursorAt: "2026-10-15T09:30:00.000001Z" },
      expected: { createdAt: "2026-10-15T09:30:00.000001Z", id: "b2" },
    },
  ])("$name", async ({ record, expected }) => {
    const actual = await cursorOf(record);

    expect(actual).toEqual(expected);
  });
});
