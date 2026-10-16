import { extractRecentUserMessages } from "./extract-recent-user-messages";

const system = (content: string) => ({ role: "system" as const, content });
const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

describe("RX-131: extractRecentUserMessages (the last three user messages, lower case, oldest first)", () => {
  it.each([
    { name: "no messages", messages: [], expected: [] },
    { name: "no user message", messages: [system("S"), assistant("Hi")], expected: [] },
    { name: "only the user messages, lower case", messages: [system("S"), user("Hello"), assistant("Hi"), user("Make a PDF")], expected: ["hello", "make a pdf"] },
    { name: "the last three of five", messages: [user("One"), user("Two"), user("Three"), user("Four"), user("Five")], expected: ["three", "four", "five"] },
  ])("$name", ({ messages, expected }) => {
    const actual = extractRecentUserMessages(messages);

    expect(actual).toEqual(expected);
  });
});
