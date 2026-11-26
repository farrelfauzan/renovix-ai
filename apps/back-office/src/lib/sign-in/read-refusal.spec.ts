/** @jest-environment node */
import { readRefusal } from "./read-refusal";

/** A non-2xx answer with `body` as JSON, or as the raw text when `raw` is given. */
function answerWith(status: number, body: unknown, raw?: string): Response {
  return new Response(raw ?? JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const invalidBody = (details: Record<string, string[]>) => ({ error: { message: "Invalid request body", type: "invalid_request_error", details } });

describe("readRefusal", () => {
  it("keeps a top-level message as it is", async () => {
    const actual = await readRefusal(answerWith(401, { message: "Invalid credentials" }));

    expect(actual.message).toBe("Invalid credentials");
    expect(actual.status).toBe(401);
  });

  it("keeps the top-level Re-authentication message as it is", async () => {
    const actual = await readRefusal(answerWith(403, { message: "Re-authentication required" }));

    expect(actual.message).toBe("Re-authentication required");
  });

  it("names the invalid fields of an RNX-28 body, in the order the API sent them", async () => {
    const actual = await readRefusal(answerWith(400, invalidBody({ permissions: ["Required"], name: ["Too short"] })));

    expect(actual.message).toBe("Invalid request body: permissions, name");
    expect(actual.status).toBe(400);
  });

  it.each([
    ["without details", { error: { message: "Invalid request body", type: "invalid_request_error" } }],
    ["with empty details", invalidBody({})],
  ])("says only the message of an RNX-28 body %s", async (_label, body) => {
    const actual = await readRefusal(answerWith(400, body));

    expect(actual.message).toBe("Invalid request body");
  });

  it("falls back to the status for an empty object", async () => {
    const actual = await readRefusal(answerWith(400, {}));

    expect(actual.message).toBe("The request was refused (400).");
  });

  it("falls back to the status for a body that is not JSON", async () => {
    const actual = await readRefusal(answerWith(502, undefined, "<html>Bad gateway</html>"));

    expect(actual.message).toBe("The request was refused (502).");
  });

  it("never shows the values of details, which can hold submitted text", async () => {
    const actual = await readRefusal(answerWith(400, invalidBody({ email: ["hunter2-secret@example.test is not an email"] })));

    expect(actual.message).toContain("email");
    expect(actual.message).not.toContain("hunter2-secret@example.test");
  });
});
