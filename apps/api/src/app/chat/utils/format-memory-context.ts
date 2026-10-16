export function formatMemoryContext(
  memories: { type: string; content: string }[],
): string | null {
  if (memories.length === 0) return null;

  const grouped: Record<string, string[]> = {
    interest: [],
    preference: [],
    context: [],
    exclusion: [],
  };

  for (const mem of memories) {
    if (grouped[mem.type]) {
      grouped[mem.type].push(mem.content);
    }
  }

  const lines: string[] = ["[User Memory Context]"];

  if (grouped.interest.length > 0) {
    lines.push(`- Interests: ${grouped.interest.join("; ")}`);
  }
  if (grouped.preference.length > 0) {
    lines.push(`- Preferences: ${grouped.preference.join("; ")}`);
  }
  if (grouped.context.length > 0) {
    lines.push(`- Context: ${grouped.context.join("; ")}`);
  }
  if (grouped.exclusion.length > 0) {
    lines.push(`- Do-not-assume: ${grouped.exclusion.join("; ")}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}
