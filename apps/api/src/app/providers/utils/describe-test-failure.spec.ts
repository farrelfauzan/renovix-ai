import { ProviderHttpError } from "../errors/provider-http-error";
import { describeTestFailure } from "./describe-test-failure";

// RX-177: the reason of a failed provider test is stored and returned, so it never contains the key.
describe("describeTestFailure", () => {
  const inputKey = "fake-key-rx177-never-real-Q9Z7";

  // D195: the provider's answer body is never kept, for any status (it can echo the key's tail or hash, RX-174).
  const inputBody = `Received API Key = sk-...Q9Z7, Key Hash (Token) = 0f1e2d3c4b5a, key ${inputKey}`;

  it.each([
    [401, "the key was refused"],
    [403, "the key was refused"],
    [400, "the request was refused"],
    [404, "the request was refused"],
    [429, "the request was refused"],
    [500, "the request was refused"],
    [503, "the request was refused"],
  ])("a %i keeps only the status and a fixed text, never the body", (status, expectedText) => {
    const inputError = new ProviderHttpError({ message: "x", status, bodyText: inputBody });

    const actualReason = describeTestFailure(inputError, inputKey, 15_000);

    expect(actualReason).toBe(`The provider answered ${status}: ${expectedText}`);
    expect(actualReason).not.toContain("Q9Z7");
    expect(actualReason).not.toContain("0f1e2d3c4b5a");
  });

  it("names a timeout", () => {
    const inputError = new DOMException("timed out", "TimeoutError");

    expect(describeTestFailure(inputError, inputKey, 15_000)).toBe("No answer within 15 seconds");
  });

  it("names a network error and its cause", () => {
    const inputError = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });

    expect(describeTestFailure(inputError, inputKey, 15_000)).toBe("The request failed: fetch failed (ENOTFOUND)");
  });
});
