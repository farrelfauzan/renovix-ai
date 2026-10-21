import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import type { InvalidRequestErrorBody } from "../types/invalid-request-error-body";

/** The `error.message` of every invalid-body 400 (RNX-28). */
const INVALID_BODY_MESSAGE = "Invalid request body";

/**
 * RNX-28: the 400 for a request body that failed its schema, in the one shape every route answers
 * (`InvalidRequestErrorBody`). A controller parses its body with `safeParse` and throws this on failure:
 * `if (!parsed.success) throw createInvalidBodyException(parsed.error);`. Nest sends an object given to
 * BadRequestException as the response body unchanged, and the global exception filter passes it through.
 */
export function createInvalidBodyException(error: z.ZodError): BadRequestException {
  const body: InvalidRequestErrorBody = {
    error: { message: INVALID_BODY_MESSAGE, type: "invalid_request_error", details: z.flattenError(error).fieldErrors },
  };
  return new BadRequestException(body);
}
