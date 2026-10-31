import { isIanaTimeZone } from "./is-iana-time-zone";

describe("RNX-33: isIanaTimeZone", () => {
  it.each(["Asia/Jakarta", "America/New_York", "UTC", "Asia/Kolkata"])("accepts %s", (value) => {
    expect(isIanaTimeZone(value)).toBe(true);
  });

  it.each(["Mars/Base", "+07:00", "-05:00", "", "GMT+7", "Etc/Unknown"])("refuses %p", (value) => {
    expect(isIanaTimeZone(value)).toBe(false);
  });
});
