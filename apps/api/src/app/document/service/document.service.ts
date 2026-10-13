import { Injectable, BadRequestException } from "@nestjs/common";
import { S3Service } from "../../knowledge/service/s3.service";
import { PdfConverter } from "../converter/pdf.converter";
import { DocxConverter } from "../converter/docx.converter";
import { XlsxConverter } from "../converter/xlsx.converter";
import { DocumentConverter } from "../converter/converter.interface";

export interface DocumentResult {
  format: string;
  url: string;
  filename: string;
  expiresAt: string;
}

export interface StoredDocumentReference {
  format: string;
  filename: string;
  key: string;
}

export interface StoredDocumentResult extends DocumentResult {
  key: string;
}

@Injectable()
export class DocumentService {
  private converters: Record<string, DocumentConverter>;

  constructor(
    private readonly s3: S3Service,
    private readonly pdfConverter: PdfConverter,
    private readonly docxConverter: DocxConverter,
    private readonly xlsxConverter: XlsxConverter,
  ) {
    this.converters = {
      pdf: this.pdfConverter,
      docx: this.docxConverter,
      xlsx: this.xlsxConverter,
    };
  }

  async generate(
    markdown: string,
    format: string,
    filename?: string,
  ): Promise<DocumentResult> {
    const generated = await this.generateWithStorage(
      markdown,
      format,
      filename,
    );
    const { key: _key, ...document } = generated;
    return document;
  }

  async generateWithStorage(
    markdown: string,
    format: string,
    filename?: string,
  ): Promise<StoredDocumentResult> {
    const converter = this.converters[format];
    if (!converter) {
      throw new BadRequestException(`Unsupported format: ${format}`);
    }

    const buffer = await converter.convert(markdown);
    const baseName = this.resolveBaseName(markdown, filename);
    const fullName = `${baseName}.${converter.extension}`;
    const key = `documents/${Date.now()}-${fullName}`;

    await this.s3.uploadWithDisposition(
      key,
      buffer,
      converter.mimeType,
      fullName,
    );

    const expiresIn = 3600;
    const url = await this.s3.getPresignedUrl(key, fullName, expiresIn);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return { format, url, filename: fullName, expiresAt, key };
  }

  async getDocumentFromStorage(
    reference: StoredDocumentReference,
    expiresIn = 3600,
  ): Promise<DocumentResult> {
    if (!this.converters[reference.format]) {
      throw new BadRequestException(`Unsupported format: ${reference.format}`);
    }

    const url = await this.s3.getPresignedUrl(
      reference.key,
      reference.filename,
      expiresIn,
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return {
      format: reference.format,
      filename: reference.filename,
      url,
      expiresAt,
    };
  }

  private resolveBaseName(markdown: string, filename?: string): string {
    const customName = filename
      ? this.sanitizeFilename(this.stripKnownExtension(filename))
      : "";

    if (customName) {
      return customName;
    }

    const inferred = this.inferNameFromMarkdown(markdown);
    if (inferred) {
      return inferred;
    }

    return `document-${Date.now()}`;
  }

  private inferNameFromMarkdown(markdown: string): string {
    const summary = this.summarizeMarkdownForTitle(markdown);
    return this.sanitizeFilename(summary);
  }

  private summarizeMarkdownForTitle(markdown: string): string {
    const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
    const heading = headingMatch?.[1]
      ? this.stripInlineMarkdown(headingMatch[1])
      : "";

    let firstSentence = "";
    const lines = markdown.split("\n");
    for (const line of lines) {
      const normalized = line.trim();
      if (!normalized) {
        continue;
      }
      if (/^#{1,6}\s+/.test(normalized)) {
        continue;
      }
      if (/^[\s|:-]+$/.test(normalized)) {
        continue;
      }

      const plain = this.stripInlineMarkdown(
        normalized
          .replace(/^>\s*/, "")
          .replace(/^[-*+]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .replace(/^\[[ xX]\]\s+/, ""),
      );
      if (!plain) {
        continue;
      }

      firstSentence = plain.split(/[.!?]/)[0]?.trim() || plain;
      if (firstSentence) {
        break;
      }
    }

    const source = [heading, firstSentence].filter(Boolean).join(" ").trim();
    if (!source) {
      return "";
    }

    const stopWords = new Set([
      "a",
      "an",
      "and",
      "as",
      "at",
      "by",
      "for",
      "from",
      "in",
      "into",
      "of",
      "on",
      "or",
      "the",
      "to",
      "with",
      "this",
      "that",
      "these",
      "those",
      "report",
      "guide",
      "overview",
      "comprehensive",
    ]);

    const words = source
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);

    const focused = words.filter((word) => !stopWords.has(word));
    const selected = (focused.length >= 3 ? focused : words).slice(0, 6);
    return selected.join(" ");
  }

  private stripKnownExtension(filename: string): string {
    return filename.replace(/\.(pdf|docx|xlsx)$/i, "");
  }

  private stripInlineMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/~~(.+?)~~/g, "$1");
  }

  private sanitizeFilename(input: string): string {
    return input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
}
