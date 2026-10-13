export interface ChunkResult {
  content: string;
  metadata: {
    source: string;
    section?: string;
    chunkIndex: number;
  };
}

/**
 * Split markdown content into chunks by headings.
 * Each heading starts a new chunk. Content before the first heading
 * becomes the first chunk.
 */
export function chunkMarkdown(
  content: string,
  filename: string,
  maxChunkSize = 4000,
): ChunkResult[] {
  const lines = content.split("\n");
  const sections: { heading: string | null; lines: string[] }[] = [];
  let current: { heading: string | null; lines: string[] } = {
    heading: null,
    lines: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      if (current.lines.length > 0) {
        sections.push(current);
      }
      current = { heading: headingMatch[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  const chunks: ChunkResult[] = [];

  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) continue;

    // If section is within limit, add as single chunk
    if (text.length <= maxChunkSize) {
      chunks.push({
        content: text,
        metadata: {
          source: filename,
          section: section.heading ?? undefined,
          chunkIndex: chunks.length,
        },
      });
    } else {
      // Split large sections by paragraphs
      const paragraphs = text.split(/\n\n+/);
      let buffer = "";

      for (const para of paragraphs) {
        if (buffer.length + para.length + 2 > maxChunkSize && buffer) {
          chunks.push({
            content: buffer.trim(),
            metadata: {
              source: filename,
              section: section.heading ?? undefined,
              chunkIndex: chunks.length,
            },
          });
          buffer = "";
        }
        buffer += (buffer ? "\n\n" : "") + para;
      }

      if (buffer.trim()) {
        chunks.push({
          content: buffer.trim(),
          metadata: {
            source: filename,
            section: section.heading ?? undefined,
            chunkIndex: chunks.length,
          },
        });
      }
    }
  }

  return chunks;
}
