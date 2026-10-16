import { WebSearchService } from "./web-search.service";

describe("RX-131: extractHostname (the host name of a URL, empty when it is not one)", () => {
  it.each([
    { name: "a URL", url: "https://www.example.test/path", expected: "www.example.test" },
    { name: "the port is not part of it", url: "https://example.test:8080/", expected: "example.test" },
    { name: "lower-cased", url: "HTTPS://EXAMPLE.TEST", expected: "example.test" },
    { name: "a URL without a host", url: "mailto:a@example.test", expected: "" },
    { name: "not a URL", url: "not a url", expected: "" },
    { name: "empty", url: "", expected: "" },
  ])("$name: '$url' -> '$expected'", ({ url, expected }) => {
    const actual = WebSearchService.prototype["extractHostname"](url);

    expect(actual).toBe(expected);
  });
});
