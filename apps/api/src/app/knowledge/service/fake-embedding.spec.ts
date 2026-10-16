import { ConfigService } from "@nestjs/config";
import { EmbeddingService } from "./embedding.service";

// fakeEmbedding is not exported today: it is reached through embed() with LLM_PROVIDER=fake (RX-88).
// Expected values were computed outside the code under test: printf '%s' "<block>:<text>" | shasum -a 256,
// each byte b as b / 127.5 - 1 (python3).
const savedProvider = process.env.LLM_PROVIDER;
beforeAll(() => {
  process.env.LLM_PROVIDER = "fake";
});
afterAll(() => {
  if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = savedProvider;
});
const fakeEmbedding = async (text: string) => (await new EmbeddingService(new ConfigService()).embed([text]))[0];

describe("RX-131: fakeEmbedding (deterministic local vector of the text, LLM_PROVIDER=fake)", () => {
  it.each([
    {
      name: "'hello'",
      text: "hello",
      expectedFirst: [-0.35686274509803917, 0.6000000000000001, -0.9607843137254902],
      expectedAt32: 0.6549019607843136,
      expectedLast: 0.15294117647058814,
      expectedTokenCount: 2,
    },
    {
      name: "empty text",
      text: "",
      expectedFirst: [0.45882352941176463, -0.07450980392156858, 0.09019607843137245],
      expectedAt32: -0.9450980392156862,
      expectedLast: -0.09019607843137256,
      expectedTokenCount: 0,
    },
  ])("$name", async ({ text, expectedFirst, expectedAt32, expectedLast, expectedTokenCount }) => {
    const actual = await fakeEmbedding(text);

    expect(actual.embedding).toHaveLength(1024);
    expect(actual.embedding.slice(0, 3)).toEqual(expectedFirst);
    expect(actual.embedding[32]).toBe(expectedAt32);
    expect(actual.embedding[1023]).toBe(expectedLast);
    expect(actual.tokenCount).toBe(expectedTokenCount);
  });

  it("gives the same vector for the same text and another for another text", async () => {
    const actualFirst = await fakeEmbedding("same text");
    const actualAgain = await fakeEmbedding("same text");
    const actualOther = await fakeEmbedding("other text");

    expect(actualAgain).toEqual(actualFirst);
    expect(actualOther.embedding).not.toEqual(actualFirst.embedding);
  });

  it("keeps every value within [-1, 1]", async () => {
    const actual = await fakeEmbedding("range check");

    expect(Math.min(...actual.embedding)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...actual.embedding)).toBeLessThanOrEqual(1);
  });
});
