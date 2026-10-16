import { scoreTemplateForText } from "./score-template-for-text";

const template = (keywords: string[]) => ({ slug: "t", name: "T", content: "", keywords, priority: 0, outputFormat: null });

describe("RX-131: scoreTemplateForText (1 point per keyword found, 3 for a keyword of several words)", () => {
  it.each([
    { name: "no keywords", keywords: [], text: "make an invoice", expected: 0 },
    { name: "one word found", keywords: ["invoice"], text: "make an invoice", expected: 1 },
    { name: "two words found", keywords: ["invoice", "pdf"], text: "invoice as pdf", expected: 2 },
    { name: "a phrase found", keywords: ["cover letter"], text: "write a cover letter", expected: 3 },
    { name: "a phrase and a word found", keywords: ["cover letter", "letter"], text: "a cover letter", expected: 4 },
    { name: "the keyword is lower-cased", keywords: ["PDF"], text: "export pdf", expected: 1 },
    { name: "the text is not lower-cased (the caller does it)", keywords: ["pdf"], text: "Export PDF", expected: 0 },
    { name: "a keyword inside a longer word counts", keywords: ["cat"], text: "concatenate", expected: 1 },
    { name: "a phrase with two spaces in the text does not count", keywords: ["cover letter"], text: "cover  letter", expected: 0 },
  ])("$name: $keywords in '$text' -> $expected", ({ keywords, text, expected }) => {
    const actual = scoreTemplateForText(template(keywords), text);

    expect(actual).toBe(expected);
  });
});
