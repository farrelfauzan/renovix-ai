import { readCookie } from "./read-cookie";

describe("readCookie", () => {
  it("finds the named cookie among others", () => {
    expect(readCookie("a=1; rx_admin_access=tok.en; b=2", "rx_admin_access")).toBe("tok.en");
  });

  it.each([
    ["no header", undefined],
    ["another cookie only", "jwt=abc"],
    ["a cookie whose name only ends the same", "x_rx_admin_access=abc"],
    ["an empty value", "rx_admin_access="],
  ])("%s: undefined", (_case, header) => {
    expect(readCookie(header, "rx_admin_access")).toBeUndefined();
  });
});
