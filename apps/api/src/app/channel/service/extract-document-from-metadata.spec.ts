import { ChannelService } from "./channel.service";

const DOCUMENT = { format: "pdf", url: "https://files.example.test/report.pdf", filename: "report.pdf", expiresAt: "2026-10-17T00:00:00.000Z" };

describe("RX-131: extractDocumentFromMetadata (the generated document stored on a channel message)", () => {
  it.each([
    { name: "null", metadata: null, expected: null },
    { name: "undefined", metadata: undefined, expected: null },
    { name: "a string", metadata: "document", expected: null },
    { name: "an array", metadata: [DOCUMENT], expected: null },
    { name: "no document", metadata: {}, expected: null },
    { name: "document is an array", metadata: { document: [DOCUMENT] }, expected: null },
    { name: "document is a string", metadata: { document: "report.pdf" }, expected: null },
    { name: "expiresAt missing", metadata: { document: { ...DOCUMENT, expiresAt: undefined } }, expected: null },
    { name: "url is not a string", metadata: { document: { ...DOCUMENT, url: 42 } }, expected: null },
    { name: "format is empty", metadata: { document: { ...DOCUMENT, format: "" } }, expected: null },
    { name: "all four fields", metadata: { document: DOCUMENT }, expected: DOCUMENT },
    { name: "other fields are dropped", metadata: { document: { ...DOCUMENT, size: 10 }, other: 1 }, expected: DOCUMENT },
  ])("$name", ({ metadata, expected }) => {
    const actual = ChannelService.prototype["extractDocumentFromMetadata"](metadata);

    expect(actual).toEqual(expected);
  });
});
