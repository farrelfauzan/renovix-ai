import { Injectable, BadRequestException } from "@nestjs/common";
import { S3Service } from "../../knowledge/service/s3.service";
import { PdfConverter } from "../converter/pdf.converter";
import { DocxConverter } from "../converter/docx.converter";
import { XlsxConverter } from "../converter/xlsx.converter";
import { DocumentConverter } from "../converter/converter.interface";
import { stripKnownExtension } from "../utils/strip-known-extension";
import { sanitizeFilename } from "../utils/sanitize-filename";
import { inferNameFromMarkdown } from "../utils/infer-name-from-markdown";

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
      ? sanitizeFilename(stripKnownExtension(filename))
      : "";

    if (customName) {
      return customName;
    }

    const inferred = inferNameFromMarkdown(markdown);
    if (inferred) {
      return inferred;
    }

    return `document-${Date.now()}`;
  }
}
