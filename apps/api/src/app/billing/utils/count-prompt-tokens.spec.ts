import { countPromptTokens } from "./count-prompt-tokens";

// RX-22: the counted prompt I is every message sent (role + content bytes + 4 per message) plus the tools JSON.
describe("countPromptTokens", () => {
  it("counts each message's role and content plus 4 per message", () => {
    const messages = [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ];

    expect(countPromptTokens(messages)).toBe(6 + 9 + 4 + (4 + 2 + 4));
  });

  it("counts the knowledge context a tuned system message carries (not only the user's messages)", () => {
    const user = { role: "user", content: "Hi" };
    const tuned = [{ role: "system", content: `[Relevant Knowledge]\n${"x".repeat(1_000)}` }, user];

    expect(countPromptTokens(tuned)).toBeGreaterThan(countPromptTokens([user]) + 1_000);
  });

  it("adds the tool definitions when there are any", () => {
    const messages = [{ role: "user", content: "Hi" }];
    const tools = [{ type: "function", function: { name: "calculator" } }];

    expect(countPromptTokens(messages, tools)).toBe(countPromptTokens(messages) + JSON.stringify(tools).length);
  });

  it("counts non-string content as its JSON", () => {
    expect(countPromptTokens([{ role: "user", content: [{ type: "text", text: "Hi" }] }])).toBe(
      4 + JSON.stringify([{ type: "text", text: "Hi" }]).length + 4,
    );
  });
});
