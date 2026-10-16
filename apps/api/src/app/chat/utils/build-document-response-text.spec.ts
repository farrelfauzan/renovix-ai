import { buildDocumentResponseText } from "./build-document-response-text";

describe("RX-131: buildDocumentResponseText (the chat reply that announces a generated document)", () => {
  it.each([
    { name: "pdf", format: "pdf", filename: "report.pdf", expected: "I've generated your PDF document: **report.pdf**" },
    { name: "xlsx", format: "xlsx", filename: "q3.xlsx", expected: "I've generated your XLSX document: **q3.xlsx**" },
    { name: "mixed-case format is upper-cased", format: "Docx", filename: "letter.docx", expected: "I've generated your DOCX document: **letter.docx**" },
    { name: "empty filename", format: "pdf", filename: "", expected: "I've generated your PDF document: ****" },
  ])("$name -> '$expected'", ({ format, filename, expected }) => {
    const actual = buildDocumentResponseText({ format, filename });

    expect(actual).toBe(expected);
  });
});
