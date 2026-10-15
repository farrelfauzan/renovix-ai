/** A first character that makes a spreadsheet read the cell as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Characters that need the cell in quotes (RFC 4180). */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One cell, safe for a spreadsheet: a value starting with =, +, -, @, tab or CR gets a leading
 * apostrophe so it is read as text, not run as a formula; then RFC 4180 quoting (a cell with a comma,
 * quote or line break is quoted, quotes inside are doubled).
 */
function escapeCsvCell(cell: string): string {
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV record (RFC 4180, CRLF line end) from its cells (RX-164). */
export const toCsvLine = (cells: readonly string[]): string => `${cells.map(escapeCsvCell).join(",")}\r\n`;
