import { ConversationService } from "./conversation.service";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

describe("RX-131: normalizeTitle (a model-written conversation title cleaned up)", () => {
  it.each([
    { name: "undefined", title: undefined, expected: "" },
    { name: "empty", title: "", expected: "" },
    { name: "quotes around are dropped", title: '"Quarterly Report"', expected: "Quarterly Report" },
    { name: "a final period is dropped", title: "Budget plan.", expected: "Budget plan" },
    { name: "final ?! are dropped", title: "What is RAG?!", expected: "What is RAG" },
    { name: "an ellipsis is dropped", title: "Hello...", expected: "Hello" },
    { name: "a final dash is dropped", title: "Ends with dash -", expected: "Ends with dash" },
    { name: "a line break and spaces become one space", title: "Title:\n  subtitle", expected: "Title: subtitle" },
    { name: "backticks and spaces around are dropped", title: "  `code title`  ", expected: "code title" },
    { name: "punctuation inside stays", title: "Q3: plan, budget", expected: "Q3: plan, budget" },
    { name: "quotes, then the period inside them", title: '"Done."', expected: "Done" },
    { name: "a quote before the final punctuation stays (today's behaviour)", title: '"Hi"!', expected: 'Hi"' },
    { name: "cut to 120 characters", title: "a".repeat(130), expected: "a".repeat(120) },
  ])("$name", ({ title, expected }) => {
    const actual = ConversationService.prototype["normalizeTitle"](title);

    expect(actual).toBe(expected);
  });
});
