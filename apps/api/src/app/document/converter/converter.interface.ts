export interface DocumentConverter {
  convert(markdown: string): Promise<Buffer>;
  readonly mimeType: string;
  readonly extension: string;
}
