import { withPurgeAt } from "./with-purge-at";

describe("RNX-126: withPurgeAt", () => {
  it("RNX-126: purgeAt is deletedAt plus 30 days (decision 23); the row's other fields stay", () => {
    const inputRow = { id: "a", name: "Bot", deletedAt: new Date("2026-11-01T10:00:00.000Z") };

    const actual = withPurgeAt(inputRow);

    expect(actual).toEqual({ ...inputRow, purgeAt: new Date("2026-12-01T10:00:00.000Z") });
  });

  it("RNX-126: a row that is not deleted has no purgeAt", () => {
    const actual = withPurgeAt({ id: "a", deletedAt: null });

    expect(actual.purgeAt).toBeNull();
  });
});
