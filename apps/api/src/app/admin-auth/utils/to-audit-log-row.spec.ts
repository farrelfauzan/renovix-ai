import type { AuditLogRecord } from "../types/audit-log-record";
import { toAuditLogCsvCells } from "./to-audit-log-csv-cells";
import { toAuditLogRow } from "./to-audit-log-row";

// RX-371: the request id is on the listed row and in the CSV cells, never masked.
const inputRecord: AuditLogRecord = {
  id: "row-1",
  adminId: "admin-1",
  adminEmail: "admin@example.com",
  resource: "package",
  action: "update",
  before: { email: "jane@example.com" },
  after: {},
  reason: "because",
  requestId: "req-abc-123",
  effectiveAt: new Date("2026-10-01T00:00:00Z"),
  createdAt: new Date("2026-10-01T00:00:01Z"),
  cursorAt: "2026-10-01T00:00:01.000000Z",
};

describe("audit log row request id (RX-371)", () => {
  it.each([true, false])("the row carries the request id unmasked (showPii %s)", (inputShowPii) => {
    const actualRow = toAuditLogRow(inputRecord, inputShowPii);

    expect(actualRow.requestId).toBe("req-abc-123");
  });

  it("the CSV cells end with the request id", () => {
    const actualCells = toAuditLogCsvCells(toAuditLogRow(inputRecord, false));

    expect(actualCells).toHaveLength(11);
    expect(actualCells[10]).toBe("req-abc-123");
  });
});
