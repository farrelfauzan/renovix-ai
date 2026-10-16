import { buildDocumentSummary } from "./build-document-summary";

// The agent-run and channel controllers had identical copies; RX-131 merged them here.
describe.each([
  { copy: "common/utils", buildDocumentSummary },
])("RX-131: buildDocumentSummary ($copy)", ({ buildDocumentSummary }) => {
  it.each([
    { name: "pdf", message: "make a report", format: "pdf", expected: "Here's the PDF you requested:" },
    { name: "docx", message: "make a report", format: "docx", expected: "Here's the Word document you requested:" },
    { name: "xlsx", message: "make a report", format: "xlsx", expected: "Here's the Excel spreadsheet you requested:" },
    { name: "an unknown format is upper-cased", message: "make a report", format: "csv", expected: "Here's the CSV you requested:" },
    { name: "the label lookup is case-sensitive", message: "make a report", format: "Docx", expected: "Here's the DOCX you requested:" },
    { name: "empty format", message: "make a report", format: "", expected: "Here's the  you requested:" },
    { name: "the message is not used", message: "", format: "pdf", expected: "Here's the PDF you requested:" },
  ])("$name: '$format' -> '$expected'", ({ message, format, expected }) => {
    const actual = buildDocumentSummary(message, format);

    expect(actual).toBe(expected);
  });
});
