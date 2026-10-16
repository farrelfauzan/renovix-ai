import { isRetryableError } from "./is-retryable-error";

describe("RX-131: isRetryableError (which SMTP send errors are tried again)", () => {
  it.each([
    { name: "connection refused", error: { code: "ECONNREFUSED" }, expected: true },
    { name: "timeout", error: { code: "ETIMEDOUT" }, expected: true },
    { name: "another network code", error: { code: "ECONNRESET" }, expected: false },
    { name: "SMTP 500", error: { responseCode: 500 }, expected: true },
    { name: "SMTP 550", error: { responseCode: 550 }, expected: true },
    { name: "SMTP 554", error: { responseCode: 554 }, expected: true },
    { name: "SMTP 421", error: { responseCode: 421 }, expected: true },
    { name: "SMTP 450", error: { responseCode: 450 }, expected: false },
    { name: "response code 0", error: { responseCode: 0 }, expected: false },
    { name: "a response code as text is compared as a number", error: { responseCode: "500" }, expected: true },
    { name: "a plain Error", error: new Error("boom"), expected: false },
    { name: "null", error: null, expected: false },
    { name: "undefined", error: undefined, expected: false },
  ])("$name -> $expected", ({ error, expected }) => {
    const actual = isRetryableError(error);

    expect(actual).toBe(expected);
  });
});
