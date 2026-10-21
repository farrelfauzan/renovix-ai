import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { codedRefusalOf } from "./coded-refusal-of";
import { CreditsExhaustedException } from "../../app/billing/errors/credits-exhausted.exception";
import { RunCapExceededException } from "../../app/agent/errors/run-cap-exceeded.exception";

// RNX-200: only our own refusals with a code are sent after an SSE route's headers with their text.
describe("codedRefusalOf", () => {
  it("returns the code and message of a 402 CREDITS_EXHAUSTED", () => {
    expect(codedRefusalOf(new CreditsExhaustedException())).toEqual({ code: "CREDITS_EXHAUSTED", message: "Not enough credits" });
  });

  it("returns the code and message of a 402 RUN_CAP_EXCEEDED", () => {
    expect(codedRefusalOf(new RunCapExceededException(new Decimal(10)))).toEqual({
      code: "RUN_CAP_EXCEEDED",
      message: "This message needs more than the per-run credit cap of 10 credits",
    });
  });

  it.each([
    ["an HttpException without a code", new BadRequestException("Invalid request body")],
    ["a plain Error", Object.assign(new Error("provider text"), { code: "ECONNRESET" })],
    ["a thrown string", "boom"],
  ])("returns undefined for %s", (_name, error) => {
    expect(codedRefusalOf(error)).toBeUndefined();
  });
});
