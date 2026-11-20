/** A Better Auth client call's answer: data, or an error with Better Auth's message. */
interface AuthResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

/** RNX-78: the data of a Better Auth client call; its error (the client does not throw) becomes a thrown Error. */
export function unwrapAuthResult<T>(result: AuthResult<T>): T {
  if (result.error) throw new Error(result.error.message || "Something went wrong. Please try again.");
  return result.data as T;
}
