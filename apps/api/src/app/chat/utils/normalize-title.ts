export function normalizeTitle(title: string | undefined): string {
  if (!title) return "";

  return title
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^['"`\s]+|['"`\s]+$/g, "")
    .replace(/[.?!,:;\-]+$/g, "")
    .trim()
    .slice(0, 120);
}
