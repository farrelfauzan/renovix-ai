import { Injectable } from "@nestjs/common";
import PDFDocumentLib from "pdfkit";
import { Lexer, type Token, type Tokens } from "marked";
import { DocumentConverter } from "./converter.interface";

// Handle CJS/ESM interop
const PDFDocument = (PDFDocumentLib as any).default ?? PDFDocumentLib;

@Injectable()
export class PdfConverter implements DocumentConverter {
  readonly mimeType = "application/pdf";
  readonly extension = "pdf";

  async convert(markdown: string): Promise<Buffer> {
    const tokens = new Lexer().lex(markdown);
    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      bufferPages: true,
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    this.renderTokens(doc, tokens);
    doc.end();

    return finished;
  }

  private get pageWidth() {
    return 595.28 - 50 * 2; // A4 width minus margins
  }

  private ensureSpace(doc: any, needed: number): boolean {
    const bottomMargin = doc.page.margins.bottom;
    const remaining = doc.page.height - doc.y - bottomMargin;
    if (remaining < needed) {
      doc.addPage();
      return true; // page was added
    }
    return false;
  }

  private renderTokens(doc: any, tokens: Token[]) {
    for (const token of tokens) {
      switch (token.type) {
        case "heading":
          this.renderHeading(doc, token as Tokens.Heading);
          break;
        case "paragraph":
          this.renderParagraph(doc, token as Tokens.Paragraph);
          break;
        case "list":
          this.renderList(doc, token as Tokens.List);
          break;
        case "code":
          this.renderCode(doc, token as Tokens.Code);
          break;
        case "table":
          this.renderTable(doc, token as Tokens.Table);
          break;
        case "hr":
          this.renderHr(doc);
          break;
        case "blockquote":
          this.renderBlockquote(doc, token as Tokens.Blockquote);
          break;
        case "space":
          doc.moveDown(0.3);
          break;
      }
    }
  }

  private renderHeading(doc: any, token: Tokens.Heading) {
    const sizes: Record<number, number> = {
      1: 22,
      2: 18,
      3: 15,
      4: 13,
      5: 12,
      6: 11,
    };
    const size = sizes[token.depth] ?? 12;
    const text = this.stripInline(token.text);

    this.ensureSpace(doc, size + 20);
    doc.x = doc.page.margins.left; // reset x after tables

    if (token.depth <= 2) {
      doc.moveDown(0.4);
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(size)
      .text(text, doc.page.margins.left, doc.y, {
        width: this.pageWidth,
        lineGap: 2,
      });

    // Underline for H1 and H2
    if (token.depth <= 2) {
      doc
        .moveTo(doc.page.margins.left, doc.y + 2)
        .lineTo(doc.page.margins.left + this.pageWidth, doc.y + 2)
        .strokeColor("#dddddd")
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.4);
    } else {
      doc.moveDown(0.3);
    }
  }

  private renderParagraph(doc: any, token: Tokens.Paragraph) {
    doc.x = doc.page.margins.left;
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#000000")
      .text(this.stripInline(token.text), doc.page.margins.left, doc.y, {
        width: this.pageWidth,
        lineGap: 3,
        align: "left",
      });
    doc.moveDown(0.4);
  }

  private renderList(doc: any, token: Tokens.List) {
    token.items.forEach((item, i) => {
      const bullet = token.ordered ? `${i + 1}. ` : "•  ";
      const text = this.stripInline(item.text);
      this.ensureSpace(doc, 16);
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(bullet + text, doc.page.margins.left + 15, doc.y, {
          width: this.pageWidth - 15,
          lineGap: 2,
        });
    });
    doc.moveDown(0.4);
  }

  private renderCode(doc: any, token: Tokens.Code) {
    const x = doc.page.margins.left;
    const w = this.pageWidth;
    const textOpts = { width: w - 20, lineGap: 2 };

    const textHeight = doc
      .font("Courier")
      .fontSize(8.5)
      .heightOfString(token.text, textOpts);
    const boxHeight = textHeight + 14;

    this.ensureSpace(doc, boxHeight + 10);

    const y = doc.y;
    // Background
    doc.save().roundedRect(x, y, w, boxHeight, 3).fill("#f4f4f5").restore();
    // Text
    doc
      .font("Courier")
      .fontSize(8.5)
      .fillColor("#1f2937")
      .text(token.text, x + 10, y + 7, textOpts);

    doc.fillColor("#000000");
    doc.y = y + boxHeight + 4;
    doc.moveDown(0.3);
  }

