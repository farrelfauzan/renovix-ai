import { readRefusalMessage } from "./read-refusal-message";
import { RefusedError } from "./refused-error";

/**
 * The refusal of a non-2xx answer: the message of the API's error body (e.g. 401 "Invalid credentials", 400 "Invalid
 * request body: permissions, name"); otherwise only the status, so nothing is added to what the API said.
 */
export async function readRefusal(res: Response): Promise<RefusedError> {
  const body: unknown = await res.json().catch(() => null);
  return new RefusedError(readRefusalMessage(body) ?? `The request was refused (${res.status}).`, res.status);
}
