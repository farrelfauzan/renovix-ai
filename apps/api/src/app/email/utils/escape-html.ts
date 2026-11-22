/** RNX-329: `text` with the characters HTML gives a meaning to (& < > " ') written as entities, for user text in a mail. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
