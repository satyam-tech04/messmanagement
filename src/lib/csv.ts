/**
 * CSV reading and writing.
 *
 * Hand-rolled: no dependency may be added, and the alternative — splitting on
 * commas and newlines — is wrong in ways that fail silently. A student called
 * "Kumar, Raj" becomes two columns, every field after it shifts left, and the
 * roll number column quietly ends up holding a room number. The import would
 * report success.
 *
 * The file being read was produced by whatever spreadsheet the mess office
 * happens to run, so this handles what they actually emit: a UTF-8 BOM, CRLF
 * endings, quoted fields containing commas, doubled quotes, and newlines inside
 * quotes.
 */

/**
 * Parses CSV text into rows of raw strings.
 *
 * A character-by-character state machine rather than a regex, because a quoted
 * field may contain the very delimiters a regex would split on.
 *
 * @throws if a quoted field is never closed — truncating silently would import
 * half a file and look like it worked.
 */
export function parseCsv(text: string): string[][] {
  // Excel prepends a BOM. Left in place it becomes part of the first header, no
  // column matches, and a perfectly good file is rejected as having no columns.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let i = 0;

  const endField = (): void => {
    // Whitespace around a bare field is padding from a spreadsheet; inside
    // quotes it was deliberate and is kept.
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    // A blank line is separation, not a record with one empty field.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i]!;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field.trim() === "") {
      // Opening quote. Anything before it was padding, so it is discarded.
      quoted = true;
      fieldWasQuoted = true;
      field = "";
      i++;
      continue;
    }

    if (char === ",") {
      endField();
      i++;
      continue;
    }

    if (char === "\r" || char === "\n") {
      endRow();
      // CRLF is one break, not two.
      if (char === "\r" && input[i + 1] === "\n") i++;
      i++;
      continue;
    }

    field += char;
    i++;
  }

  if (quoted) {
    throw new Error(
      'The file has an unclosed quote — a quoted value was never closed. Check for a stray " character.',
    );
  }

  // Whatever is left is the final row, unless the file ended with a newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Characters that make a spreadsheet treat a value as a formula.
 *
 * An exported student name is untrusted text going into a file the mess owner
 * will open. `=cmd|'/c calc'!A1` as a name is a script that runs on their
 * machine, and the CSV format has no way to say "this is data". Prefixing a tab
 * makes the value inert; Excel does not display the tab.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvField(value: string): string {
  let out = value;

  const dangerous = FORMULA_PREFIXES.some((p) => out.startsWith(p));
  if (dangerous) out = `\t${out}`;

  const mustQuote = dangerous || /[",\n\r]/.test(out) || out !== out.trim() || out.startsWith("\t");

  if (mustQuote) return `"${out.replace(/"/g, '""')}"`;
  return out;
}

/** Serialises rows to CSV. CRLF endings, because that is what Excel expects. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/**
 * A BOM-prefixed CSV file body.
 *
 * Without the BOM Excel on Windows reads the file as the system codepage, and
 * every non-ASCII name — which in this hostel is most of them — is mangled.
 */
export function toCsvFile(rows: readonly (readonly string[])[]): string {
  return `﻿${toCsv(rows)}\r\n`;
}
