import { toProviderErrorKind } from "./to-provider-error-kind";

// RNX-190 (D199): 401 or 403 → unauthorized; 400, 404 or 422 about a missing or unknown model → model not found
// (a body that only mentions the word "model" is not); anything else →
// unavailable (a timeout has no status: ProviderTimeoutError).
describe("toProviderErrorKind", () => {
  it.each([
    [401, "", "unauthorized"],
    [403, "The model is not available to this key", "unauthorized"],
    [400, '{"error":{"message":"unknown model"}}', "model_not_found"],
    [404, "Model x/y does not exist", "model_not_found"],
    [422, '{"detail":"invalid MODEL id"}', "model_not_found"],
    [400, '{"error":{"message":"max_tokens is too large"}}', "unavailable"],
    [
      400,
      '{"error":{"message":"This model\'s maximum context length is 8192 tokens. However, you requested 9000 tokens.","code":"context_length_exceeded"}}',
      "unavailable",
    ],
    [
      400,
      '{"error":{"message":"Provider returned error","metadata":{"raw":"temperature must be <= 2","model":"deepseek/deepseek-chat"}}}',
      "unavailable",
    ],
    [404, "Not Found", "unavailable"],
    [429, "model overloaded", "unavailable"],
    [500, "", "unavailable"],
    [503, "", "unavailable"],
  ])("%i with %j → %s", (status, bodyText, expected) => {
    expect(toProviderErrorKind({ status, bodyText })).toBe(expected);
  });
});
