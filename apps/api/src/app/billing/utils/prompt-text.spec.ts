import { promptText } from "./prompt-text";

// RX-22: the prompt actually sent, as one text for the counters.
describe("promptText", () => {
  it("joins each message's role and content, then the tools JSON", () => {
    const tools = [{ type: "function", function: { name: "calculator" } }];

    expect(promptText([{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }], tools)).toBe(
      `systemBe brief.userHi${JSON.stringify(tools)}`,
    );
  });

  it("writes non-string content as its JSON and leaves the tools out when there are none", () => {
    expect(promptText([{ role: "user", content: [{ type: "text", text: "Hi" }] }])).toBe('user[{"type":"text","text":"Hi"}]');
  });
});
