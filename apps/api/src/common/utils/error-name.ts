/**
 * RNX-171: what a last-resort error log may say about an error: the name of its class (`Error`, `TypeError`,
 * `AxiosError`, ...), or the type of a thrown value that is not an Error. Never its message, stack or body, which
 * may carry provider text or a secret.
 */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
