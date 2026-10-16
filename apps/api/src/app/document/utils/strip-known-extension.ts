export function stripKnownExtension(filename: string): string {
  return filename.replace(/\.(pdf|docx|xlsx)$/i, "");
}
