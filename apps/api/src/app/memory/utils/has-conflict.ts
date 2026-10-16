export function hasConflict(existing: string, incoming: string): boolean {
  const existingWords = new Set(existing.toLowerCase().split(/\s+/));
  const incomingWords = new Set(incoming.toLowerCase().split(/\s+/));

  // If they share significant keyword overlap and are about same topic
  const intersection = [...existingWords].filter((w) => incomingWords.has(w));
  const overlapRatio =
    intersection.length / Math.min(existingWords.size, incomingWords.size);

  return overlapRatio > 0.5;
}
