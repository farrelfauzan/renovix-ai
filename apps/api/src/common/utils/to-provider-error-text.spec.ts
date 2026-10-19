import { toProviderErrorText } from "./to-provider-error-text";

// D197/D208: the fixed-text provider-error mapper.
describe("toProviderErrorText", () => {
  it("names only the status", () => {
    expect(toProviderErrorText(429)).toEqual({
      clientMessage: "Provider request failed (429)",
      logText: "Provider error (status 429)",
    });
  });

  it("a status that is not an integer is reported as 502", () => {
    expect(toProviderErrorText(Number.NaN)).toEqual({
      clientMessage: "Provider request failed (502)",
      logText: "Provider error (status 502)",
    });
  });
});
