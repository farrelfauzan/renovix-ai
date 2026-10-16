export function buildDocumentResponseText(document: {
  format: string;
  filename: string;
}): string {
  return `I've generated your ${document.format.toUpperCase()} document: **${document.filename}**`;
}
