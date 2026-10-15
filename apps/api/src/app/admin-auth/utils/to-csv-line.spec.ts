import { toCsvLine } from "./to-csv-line";

// RX-164: the audit log CSV (RFC 4180, CSV injection protection).
describe("toCsvLine", () => {
  it("joins plain cells with commas and ends with CRLF", () => {
    expect(toCsvLine(["a", "b c", ""])).toBe("a,b c,\r\n");
  });

  it("quotes a cell with a comma, a quote or a line break, doubling quotes", () => {
    expect(toCsvLine(["a,b", 'say "hi"', "two\nlines", "cr\rhere"])).toBe('"a,b","say ""hi""","two\nlines","cr\rhere"\r\n');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("puts an apostrophe before a cell that starts like a formula: %j", (cell) => {
    expect(toCsvLine([cell]).replace(/^"|"?\r\n$/g, "")).toBe(`'${cell}`);
  });

  it("protects and quotes together", () => {
    expect(toCsvLine(['=HYPERLINK("x","y")'])).toBe('"\'=HYPERLINK(""x"",""y"")"\r\n');
  });
});
