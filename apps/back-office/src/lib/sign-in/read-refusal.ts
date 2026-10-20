import { RefusedError } from "./refused-error";

/**
 * The refusal of a non-2xx answer: the `message` of the API's error body when it is text (e.g. 401 "Invalid
 * credentials", 400 "Invalid code"); otherwise only the status, so nothing is added to what the API said.
 */
export async function readRefusal(res: Response): Promise<RefusedError> {
  const body: unknown = await res.json().catch(() => null);
  const message = typeof body === "object" && body !== null && "message" in body ? body.message : null;
  return new RefusedError(typeof message === "string" ? message : `The request was refused (${res.status}).`);
}
