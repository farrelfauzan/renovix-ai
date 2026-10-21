import { HttpException } from "@nestjs/common";

/**
 * RNX-200: the `code` and `message` of a refusal of ours: an HttpException whose body carries a string `code` (402
 * CREDITS_EXHAUSTED, RUN_CAP_EXCEEDED). Their text is ours, never provider text, so an SSE route may send it after its
 * headers. Undefined for any other error.
 */
export function codedRefusalOf(error: unknown): { code: string; message: string } | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body !== "object" || body === null) return undefined;
  const { code, message } = body as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : undefined;
}
