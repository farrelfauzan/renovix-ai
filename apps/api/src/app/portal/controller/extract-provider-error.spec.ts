import { Readable } from "node:stream";
import { PortalController } from "./portal.controller";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

const providerError = (status: number, bodyText: string) => new ProviderHttpError({ message: `Request failed with status code ${status}`, status, bodyText });

describe("RX-131: extractProviderError (status, log message and client message of a failed provider call)", () => {
  it.each([
    {
      name: "a provider 400 with a body",
      error: providerError(400, '{"error":{"message":"unknown model"}}'),
      expected: { status: 400, message: '{"error":{"message":"unknown model"}}', clientMessage: 'Provider rejected request (HTTP 400): {"error":{"message":"unknown model"}}' },
    },
    {
      name: "a provider 429 with a body",
      error: providerError(429, "slow down"),
      expected: { status: 429, message: "slow down", clientMessage: "Provider request failed (429): slow down" },
    },
    {
      name: "a provider error with an empty body",
      error: providerError(502, ""),
      expected: { status: 502, message: "Request failed with status code 502", clientMessage: "Provider request failed (502)" },
    },
    {
      name: "spaces and line breaks in the body become one space",
      error: providerError(500, "  a  \n b "),
      expected: { status: 500, message: "a b", clientMessage: "Provider request failed (500): a b" },
    },
    {
      name: "the body is cut to 300 characters",
      error: providerError(500, "x".repeat(400)),
      expected: { status: 500, message: "x".repeat(300), clientMessage: `Provider request failed (500): ${"x".repeat(300)}` },
    },
    {
      name: "a response with error.message",
      error: { response: { status: 500, data: { error: { message: "boom" } } } },
      expected: { status: 500, message: "boom", clientMessage: "Provider request failed (500): boom" },
    },
    {
      name: "a response with message",
      error: { response: { status: 502, data: { message: "bad gateway" } } },
      expected: { status: 502, message: "bad gateway", clientMessage: "Provider request failed (502): bad gateway" },
    },
    {
      name: "another response object is sent as JSON",
      error: { response: { status: 503, data: { other: 1 } } },
      expected: { status: 503, message: '{"other":1}', clientMessage: 'Provider request failed (503): {"other":1}' },
    },
    {
      name: "a response stream is never read (RX-169)",
      error: { response: { status: 500, data: Readable.from([]) } },
      expected: { status: 500, message: "Unknown stream error", clientMessage: "Provider request failed (500)" },
    },
    {
      name: "a 400 without a body",
      error: { response: { status: 400 } },
      expected: { status: 400, message: "Unknown stream error", clientMessage: "Provider rejected request (HTTP 400)" },
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
    const actual = PortalController.prototype["extractProviderError"](error);

    expect(actual).toEqual(expected);
  });
});
