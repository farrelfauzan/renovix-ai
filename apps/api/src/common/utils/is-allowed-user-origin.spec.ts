import { isAllowedUserOrigin } from "./is-allowed-user-origin";

// RNX-272: the decision of UserOriginGuard on a session or portal route.
const CHAT_ORIGIN = "https://chat.example.test";
const EVIL_ORIGIN = "https://evil.example.test";
const ALLOWED = [CHAT_ORIGIN, "http://admin.renovix.test"];
const UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

describe("RNX-272: isAllowedUserOrigin", () => {
  describe("a write (POST, PUT, PATCH, DELETE)", () => {
    it.each(UNSAFE_METHODS)("%s from an allowed Origin: allowed", (inputMethod) => {
      expect(isAllowedUserOrigin({ method: inputMethod, origin: CHAT_ORIGIN, referer: undefined, allowedOrigins: ALLOWED })).toBe(true);
    });

    it.each(UNSAFE_METHODS)("%s from a foreign Origin: refused", (inputMethod) => {
      expect(isAllowedUserOrigin({ method: inputMethod, origin: EVIL_ORIGIN, referer: undefined, allowedOrigins: ALLOWED })).toBe(false);
    });

    it.each([
      ["a look-alike host", "https://chat.example.test.evil.example.test"],
      ["another scheme", "http://chat.example.test"],
      ["another port", "https://chat.example.test:8443"],
      ['the opaque origin "null"', "null"],
      ["an empty Origin", ""],
    ])("from %s: refused (exact match only)", (_name, inputOrigin) => {
      expect(isAllowedUserOrigin({ method: "POST", origin: inputOrigin, referer: undefined, allowedOrigins: ALLOWED })).toBe(false);
    });

    it("AC2: no Origin, a Referer from a foreign origin: refused", () => {
      const inputReferer = `${EVIL_ORIGIN}/attack.html`;

      expect(isAllowedUserOrigin({ method: "POST", origin: undefined, referer: inputReferer, allowedOrigins: ALLOWED })).toBe(false);
    });

    it("AC2: no Origin, a Referer from an allowed origin (a page with a path and query): allowed", () => {
      const inputReferer = `${CHAT_ORIGIN}/channels/123?tab=icon`;

      expect(isAllowedUserOrigin({ method: "POST", origin: undefined, referer: inputReferer, allowedOrigins: ALLOWED })).toBe(true);
    });

    it("AC2: no Origin, a Referer that is not a URL: refused", () => {
      expect(isAllowedUserOrigin({ method: "POST", origin: undefined, referer: "not a url", allowedOrigins: ALLOWED })).toBe(false);
    });

    it("AC2: neither Origin nor Referer: refused", () => {
      expect(isAllowedUserOrigin({ method: "DELETE", origin: undefined, referer: undefined, allowedOrigins: ALLOWED })).toBe(false);
    });

    it("the Origin decides when both are sent: a foreign Origin with an allowed Referer is refused", () => {
      const inputReferer = `${CHAT_ORIGIN}/`;

      expect(isAllowedUserOrigin({ method: "POST", origin: EVIL_ORIGIN, referer: inputReferer, allowedOrigins: ALLOWED })).toBe(false);
    });
  });

  it.each(["GET", "HEAD", "OPTIONS"])("a %s is never refused, from a foreign Origin or with no header", (inputMethod) => {
    expect(isAllowedUserOrigin({ method: inputMethod, origin: EVIL_ORIGIN, referer: undefined, allowedOrigins: ALLOWED })).toBe(true);
    expect(isAllowedUserOrigin({ method: inputMethod, origin: undefined, referer: undefined, allowedOrigins: ALLOWED })).toBe(true);
  });

  it("CORS_ORIGIN unset (the list is `true`): a foreign write, and one with no header, pass (until RNX-70)", () => {
    expect(isAllowedUserOrigin({ method: "POST", origin: EVIL_ORIGIN, referer: undefined, allowedOrigins: true })).toBe(true);
    expect(isAllowedUserOrigin({ method: "DELETE", origin: undefined, referer: undefined, allowedOrigins: true })).toBe(true);
  });
});