  private renderTable(doc: any, token: Tokens.Table) {
    const colCount = token.header.length;
    const x = doc.page.margins.left;
    const w = this.pageWidth;
    const colWidth = w / colCount;
    const cellPad = 6;
    const fontSize = 9;

    const measureRowHeight = (cells: { text: string }[], font: string) => {
      doc.font(font).fontSize(fontSize);
      let maxH = 0;
      for (const cell of cells) {
        const h = doc.heightOfString(this.stripInline(cell.text), {
          width: colWidth - cellPad * 2,
        });
        maxH = Math.max(maxH, h);
      }
      return maxH + cellPad * 2;
    };

    const drawHeaderRow = () => {
      const hh = measureRowHeight(token.header, "Helvetica-Bold");
      const hy = doc.y;
      doc.save().rect(x, hy, w, hh).fill("#e5e7eb").restore();
      doc
        .save()
        .rect(x, hy, w, hh)
        .strokeColor("#d1d5db")
        .lineWidth(0.5)
        .stroke()
        .restore();
      for (let i = 1; i < colCount; i++) {
        doc
          .save()
          .moveTo(x + i * colWidth, hy)
          .lineTo(x + i * colWidth, hy + hh)
          .strokeColor("#d1d5db")
          .lineWidth(0.5)
          .stroke()
          .restore();
      }
      doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#111827");
      for (let i = 0; i < colCount; i++) {
        doc.text(
          this.stripInline(token.header[i].text),
          x + i * colWidth + cellPad,
          hy + cellPad,
          {
            width: colWidth - cellPad * 2,
            lineGap: 1,
          },
        );
      }
      doc.y = hy + hh;
    };

    const drawDataRow = (row: { text: string }[], rowIndex: number) => {
      const rh = measureRowHeight(row, "Helvetica");
      const ry = doc.y;

      // Alternate background
      if (rowIndex % 2 === 1) {
        doc.save().rect(x, ry, w, rh).fill("#f9fafb").restore();
      }
      // Border
      doc
        .save()
        .rect(x, ry, w, rh)
        .strokeColor("#e5e7eb")
        .lineWidth(0.3)
        .stroke()
        .restore();
      // Column separators
      for (let i = 1; i < colCount; i++) {
        doc
          .save()
          .moveTo(x + i * colWidth, ry)
          .lineTo(x + i * colWidth, ry + rh)
          .strokeColor("#e5e7eb")
          .lineWidth(0.3)
          .stroke()
          .restore();
      }
      // Cell text
      doc.font("Helvetica").fontSize(fontSize).fillColor("#374151");
      for (let i = 0; i < row.length; i++) {
        doc.text(
          this.stripInline(row[i].text),
          x + i * colWidth + cellPad,
          ry + cellPad,
          {
            width: colWidth - cellPad * 2,
            lineGap: 1,
          },
        );
      }
      doc.y = ry + rh;
    };

    // Draw initial header
    this.ensureSpace(
      doc,
      measureRowHeight(token.header, "Helvetica-Bold") + 40,
    );
    drawHeaderRow();

    // Draw data rows
    for (let r = 0; r < token.rows.length; r++) {
      const row = token.rows[r];
      const rh = measureRowHeight(row, "Helvetica");

      // If row won't fit, add page and re-draw header
      const pageAdded = this.ensureSpace(doc, rh + 2);
      if (pageAdded) {
        drawHeaderRow(); // repeat header on new page
      }

      drawDataRow(row, r);
    }

    doc.x = doc.page.margins.left;
    doc.fillColor("#000000");
    doc.moveDown(0.5);
  }

  private renderHr(doc: any) {
    doc.moveDown(0.3);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + this.pageWidth, doc.y)
      .strokeColor("#d1d5db")
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.6);
  }

  private renderBlockquote(doc: any, token: Tokens.Blockquote) {
    const text = this.stripInline(token.text);
    const x = doc.page.margins.left;

    const textH = doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .heightOfString(text, { width: this.pageWidth - 20 });
    this.ensureSpace(doc, textH + 8);

    const y = doc.y;
    // Left bar
    doc
      .save()
      .rect(x, y, 3, textH + 4)
      .fill("#9ca3af")
      .restore();
    // Background
    doc
      .save()
      .rect(x + 3, y, this.pageWidth - 3, textH + 4)
      .fill("#f9fafb")
      .restore();

    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor("#4b5563")
      .text(text, x + 14, y + 2, { width: this.pageWidth - 20, lineGap: 2 });

    doc.fillColor("#000000");
    doc.y = y + textH + 8;
    doc.moveDown(0.4);
  }

  private stripInline(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/~~(.+?)~~/g, "$1");
  }
}
