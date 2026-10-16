import { AgentRunController } from "./agent-run.controller";
import { ChannelController } from "../../channel/controller/channel.controller";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

// Two identical copies today (agent-run and channel controllers): every case runs against each.
describe.each([
  { copy: "AgentRunController", buildDocumentSummary: (message: string, format: string) => AgentRunController.prototype["buildDocumentSummary"](message, format) },
  { copy: "ChannelController", buildDocumentSummary: (message: string, format: string) => ChannelController.prototype["buildDocumentSummary"](message, format) },
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
