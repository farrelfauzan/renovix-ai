import { S3Service } from "./s3.service";

describe("RX-131: normalizeDomain (the host of a configured public file domain)", () => {
  it.each([
    { name: "empty", value: "", expected: "" },
    { name: "only spaces", value: "   ", expected: "" },
    { name: "a URL gives its host", value: "https://cdn.example.test", expected: "cdn.example.test" },
    { name: "the port stays, the path goes", value: "https://cdn.example.test:8443/path", expected: "cdn.example.test:8443" },
    { name: "a URL with a final slash", value: "http://cdn.example.test/", expected: "cdn.example.test" },
    { name: "spaces around are trimmed", value: "  https://cdn.example.test/  ", expected: "cdn.example.test" },
    { name: "another scheme", value: "ftp://files.example.test", expected: "files.example.test" },
    { name: "a bare host stays", value: "cdn.example.test", expected: "cdn.example.test" },
    { name: "a bare host loses its final slash", value: "cdn.example.test/", expected: "cdn.example.test" },
    { name: "host:port without a scheme is read as a scheme (today's behaviour)", value: "localhost:9000", expected: "" },
  ])("$name: '$value' -> '$expected'", ({ value, expected }) => {
    const actual = S3Service.prototype["normalizeDomain"](value);

    expect(actual).toBe(expected);
  });
});
