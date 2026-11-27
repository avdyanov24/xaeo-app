/**
 * Writing CSV that opens safely in a spreadsheet. The format is RFC 4180: comma-separated, CRLF
 * between records, and a field is wrapped in double quotes when it holds a comma, a quote or a line
 * break, with each quote doubled. On top of that, spreadsheets treat a cell that starts with =, +, -
 * or @ as a formula, and the text of a fix or a client name is typed by people. Those cells get a
 * leading apostrophe, which spreadsheets show as plain text.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/** @param {unknown} value */
export function csvField(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {unknown[][]} rows the first row is the header
 * @returns {string} records joined by CRLF, each ending in CRLF
 */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvField).join(',') + '\r\n').join('');
}
