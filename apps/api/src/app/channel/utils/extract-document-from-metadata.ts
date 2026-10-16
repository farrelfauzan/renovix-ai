export function extractDocumentFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const doc = (metadata as Record<string, unknown>).document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return null;
  }

  const document = doc as Record<string, unknown>;
  const format = typeof document.format === "string" ? document.format : null;
  const url = typeof document.url === "string" ? document.url : null;
  const filename =
    typeof document.filename === "string" ? document.filename : null;
  const expiresAt =
    typeof document.expiresAt === "string" ? document.expiresAt : null;

  if (!format || !url || !filename || !expiresAt) {
    return null;
  }

  return { format, url, filename, expiresAt };
}
