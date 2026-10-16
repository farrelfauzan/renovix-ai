import { resolveMaxTokens } from "./resolve-max-tokens";

describe("RX-131: resolveMaxTokens (requested or 4096, at least 8192 for a document, capped by the model)", () => {
  it.each([
    { name: "nothing given", requested: undefined, modelMax: undefined, outputFormat: null, expected: 4096 },
    { name: "the requested value", requested: 1000, modelMax: undefined, outputFormat: null, expected: 1000 },
    { name: "0 requested is kept", requested: 0, modelMax: undefined, outputFormat: null, expected: 0 },
    { name: "a document gets at least 8192", requested: undefined, modelMax: undefined, outputFormat: "pdf", expected: 8192 },
    { name: "a document keeps a larger request", requested: 16000, modelMax: undefined, outputFormat: "pdf", expected: 16000 },
    { name: "an empty output format is no document", requested: undefined, modelMax: undefined, outputFormat: "", expected: 4096 },
    { name: "under the model's limit", requested: 1000, modelMax: 2000, outputFormat: null, expected: 1000 },
    { name: "capped by the model's limit", requested: 5000, modelMax: 2000, outputFormat: null, expected: 2000 },
    { name: "a document capped by the model's limit", requested: undefined, modelMax: 4000, outputFormat: "docx", expected: 4000 },
    { name: "a model limit of 0 is ignored", requested: 1000, modelMax: 0, outputFormat: null, expected: 1000 },
    { name: "a negative model limit is ignored", requested: 1000, modelMax: -1, outputFormat: null, expected: 1000 },
    { name: "a null model limit is ignored", requested: 1000, modelMax: null, outputFormat: null, expected: 1000 },
  ])("$name -> $expected", ({ requested, modelMax, outputFormat, expected }) => {
    const actual = resolveMaxTokens(requested, modelMax, outputFormat);

    expect(actual).toBe(expected);
  });
});
