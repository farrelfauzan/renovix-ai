import { Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { Lexer, type Token, type Tokens } from "marked";
import { DocumentConverter } from "./converter.interface";

@Injectable()
export class XlsxConverter implements DocumentConverter {
  readonly mimeType =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  readonly extension = "xlsx";

  async convert(markdown: string): Promise<Buffer> {
    const tokens = new Lexer().lex(markdown);
    const tables = this.extractTables(tokens);
    const workbook = new ExcelJS.Workbook();

    if (tables.length > 0) {
      // Each markdown table becomes a sheet
      // Track used names to avoid duplicates
      const usedNames = new Set<string>();

      tables.forEach((table, i) => {
        let sheetName = this.sanitizeSheetName(table.title || `Sheet${i + 1}`);

        // If name already exists, append a counter
        let counter = 1;
        const originalName = sheetName;
        while (usedNames.has(sheetName)) {
          sheetName = `${originalName.substring(0, 28)} ${++counter}`;
        }
        usedNames.add(sheetName);

        const sheet = workbook.addWorksheet(sheetName);

        // Header row
        const headerRow = sheet.addRow(
          table.headers.map((h) => this.stripInline(h)),
        );
        headerRow.font = { bold: true };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE8E8E8" },
        };

        // Data rows
        for (const row of table.rows) {
          sheet.addRow(row.map((cell) => this.parseCell(cell)));
        }

        // Auto-width columns
        sheet.columns.forEach((col) => {
          let maxLength = 10;
          col.eachCell?.({ includeEmpty: true }, (cell) => {
            const len = cell.value?.toString().length ?? 0;
            maxLength = Math.max(maxLength, Math.min(len + 2, 50));
          });
          col.width = maxLength;
        });
      });
    } else {
      // No tables found — put content in a single sheet as text rows
      const sheet = workbook.addWorksheet("Content");
      const lines = markdown.split("\n");
      for (const line of lines) {
        const cleaned = this.stripInline(line);
        if (cleaned.trim()) {
          sheet.addRow([cleaned]);
        }
      }
      sheet.getColumn(1).width = 80;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private extractTables(
    tokens: Token[],
  ): { title: string; headers: string[]; rows: string[][] }[] {
    const tables: { title: string; headers: string[]; rows: string[][] }[] = [];
    let lastHeading = "";

    for (const token of tokens) {
      if (token.type === "heading") {
        lastHeading = this.stripInline((token as Tokens.Heading).text);
      }

      if (token.type === "table") {
        const t = token as Tokens.Table;
        tables.push({
          title: lastHeading,
          headers: t.header.map((h) => this.stripInline(h.text)),
          rows: t.rows.map((row) =>
            row.map((cell) => this.stripInline(cell.text)),
          ),
        });
      }
    }

    return tables;
  }

  /**
   * Try to parse cell value as number or date, otherwise keep as string.
   */
  private parseCell(value: string): string | number {
    const cleaned = value.trim();

    // Number
    const num = Number(cleaned);
    if (!isNaN(num) && cleaned !== "") {
      return num;
    }

    return cleaned;
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

  /**
   * Sanitize worksheet name to comply with Excel rules:
   * - Remove invalid chars: * ? : \ / [ ]
   * - Remove emojis and other non-BMP characters
   * - Trim to 31 characters max
   * - Fallback to "Sheet" if result is empty
   */
  private sanitizeSheetName(name: string): string {
    const sanitized = name
      .replace(/[*?:\\/[\]]/g, "")
      .replace(
        /[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{FE00}-\u{FE0F}|\u{200D}]/gu,
        "",
      )
      .trim()
      .substring(0, 31);
    return sanitized || "Sheet";
  }
}
