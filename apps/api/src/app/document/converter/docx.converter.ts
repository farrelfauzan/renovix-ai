import { Injectable } from "@nestjs/common";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
  TableLayoutType,
  VerticalAlign,
} from "docx";
import { Lexer, type Token, type Tokens } from "marked";
import { DocumentConverter } from "./converter.interface";

const HEADING_MAP: Record<
  number,
  (typeof HeadingLevel)[keyof typeof HeadingLevel]
> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

type ParagraphAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

@Injectable()
export class DocxConverter implements DocumentConverter {
  readonly mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  readonly extension = "docx";

  async convert(markdown: string): Promise<Buffer> {
    const tokens = new Lexer().lex(markdown);
    const children = this.tokensToElements(tokens);

    const doc = new Document({
      sections: [{ children }],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  }

  private tokensToElements(tokens: Token[]): Array<Paragraph | Table> {
    const elements: Array<Paragraph | Table> = [];

    for (const token of tokens) {
      switch (token.type) {
        case "heading":
          elements.push(this.buildHeading(token as Tokens.Heading));
          break;
        case "paragraph":
          elements.push(this.buildParagraph(token as Tokens.Paragraph));
          break;
        case "list":
          elements.push(...this.buildList(token as Tokens.List));
          break;
        case "code":
          elements.push(this.buildCodeBlock(token as Tokens.Code));
          break;
        case "table":
          elements.push(this.buildTable(token as Tokens.Table));
          break;
        case "hr":
          elements.push(
            new Paragraph({
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              },
              spacing: { after: 200 },
            }),
          );
          break;
        case "blockquote":
          elements.push(this.buildBlockquote(token as Tokens.Blockquote));
          break;
        case "space":
          elements.push(new Paragraph({ spacing: { after: 100 } }));
          break;
      }
    }

    return elements;
  }

  private buildHeading(token: Tokens.Heading): Paragraph {
    return new Paragraph({
      heading: HEADING_MAP[token.depth] ?? HeadingLevel.HEADING_1,
      children: this.parseInline(token.text),
      spacing: { before: 240, after: 120 },
    });
  }

  private buildParagraph(token: Tokens.Paragraph): Paragraph {
    return new Paragraph({
      children: this.parseInline(token.text),
      spacing: { after: 120 },
    });
  }

  private buildList(token: Tokens.List): Paragraph[] {
    return token.items.map(
      (item) =>
        new Paragraph({
          children: this.parseInline(item.text),
          bullet: token.ordered ? undefined : { level: 0 },
          numbering: token.ordered
            ? { reference: "default-numbering", level: 0 }
            : undefined,
          spacing: { after: 60 },
        }),
    );
  }

  private buildCodeBlock(token: Tokens.Code): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: token.text,
          font: "Courier New",
          size: 18, // 9pt
          color: "333333",
        }),
      ],
      shading: {
        type: ShadingType.SOLID,
        color: "F5F5F5",
        fill: "F5F5F5",
      },
      spacing: { before: 120, after: 120 },
    });
  }

  private buildTable(token: Tokens.Table): Table {
    const columnCount = Math.max(
      token.header.length,
      ...token.rows.map((row) => row.length),
      1,
    );
    const columnWidths = this.getColumnWidths(columnCount);

    const rows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: Array.from({ length: columnCount }, (_, colIndex) =>
          this.buildTableCell({
            text: this.stripInline(token.header[colIndex]?.text ?? ""),
            widthPercent: columnWidths[colIndex],
            alignment: token.align?.[colIndex],
            isHeader: true,
          }),
        ),
      }),
    ];

    for (const row of token.rows) {
      rows.push(
        new TableRow({
          children: Array.from({ length: columnCount }, (_, colIndex) =>
            this.buildTableCell({
              text: row[colIndex]?.text ?? "",
              widthPercent: columnWidths[colIndex],
              alignment: token.align?.[colIndex],
            }),
          ),
        }),
      );
    }

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
        insideHorizontal: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: "D9D9D9",
        },
        insideVertical: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: "D9D9D9",
        },
      },
    });
  }

  private buildTableCell({
    text,
    widthPercent,
    alignment,
    isHeader = false,
  }: {
    text: string;
    widthPercent: number;
    alignment?: string | null;
    isHeader?: boolean;
  }): TableCell {
    return new TableCell({
      width: { size: widthPercent, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      shading: isHeader
        ? {
            type: ShadingType.SOLID,
            color: "E8E8E8",
            fill: "E8E8E8",
          }
        : undefined,
      margins: { top: 80, right: 100, bottom: 80, left: 100 },
      children: [
        new Paragraph({
          children: isHeader
            ? [new TextRun({ text, bold: true, size: 20 })]
            : this.parseInline(text),
          alignment: this.getTableAlignment(alignment),
          spacing: { before: 40, after: 40 },
        }),
      ],
    });
  }

  private getColumnWidths(columnCount: number): number[] {
    const baseWidth = Math.floor(100 / columnCount);
    const widths = Array.from({ length: columnCount }, () => baseWidth);
    widths[columnCount - 1] = 100 - baseWidth * (columnCount - 1);
    return widths;
  }

  private getTableAlignment(alignment?: string | null): ParagraphAlignment {
    if (alignment === "right") {
      return AlignmentType.RIGHT;
    }

    if (alignment === "center") {
      return AlignmentType.CENTER;
    }

    return AlignmentType.LEFT;
  }

  private buildBlockquote(token: Tokens.Blockquote): Paragraph {
    return new Paragraph({
      children: this.parseInline(token.text),
      indent: { left: 720 }, // 0.5 inch
      spacing: { before: 120, after: 120 },
    });
  }

  /**
   * Parse inline markdown (bold, italic, code) into TextRun array.
   */
  private parseInline(text: string): TextRun[] {
    const runs: TextRun[] = [];
    // Simple regex-based inline parser
    const regex =
      /(\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|`(.+?)`|\[(.+?)\]\(.+?\)|~~(.+?)~~|([^*_`\[~]+))/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[2]) {
        // **bold**
        runs.push(new TextRun({ text: match[2], bold: true }));
      } else if (match[3]) {
        // *italic*
        runs.push(new TextRun({ text: match[3], italics: true }));
      } else if (match[4]) {
        // __bold__
        runs.push(new TextRun({ text: match[4], bold: true }));
      } else if (match[5]) {
        // _italic_
        runs.push(new TextRun({ text: match[5], italics: true }));
      } else if (match[6]) {
        // `code`
        runs.push(
          new TextRun({
            text: match[6],
            font: "Courier New",
            color: "333333",
          }),
        );
      } else if (match[7]) {
        // [link text](url)
        runs.push(new TextRun({ text: match[7], color: "0563C1" }));
      } else if (match[8]) {
        // ~~strikethrough~~
        runs.push(new TextRun({ text: match[8], strike: true }));
      } else if (match[9]) {
        // plain text
        runs.push(new TextRun({ text: match[9] }));
      }
    }

    if (runs.length === 0) {
      runs.push(new TextRun({ text }));
    }

    return runs;
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
