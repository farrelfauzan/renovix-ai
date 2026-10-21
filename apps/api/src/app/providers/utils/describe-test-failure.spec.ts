import { ProviderHttpError } from "../errors/provider-http-error";
import { describeTestFailure } from "./describe-test-failure";

// RX-177: the reason of a failed provider test is stored and returned, so it is fixed text only (D195, D197):
// no answer body and no error message, which can quote the answer (and so the key's tail or hash, RX-174).
describe("describeTestFailure", () => {
  const plantedMarker = "Received API Key = sk-...Q9Z7, Key Hash (Token) = 0f1e2d3c4b5a";

  it.each([
    [401, "the key was refused"],
    [403, "the key was refused"],
    [400, "the request was refused"],
    [404, "the request was refused"],
    [429, "the request was refused"],
    [500, "the request was refused"],
    [503, "the request was refused"],
  ])("a %i keeps only the status and a fixed text, never the body", (status, expectedText) => {
    // RNX-190: the error can no longer carry the body or a message of the caller's choosing.
    const inputError = new ProviderHttpError({ status, kind: "unavailable" });

    const actualReason = describeTestFailure(inputError, 15_000);

    expect(actualReason).toBe(`The provider answered ${status}: ${expectedText}`);
    expect(actualReason).not.toContain("Q9Z7");
    expect(actualReason).not.toContain("0f1e2d3c4b5a");
  });

  it("names a timeout", () => {
    const inputError = new DOMException("timed out", "TimeoutError");

    expect(describeTestFailure(inputError, 15_000)).toBe("No answer within 15 seconds");
  });

  it.each([
    ["a network error", new TypeError(`fetch failed: ${plantedMarker}`, { cause: { code: "ENOTFOUND", message: plantedMarker } })],
    ["a parse error quoting the body", new SyntaxError(`Unexpected token 'R', "${plantedMarker}" is not valid JSON`)],
    ["a thrown string", plantedMarker],
  ])("%s gives one fixed sentence, never the message", (_label, inputError) => {
    const actualReason = describeTestFailure(inputError, 15_000);

    expect(actualReason).toBe("The request failed: the provider could not be reached or its answer could not be read");
    expect(actualReason).not.toContain("Q9Z7");
  });
});
