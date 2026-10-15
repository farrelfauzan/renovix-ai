import { isOpenRouterUrl } from "./is-open-router-url";

describe("isOpenRouterUrl (RX-160)", () => {
  it("OpenRouter's base URL", () => {
    expect(isOpenRouterUrl("https://openrouter.ai/api/v1")).toBe(true);
  });

  it.each(["http://127.0.0.1:4000/v1", "https://api.example.test/v1", "https://openrouter.ai.example.test/v1"])(
    "%s is not OpenRouter",
    (url) => {
      expect(isOpenRouterUrl(url)).toBe(false);
    },
  );
});
