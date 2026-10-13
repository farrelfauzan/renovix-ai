import { verifySignature } from "./verify-signature";

// Made-up values. The signatures were computed outside the code under test:
// printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET"
const PAYLOAD = '{"event":"message.received","to":"628111000111"}';
const SECRET = "made-up-webhook-secret";
const SIGNATURE = "2f64cb6e1dd79818f14d81765d8cb8708d44567004b092870602e50c58435283";
const SIGNATURE_OF_OTHER_SECRET = "94946a128a2e1826709e4977a038893851271fc749456ba9d880601f68516014";
const SIGNATURE_OF_OTHER_PAYLOAD = "5e10b9e8c1b2c16b51c63c7b55e5011ec8d534cd31a334deaabbb5474c6e88db";
const SIGNATURE_OF_EMPTY_PAYLOAD = "06082c9fddbefddc28f42135f98b7ae4237dadf545b3b388fdecb24cd90b58b9";

describe("RX-130: verifySignature (GOWA webhook, HMAC-SHA256 in hex)", () => {
  it.each([
    { name: "the right signature", payload: PAYLOAD, signature: SIGNATURE, secret: SECRET, expected: true },
    { name: "the right signature in upper case", payload: PAYLOAD, signature: SIGNATURE.toUpperCase(), secret: SECRET, expected: true },
    { name: "an empty payload with its own signature", payload: "", signature: SIGNATURE_OF_EMPTY_PAYLOAD, secret: SECRET, expected: true },
    { name: "a signature made with another secret", payload: PAYLOAD, signature: SIGNATURE_OF_OTHER_SECRET, secret: SECRET, expected: false },
    { name: "the right signature checked with another secret", payload: PAYLOAD, signature: SIGNATURE, secret: "another-made-up-secret", expected: false },
    { name: "the right signature checked with an empty secret", payload: PAYLOAD, signature: SIGNATURE, secret: "", expected: false },
    { name: "a signature of another payload", payload: PAYLOAD, signature: SIGNATURE_OF_OTHER_PAYLOAD, secret: SECRET, expected: false },
    { name: "a changed payload", payload: PAYLOAD.replace("628111000111", "628111000999"), signature: SIGNATURE, secret: SECRET, expected: false },
    { name: "the last character changed", payload: PAYLOAD, signature: SIGNATURE.slice(0, -1) + "4", secret: SECRET, expected: false },
    { name: "64 zeros (same length, wrong value)", payload: PAYLOAD, signature: "0".repeat(64), secret: SECRET, expected: false },
    { name: "an empty signature", payload: PAYLOAD, signature: "", secret: SECRET, expected: false },
    { name: "a signature cut short", payload: PAYLOAD, signature: SIGNATURE.slice(0, 62), secret: SECRET, expected: false },
    { name: "a signature with 2 more hex characters", payload: PAYLOAD, signature: SIGNATURE + "00", secret: SECRET, expected: false },
    { name: "text that is not hex", payload: PAYLOAD, signature: "not-a-hex-signature", secret: SECRET, expected: false },
    { name: "the right signature with a 'sha256=' prefix", payload: PAYLOAD, signature: "sha256=" + SIGNATURE, secret: SECRET, expected: false },
    { name: "the secret itself sent as the signature", payload: PAYLOAD, signature: SECRET, secret: SECRET, expected: false },
    // Today's behaviour, pinned as it is: hex decoding stops at the first character that is not hex,
    // so text after a complete right signature is ignored.
    { name: "the right signature followed by text that is not hex (today: accepted)", payload: PAYLOAD, signature: SIGNATURE + "zz", secret: SECRET, expected: true },
    { name: "a signature that is not a string (today: rejected, no throw)", payload: PAYLOAD, signature: undefined as unknown as string, secret: SECRET, expected: false },
  ])("$name -> $expected", ({ payload, signature, secret, expected }) => {
    const actual = verifySignature(payload, signature, secret);

    expect(actual).toBe(expected);
  });
});
