import { Readable } from "node:stream";
import { extractProviderError } from "./extract-provider-error";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";
import { toProviderErrorKind } from "../../providers/utils/to-provider-error-kind";

// RNX-190: the error no longer keeps the body; the body only decides its kind, as the adapter does.
const providerError = (status: number, bodyText: string) => new ProviderHttpError({ status, kind: toProviderErrorKind({ status, bodyText }) });

// RNX-208 (D197, D208): the log message and the client message name only the status (toProviderErrorText); no body
// text is read, whatever the provider sent. A 400 keeps "Provider rejected request (HTTP 400)".
describe("RX-131: extractProviderError (status, log message and client message of a failed provider call)", () => {
  it.each([
    {
      name: "a provider 400 with a body",
      error: providerError(400, '{"error":{"message":"unknown model"}}'),
      expected: { status: 400, message: "Provider error (status 400)", clientMessage: "Provider rejected request (HTTP 400)" },
    },
    {
      name: "a provider 401 whose body echoes a key suffix",
      error: providerError(401, '{"error":{"message":"Incorrect API key provided: ...sk-or-v1-FAKE1234"}}'),
      expected: { status: 401, message: "Provider error (status 401)", clientMessage: "Provider request failed (401)" },
    },
    {
      name: "a provider 429 with a body",
      error: providerError(429, "slow down"),
      expected: { status: 429, message: "Provider error (status 429)", clientMessage: "Provider request failed (429)" },
    },
    {
      name: "a provider error with an empty body",
      error: providerError(502, ""),
      expected: { status: 502, message: "Provider error (status 502)", clientMessage: "Provider request failed (502)" },
    },
    {
      name: "a response with error.message",
      error: { response: { status: 500, data: { error: { message: "boom" } } } },
      expected: { status: 500, message: "Provider error (status 500)", clientMessage: "Provider request failed (500)" },
    },
    {
      name: "a response with message",
      error: { response: { status: 502, data: { message: "bad gateway" } } },
      expected: { status: 502, message: "Provider error (status 502)", clientMessage: "Provider request failed (502)" },
    },
    {
      name: "a response stream is never read (RX-169)",
      error: { response: { status: 500, data: Readable.from([]) } },
      expected: { status: 500, message: "Provider error (status 500)", clientMessage: "Provider request failed (500)" },
    },
    {
      name: "a 400 without a body",
      error: { response: { status: 400 } },
      expected: { status: 400, message: "Provider error (status 400)", clientMessage: "Provider rejected request (HTTP 400)" },
    },
    {
      name: "an error without a response",
      error: new Error("socket hang up"),
      expected: { status: undefined, message: "socket hang up", clientMessage: "Stream error" },
    },
    {
      name: "null",
      error: null,
      expected: { status: undefined, message: "Unknown stream error", clientMessage: "Stream error" },
    },
  ])("$name", ({ error, expected }) => {
    const actual = extractProviderError(error);

    expect(actual).toEqual(expected);
  });
});
