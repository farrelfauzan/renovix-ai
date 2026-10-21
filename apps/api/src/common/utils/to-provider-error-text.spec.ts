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

  // RNX-190 (D199): a typed upstream error names its kind as well.
  it.each([
    ["unauthorized", 401, "Provider rejected the credentials (401)", "Provider error (status 401, unauthorized)"],
    ["model_not_found", 404, "Model not found at the provider (404)", "Provider error (status 404, model_not_found)"],
    ["unavailable", 503, "Provider unavailable (503)", "Provider error (status 503, unavailable)"],
  ] as const)("the typed %s error names its kind and the status", (kind, status, clientMessage, logText) => {
    expect(toProviderErrorText(status, kind)).toEqual({ clientMessage, logText });
  });

  it("the typed timeout names no status", () => {
    expect(toProviderErrorText(undefined, "timeout")).toEqual({
      clientMessage: "Provider timed out",
      logText: "Provider error (timeout)",
    });
  });
});
