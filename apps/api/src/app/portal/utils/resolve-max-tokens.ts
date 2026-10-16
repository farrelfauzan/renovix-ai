export function resolveMaxTokens(
  requestedMaxTokens: number | undefined,
  modelMaxOutputTokens: number | null | undefined,
  outputFormat: string | null,
): number {
  const desired = outputFormat
    ? Math.max(requestedMaxTokens ?? 4096, 8192)
    : (requestedMaxTokens ?? 4096);

  if (!modelMaxOutputTokens || modelMaxOutputTokens <= 0) {
    return desired;
  }

  return Math.min(desired, modelMaxOutputTokens);
}
