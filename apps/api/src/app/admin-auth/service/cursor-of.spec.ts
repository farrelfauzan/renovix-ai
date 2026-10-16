import { AdminAuditLogService } from "./admin-audit-log.service";
import type { AuditLogRecord } from "../types/audit-log-record";

// cursorOf is not exported today: it is reached through listPage, whose next-page cursor is
// encodeAuditLogCursor(cursorOf(last row of the page)), base64url of [createdAt, id].
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
const cursorOf = async (record: AuditLogRecord) => {
  const records = [...Array.from({ length: 49 }, () => FILLER), record, FILLER];
  const service = new AdminAuditLogService({ findPage: async () => records } as never, { holdsReadPii: async () => true } as never);
  const { nextCursor } = await service.listPage({} as never, {});
  const [createdAt, id] = JSON.parse(Buffer.from(nextCursor as string, "base64url").toString("utf8"));
  return { createdAt, id };
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
