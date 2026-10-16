import { stripKnownExtension } from "./strip-known-extension";

describe("RX-131: stripKnownExtension (a final .pdf, .docx or .xlsx is removed)", () => {
  it.each([
    { name: "pdf", filename: "report.pdf", expected: "report" },
    { name: "upper case", filename: "Report.PDF", expected: "Report" },
    { name: "docx", filename: "a.docx", expected: "a" },
    { name: "xlsx", filename: "b.xlsx", expected: "b" },
    { name: "another extension stays", filename: "c.txt", expected: "c.txt" },
    { name: "only at the end", filename: "archive.pdf.zip", expected: "archive.pdf.zip" },
    { name: "only once", filename: "double.pdf.pdf", expected: "double.pdf" },
    { name: "no dot", filename: "pdf", expected: "pdf" },
    { name: "only the extension", filename: ".pdf", expected: "" },
  ])("$name: '$filename' -> '$expected'", ({ filename, expected }) => {
    const actual = stripKnownExtension(filename);

    expect(actual).toBe(expected);
  });
});
