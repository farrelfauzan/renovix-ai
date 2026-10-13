import { MemoryPolicyService } from "./memory-policy.service";

const ALLOWED = { allowed: true };
const SENSITIVE = { allowed: false, reason: "Contains sensitive data (credentials, PII, or tokens)" };

describe("RX-130: checkSensitivity", () => {
  it.each([
    { rule: "API key", content: "my key is sk_live_abc123", expected: SENSITIVE },
    { rule: "API key, upper case prefix", content: "my key is PK_TEST_abc123", expected: SENSITIVE },
    { rule: "API key prefix with nothing after it", content: "the prefix sk_live_ alone", expected: ALLOWED },
    { rule: "email address", content: "write to budi@example.co.id please", expected: SENSITIVE },
    { rule: "email written out in words", content: "budi at example dot com", expected: ALLOWED },
    { rule: "phone number with dashes", content: "call me on 0812-345-6789", expected: SENSITIVE },
    { rule: "phone number with country code", content: "call +62 812 345 6789", expected: SENSITIVE },
    { rule: "9 digits are not a phone number", content: "I have 123456789 points", expected: ALLOWED },
    { rule: "7 digits are not a phone number", content: "room 555-1234", expected: ALLOWED },
    { rule: "card number with dashes", content: "card 4111-1111-1111-1111", expected: SENSITIVE },
    { rule: "card number with spaces", content: "card 4111 1111 1111 1111", expected: SENSITIVE },
    { rule: "three groups of 4 digits are not a card number", content: "order 1234-5678-9012", expected: ALLOWED },
    { rule: "32 letters and digits in a row (generic token)", content: "token abcdefghijklmnopqrstuvwxyzABCDEF", expected: SENSITIVE },
    { rule: "31 letters and digits in a row", content: "token abcdefghijklmnopqrstuvwxyzABCDE", expected: ALLOWED },
    { rule: "URL with credentials", content: "db at https://admin:hunter2@localhost/app", expected: SENSITIVE },
    { rule: "URL without credentials", content: "docs at https://example.com/path", expected: ALLOWED },
    { rule: "URL with a port and no credentials", content: "docs at https://example.com:8080/a", expected: ALLOWED },
    { rule: "AWS access key id", content: "aws AKIAABCDEFGHIJKLMNOP", expected: SENSITIVE },
    { rule: "AWS access key id one character short", content: "aws AKIAABCDEFGHIJKLMNO", expected: ALLOWED },
    { rule: "AWS access key id in lower case", content: "aws akiaabcdefghijklmnop", expected: ALLOWED },
    { rule: "JWT", content: "jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl", expected: SENSITIVE },
    { rule: "three dotted parts that are not a JWT", content: "jwt eyJhbGciOi.payload.c2lnbmF0dXJl", expected: ALLOWED },
    { rule: "ordinary sentence", content: "The user prefers short answers in Indonesian", expected: ALLOWED },
    { rule: "empty text", content: "", expected: ALLOWED },
  ])("$rule: $content", ({ content, expected }) => {
    const actual = new MemoryPolicyService().checkSensitivity(content);

    expect(actual).toEqual(expected);
  });

  it("gives the same verdict when the same text is checked again (the patterns keep no state between calls)", () => {
    const content = "write to budi@example.co.id please";

    const actual = [1, 2, 3].map(() => new MemoryPolicyService().checkSensitivity(content));

    expect(actual).toEqual([SENSITIVE, SENSITIVE, SENSITIVE]);
  });
});
