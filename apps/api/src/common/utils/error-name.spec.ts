import { errorName } from "./error-name";

describe("RNX-171: errorName", () => {
  it.each([
    { name: "an Error", input: new Error("token=secret"), expected: "Error" },
    { name: "a TypeError", input: new TypeError("token=secret"), expected: "TypeError" },
    { name: "a string", input: "token=secret", expected: "string" },
    { name: "an object", input: { message: "token=secret" }, expected: "object" },
    { name: "undefined", input: undefined, expected: "undefined" },
  ])("$name -> $expected (never the message)", ({ input, expected }) => {
    const actual = errorName(input);

    expect(actual).toBe(expected);
  });
});
