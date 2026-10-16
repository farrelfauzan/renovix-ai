import { cleanUrl } from "./clean-url";

describe("RX-131: cleanUrl (tracking parameters removed from a search result URL)", () => {
  it.each([
    { name: "empty", url: "", expected: "" },
    { name: "utm_source removed, other parameters kept", url: "https://example.test/a?utm_source=x&id=1", expected: "https://example.test/a?id=1" },
    {
      name: "all seven tracking parameters removed",
      url: "https://example.test/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&gclid=f&fbclid=g",
      expected: "https://example.test/",
    },
    { name: "the fragment stays", url: "https://example.test/p?gclid=1#top", expected: "https://example.test/p#top" },
    { name: "a path is added to a bare origin", url: "https://example.test", expected: "https://example.test/" },
    { name: "the query is encoded again (a space becomes +)", url: "https://example.test/s?q=a%20b", expected: "https://example.test/s?q=a+b" },
    { name: "not a URL is returned as it is", url: "not a url", expected: "not a url" },
  ])("$name", ({ url, expected }) => {
    const actual = cleanUrl(url);

    expect(actual).toBe(expected);
  });
});
