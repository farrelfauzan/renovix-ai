import { parseModelIdMap } from "./parse-model-id-map";

describe("parseModelIdMap (RX-160)", () => {
  it.each([undefined, ""])("unset (%j) → empty map", (raw) => {
    expect(parseModelIdMap(raw).size).toBe(0);
  });

  it("maps our id to the provider's id", () => {
    const map = parseModelIdMap('{"anthropic/claude-opus-5.5":"claude-opus-5.5"}');

    expect(map.get("anthropic/claude-opus-5.5")).toBe("claude-opus-5.5");
    expect(map.get("deepseek/deepseek-v4-flash")).toBeUndefined();
  });

  it("an id named like an Object property is not mapped", () => {
    expect(parseModelIdMap("{}").get("constructor")).toBeUndefined();
  });

  it("refuses invalid JSON, naming the variable", () => {
    expect(() => parseModelIdMap("{not json")).toThrow(/^LLM_MODEL_ID_MAP .*not valid JSON$/);
  });

  it.each(['["a"]', "null", '"x"', "42", '{"a":1}', '{"a":null}'])("refuses %s, naming the variable", (raw) => {
    expect(() => parseModelIdMap(raw)).toThrow(/^LLM_MODEL_ID_MAP must be a JSON object of strings/);
  });
});
