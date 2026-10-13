import { checkRelevance } from "./check-relevance";

const ALLOWED = { allowed: true };
const TOO_SHORT = { allowed: false, reason: "Content too short to be meaningful" };
const SMALL_TALK = { allowed: false, reason: "Irrelevant/small talk content" };

describe("RX-130: checkRelevance", () => {
  it.each([
    { rule: "empty text", content: "", expected: TOO_SHORT },
    { rule: "9 characters", content: "abcdefghi", expected: TOO_SHORT },
    { rule: "10 characters", content: "abcdefghij", expected: ALLOWED },
    { rule: "short once the spaces around it are trimmed", content: "   hi   ", expected: TOO_SHORT },
    { rule: "10 characters with spaces around", content: "  abcdefghij  ", expected: ALLOWED },
    { rule: "greeting only", content: "thank you!!", expected: SMALL_TALK },
    { rule: "greeting only, upper case", content: "GOODBYE!!!!", expected: SMALL_TALK },
    { rule: "greeting followed by a fact", content: "hello there, I work in finance", expected: ALLOWED },
    { rule: "thanks followed by more", content: "thank you for the detailed plan", expected: ALLOWED },
    { rule: "joke request", content: "tell me a joke", expected: SMALL_TALK },
    { rule: "joke request not at the start", content: "please tell me a joke", expected: ALLOWED },
    { rule: "weather question", content: "what's the weather", expected: SMALL_TALK },
    { rule: "date question", content: "what is the date today", expected: SMALL_TALK },
    { rule: "another 'what is the' question", content: "what is the plan for Friday", expected: ALLOWED },
    { rule: "just testing", content: "just testing", expected: SMALL_TALK },
    { rule: "testing", content: "testing 123", expected: SMALL_TALK },
    { rule: "'testing' not at the start", content: "I am testing a payroll export", expected: ALLOWED },
    { rule: "how are you", content: "how are you today", expected: SMALL_TALK },
    { rule: "any text that starts with 'how are you' (today's behaviour)", content: "how are your invoices numbered", expected: SMALL_TALK },
    { rule: "what can you do", content: "what can you do for me", expected: SMALL_TALK },
    { rule: "another 'what can' question", content: "what can your team offer", expected: ALLOWED },
    { rule: "ordinary fact", content: "User works in finance", expected: ALLOWED },
  ])("$rule: '$content'", ({ content, expected }) => {
    const actual = checkRelevance(content);

    expect(actual).toEqual(expected);
  });
});
