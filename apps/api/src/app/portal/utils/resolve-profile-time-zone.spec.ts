import { resolveProfileTimeZone } from "./resolve-profile-time-zone";

// RNX-30-A / RNX-329: the timezone the projection counts days in.
describe("resolveProfileTimeZone", () => {
  it.each<[string, string | null | undefined, string]>([
    ["a stored IANA zone", "Asia/Jakarta", "Asia/Jakarta"],
    ["none stored", null, "UTC"],
    ["no user row", undefined, "UTC"],
    ["a zone Intl rejects", "Not/AZone", "UTC"],
    ["an offset, not an IANA zone", "+07:00", "UTC"],
  ])("%s", (_case, input, expected) => {
    expect(resolveProfileTimeZone(input)).toBe(expected);
  });
});
