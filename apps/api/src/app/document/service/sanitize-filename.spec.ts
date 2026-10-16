import { DocumentService } from "./document.service";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

describe("RX-131: sanitizeFilename (a title made into a file name: a-z, 0-9 and dashes, at most 80 characters)", () => {
  it.each([
    { name: "words", input: "Quarterly Report 2026", expected: "quarterly-report-2026" },
    { name: "accents are removed", input: "Café Déjà Vu", expected: "cafe-deja-vu" },
    { name: "a ligature is split", input: "ﬁle", expected: "file" },
    { name: "punctuation becomes a dash", input: "Report: Q3/Q4 (final)!", expected: "report-q3-q4-final" },
    { name: "an underscore becomes a dash", input: "my_file name", expected: "my-file-name" },
    { name: "tabs and line breaks become dashes", input: "a\tb\nc", expected: "a-b-c" },
    { name: "runs of dashes become one, dashes around are dropped", input: "--already--dashed--", expected: "already-dashed" },
    { name: "non-Latin text is dropped", input: "日本語", expected: "" },
    { name: "empty", input: "", expected: "" },
    { name: "cut to 80 characters", input: "a".repeat(100), expected: "a".repeat(80) },
    { name: "cut after the dashes are trimmed, so it can end with a dash", input: `${"a".repeat(79)} b`, expected: `${"a".repeat(79)}-` },
  ])("$name", ({ input, expected }) => {
    const actual = DocumentService.prototype["sanitizeFilename"](input);

    expect(actual).toBe(expected);
  });
});
