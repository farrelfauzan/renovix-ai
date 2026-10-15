import { maskPersonalData } from "./mask-personal-data";

// RX-164 (PRD 09 §5): personal data in audit values is masked by its shape anywhere, and by its key.
describe("maskPersonalData", () => {
  it.each([
    ["an email", "jane@example.com"],
    ["an email inside a text", "ticket 4711: user jane@example.com asked"],
    ["an international phone", "+62 812-3456-7890"],
    ["a local phone", "081234567890"],
    ["a phone without +", "6281234567890"],
    ["a phone inside a text", "call (0812) 3456 7890 today"],
    ["a phone with a separator after 62", "62-812-3456-789"],
    ["a bare mobile number without a prefix", "812345678901"],
    ["a text too long to scan", `${"x".repeat(2001)}`],
  ])("masks %s as a whole", (_case, value) => {
    expect(maskPersonalData(value)).toBe("***");
  });

  it.each([
    ["a date", "2026-10-15"],
    ["a time", "2026-10-15T08:00:01.000Z"],
    ["a uuid", "3f952ed0-8ee2-81b5-8378-fa5a975a0c0f"],
    ["an amount", "150000000"],
    ["a short code", "0812"],
    ["a plain text", "package price changed"],
  ])("keeps %s", (_case, value) => {
    expect(maskPersonalData(value)).toBe(value);
  });

  it("masks a JSON number that looks like a phone number, and keeps other numbers", () => {
    expect(maskPersonalData({ contact: 6281234567890, other: 812345678901, price: 150000000, count: 7 })).toEqual({
      contact: "***",
      other: "***",
      price: 150000000,
      count: 7,
    });
  });

  it("keeps a text of the longest length it scans, and masks one character more", () => {
    expect(maskPersonalData("x".repeat(2000))).toBe("x".repeat(2000));
    expect(maskPersonalData("x".repeat(2001))).toBe("***");
  });

  it("masks inside nested objects and arrays, and every value of a personal key whatever it looks like", () => {
    const input = {
      email: "not an address",
      Phone_Number: 12345,
      phone: null,
      user: { id: "user-1", contacts: [{ value: "jane@example.com" }, "+62 812-3456-7890", 7] },
      count: 3,
      active: true,
    };

    expect(maskPersonalData(input)).toEqual({
      email: "***",
      Phone_Number: "***",
      phone: "***",
      user: { id: "user-1", contacts: [{ value: "***" }, "***", 7] },
      count: 3,
      active: true,
    });
  });
});
