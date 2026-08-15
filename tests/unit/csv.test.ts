/**
 * Tests for CSV reading and writing.
 *
 * Hand-rolled because no dependency may be added, and because the file this
 * parses is produced by whatever Excel, Numbers or Google Sheets felt like
 * emitting on a machine nobody here controls. Every case below is something one
 * of them actually does:
 *
 *   - Excel writes a UTF-8 BOM and CRLF line endings
 *   - a name with a comma comes back quoted
 *   - an apostrophe in a name becomes a doubled quote inside quotes
 *   - a pasted address can carry a newline *inside* a quoted field
 *
 * A parser that splits on commas handles none of these, and the failure is
 * silent: a student called "Kumar, Raj" becomes two columns, every field after
 * it shifts left, and the roll number column ends up holding a room number.
 *
 * The writer has a security concern the reader does not. A field beginning
 * `=`, `+`, `-` or `@` is treated as a formula by Excel, so an exported
 * student name is a script-injection vector into whoever opens the file.
 */
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, escapeCsvField } from "@/lib/csv";

describe("parseCsv — the basics", () => {
  it("reads a header and one row", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields rather than dropping them", () => {
    // Dropping one shifts every later column, which is how a phone number ends
    // up in the room column.
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("handles a trailing newline without inventing an empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignores blank lines in the middle", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  ")).toEqual([]);
  });
});

describe("parseCsv — what spreadsheets actually emit", () => {
  it("strips the UTF-8 BOM Excel prepends", () => {
    // Without this the first header reads "﻿roll_number" and no column
    // matches, so a perfectly good file is rejected as having no columns.
    const rows = parseCsv("﻿roll_number,full_name\nCS1,Priya");
    expect(rows[0]).toEqual(["roll_number", "full_name"]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a lone CR", () => {
    expect(parseCsv("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsv — quoting", () => {
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('name,room\n"Kumar, Raj",101')).toEqual([
      ["name", "room"],
      ["Kumar, Raj", "101"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('name\n"She said ""hi"""')).toEqual([["name"], ['She said "hi"']]);
  });

  it("keeps a newline inside a quoted field", () => {
    // A pasted address does this, and a line-by-line parser turns one student
    // into two rows, the second of them garbage.
    expect(parseCsv('name,note\n"A","line1\nline2"')).toEqual([
      ["name", "note"],
      ["A", "line1\nline2"],
    ]);
  });

  it("handles a quoted empty field", () => {
    expect(parseCsv('a,b\n"",2')).toEqual([
      ["a", "b"],
      ["", "2"],
    ]);
  });

  it("does not treat a quote in the middle of a bare field as quoting", () => {
    expect(parseCsv(`a\n5" pipe`)).toEqual([["a"], ['5" pipe']]);
  });

  it("trims whitespace around an unquoted field but not inside a quoted one", () => {
    expect(parseCsv('a,b\n  x  ,"  y  "')).toEqual([
      ["a", "b"],
      ["x", "  y  "],
    ]);
  });
});

describe("parseCsv — malformed input fails loudly", () => {
  it("throws on an unterminated quote rather than guessing", () => {
    // Silently truncating would import half a file and look successful.
    expect(() => parseCsv('a,b\n"unclosed,2')).toThrow(/quote/i);
  });
});

describe("toCsv — writing", () => {
  it("writes a header and rows", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toBe("a,b\r\n1,2");
  });

  it("uses CRLF, which is what Excel expects", () => {
    expect(toCsv([["a"], ["1"]])).toContain("\r\n");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsv([["Kumar, Raj"]])).toBe('"Kumar, Raj"');
  });

  it("doubles and quotes an embedded quote", () => {
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv([["a\nb"]])).toBe('"a\nb"');
  });

  it("quotes a field with leading or trailing spaces, which would otherwise be lost", () => {
    expect(toCsv([[" x "]])).toBe('" x "');
  });

  it("round-trips anything it writes", () => {
    const rows = [
      ["roll_number", "full_name", "note"],
      ["CS1", "Kumar, Raj", 'said "hi"'],
      ["CS2", "line1\nline2", ""],
      ["CS3", " padded ", "plain"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("escapeCsvField — spreadsheet formula injection", () => {
  // A student named `=cmd|'/c calc'!A1` is a script that runs when the mess
  // owner opens the export. The value must survive intact but must not be
  // interpreted, so it is quoted and prefixed with a tab, which Excel strips
  // from display but never executes.
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=1+1"])("neutralises %s", (dangerous) => {
    const out = escapeCsvField(dangerous);
    expect(out.startsWith('"\t') || out.startsWith("\t")).toBe(true);
  });

  it("leaves an ordinary value alone", () => {
    expect(escapeCsvField("Priya Menon")).toBe("Priya Menon");
    expect(escapeCsvField("CS21B001")).toBe("CS21B001");
  });

  it("does not mangle a negative number written as text", () => {
    // It is still neutralised — correctness of display beats a leading minus
    // being executable — but the digits survive.
    expect(escapeCsvField("-500")).toContain("500");
  });

  it("still escapes quotes on a dangerous value", () => {
    expect(escapeCsvField('=A1&"x"')).toContain('""x""');
  });
});
