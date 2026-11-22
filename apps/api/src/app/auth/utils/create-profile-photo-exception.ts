import { BadRequestException } from "@nestjs/common";
import type { InvalidRequestErrorBody } from "../../../common/types/invalid-request-error-body";

/** The `error.message` of every invalid-body 400 (RNX-28), kept for the photo's multipart refusals. */
const INVALID_REQUEST_MESSAGE = "Invalid request body";

/** RNX-334: the 400 for a refused profile photo, in the one invalid-request shape; `message` is under `details.file`. */
export function createProfilePhotoException(message: string): BadRequestException {
  const body: InvalidRequestErrorBody = {
    error: { message: INVALID_REQUEST_MESSAGE, type: "invalid_request_error", details: { file: [message] } },
  };
  return new BadRequestException(body);
}
