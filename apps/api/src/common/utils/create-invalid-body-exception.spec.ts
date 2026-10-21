import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { createInvalidBodyException } from "./create-invalid-body-exception";

describe("RNX-28: createInvalidBodyException (the one 400 for an invalid request body)", () => {
  const schema = z.object({ name: z.string().min(1), count: z.number() });

  it("is a 400 whose body is { error: { message, type, details } } with each failing field's messages", () => {
    const parsed = schema.safeParse({ name: "", count: "3" });
    if (parsed.success) throw new Error("the planted body must fail the schema");

    const actual = createInvalidBodyException(parsed.error);

    expect(actual).toBeInstanceOf(BadRequestException);
    expect(actual.getStatus()).toBe(400);
    expect(actual.getResponse()).toEqual({
      error: {
        message: "Invalid request body",
        type: "invalid_request_error",
        details: { name: [expect.any(String)], count: [expect.any(String)] },
      },
    });
  });

  it("a body that is not an object: no field to name, details is empty", () => {
    const parsed = schema.safeParse("not an object");
    if (parsed.success) throw new Error("the planted body must fail the schema");

    const actual = createInvalidBodyException(parsed.error);

    expect(actual.getResponse()).toEqual({ error: { message: "Invalid request body", type: "invalid_request_error", details: {} } });
  });
});
