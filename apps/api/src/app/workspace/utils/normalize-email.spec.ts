import { normalizeEmail } from "./normalize-email";

describe("RX-131: normalizeEmail (an invite email trimmed and lower-cased)", () => {
  it.each([
    { name: "upper case and spaces", email: "  Ana@Example.TEST ", expected: "ana@example.test" },
    { name: "tab and line break", email: "\tA@B.TEST\n", expected: "a@b.test" },
    { name: "already normal", email: "a@b.test", expected: "a@b.test" },
    { name: "a space inside stays", email: "a b@x.test", expected: "a b@x.test" },
    { name: "empty", email: "", expected: "" },
  ])("$name", ({ email, expected }) => {
    const actual = normalizeEmail(email);

    expect(actual).toBe(expected);
  });
});
