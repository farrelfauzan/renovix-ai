import { completionChunk } from "./completion-chunk";

describe("RNX-196: completionChunk (one SSE event of a streamed chat completion)", () => {
  it("an OpenAI chat.completion.chunk of the stream head with the given choices, as one SSE data event", () => {
    const inputHead = { id: "chatcmpl-1", created: 1700000000, model: "m" };
    const inputChoices = [{ index: 0, delta: { content: "Hi" }, finish_reason: null }];

    const actual = completionChunk(inputHead, { choices: inputChoices });

    expect(actual).toBe(
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"m","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
    );
  });

  it("the usage chunk: no choices, the usage after them", () => {
    const actual = completionChunk({ id: "c", created: 1, model: "m" }, { choices: [], usage: { total_tokens: 3 } });

    expect(JSON.parse(actual.replace(/^data: /, ""))).toEqual({
      id: "c",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [],
      usage: { total_tokens: 3 },
    });
  });
});
