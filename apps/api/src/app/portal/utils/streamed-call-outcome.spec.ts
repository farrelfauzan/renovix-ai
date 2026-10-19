import { streamedCallOutcome } from "./streamed-call-outcome";

// RX-22 review NIT 3 and 4.
describe("streamedCallOutcome", () => {
  it.each([
    [{ providerFailed: false, aborted: false, streamOpened: true }, "completed"],
    [{ providerFailed: false, aborted: true, streamOpened: true }, "client_cancel"],
    [{ providerFailed: false, aborted: true, streamOpened: false }, "provider_error"],
    [{ providerFailed: true, aborted: true, streamOpened: true }, "provider_error"],
    [{ providerFailed: true, aborted: false, streamOpened: false }, "provider_error"],
  ])("%j -> %s", (state, expected) => {
    expect(streamedCallOutcome(state)).toBe(expected);
  });
});
