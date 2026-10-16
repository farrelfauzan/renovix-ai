export function buildDocumentSummary(message: string, format: string): string {
  const formatLabels: Record<string, string> = {
    pdf: "PDF",
    docx: "Word document",
    xlsx: "Excel spreadsheet",
  };
  const label = formatLabels[format] || format.toUpperCase();
  return `Here's the ${label} you requested:`;
}
