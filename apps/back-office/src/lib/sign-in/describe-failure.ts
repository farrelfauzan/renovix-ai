import { RefusedError } from "./refused-error";

/** The text shown for a failed sign-in or enrolment request: the API's message, or a fixed line when there is no answer. */
export function describeFailure(error: unknown): string {
  return error instanceof RefusedError ? error.message : "The request could not be completed.";
}
