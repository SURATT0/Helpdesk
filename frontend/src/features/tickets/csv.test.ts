import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseImportCsv,
  sniffDelimiter,
  IMPORT_COLUMNS,
} from "./csv";

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('subject,note\n"Printer, jammed",urgent')).toEqual([
      ["subject", "note"],
      ["Printer, jammed", "urgent"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([
      ["a"],
      ["line one\nline two"],
    ]);
  });

  it('unescapes doubled "" quotes', () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual([
      ["a"],
      ['she said "hi"'],
    ]);
  });

  it("flushes a final row that lacks a trailing newline", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });

  it("normalises \\r\\n and bare \\r line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops fully-blank lines (e.g. a trailing newline)", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("parseImportCsv", () => {
  const header = "subject,description,priority,category,requesterEmail";

  it("maps a canonical header and returns data rows without the header", () => {
    const res = parseImportCsv(`${header}\nPrinter down,It broke,high,Hardware,a@acme.com`);
    expect(res.columns).toEqual({
      subject: 0,
      description: 1,
      priority: 2,
      category: 3,
      requesterEmail: 4,
    });
    expect(res.missingColumns).toEqual([]);
    expect(res.rows).toEqual([
      ["Printer down", "It broke", "high", "Hardware", "a@acme.com"],
    ]);
  });

  it("accepts header aliases (title/desc/email) case- and space-insensitively", () => {
    const res = parseImportCsv("Title, Desc ,Priority,Category,Email\nx,y,low,Software,b@acme.com");
    expect(res.columns).toEqual({
      subject: 0,
      description: 1,
      priority: 2,
      category: 3,
      requesterEmail: 4,
    });
    expect(res.missingColumns).toEqual([]);
  });

  it("reports missing columns when the header is incomplete", () => {
    const res = parseImportCsv("subject,priority\nPrinter down,high");
    expect(res.columns).toEqual({ subject: 0, priority: 1 });
    expect(res.missingColumns).toEqual(["description", "category", "requesterEmail"]);
  });

  it("keeps the first index when a column appears twice", () => {
    const res = parseImportCsv("subject,subject\na,b");
    expect(res.columns.subject).toBe(0);
  });

  it("treats a whole file as missing every column when empty", () => {
    const res = parseImportCsv("");
    expect(res.rows).toEqual([]);
    expect(res.columns).toEqual({});
    expect(res.missingColumns).toEqual([...IMPORT_COLUMNS]);
  });
});

/**
 * A quote only opens a quoted field at the START of one.
 *
 * Treating every `"` as an opener meant a single unpaired inch mark — `24"`,
 * `15.6"`, a 2" pipe — put the parser into quoted mode and swallowed the rest of
 * the document, delimiters and newlines included, into one cell. An import of
 * fifty rows arrived as one, and the columns past the mark were simply gone.
 */
describe("a quote away from the start of a field", () => {
  const HEADER = "subject,description,priority,category,requesterEmail";
  const row = (n: number) =>
    `Ticket ${n},Body ${n},high,Hardware,a@b.com`;

  it("does not swallow the rest of the file", () => {
    const csv = [
      HEADER,
      `Monitor 24" is dead,Body,high,Hardware,a@b.com`,
      row(2),
      row(3),
    ].join("\n");
    const parsed = parseImportCsv(csv);

    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0][0]).toBe('Monitor 24" is dead');
    expect(parsed.rows[0][4]).toBe("a@b.com");
    expect(parsed.unterminatedQuote).toBe(false);
  });

  it("keeps a balanced pair of quotes as written", () => {
    // These used to be stripped silently, which changed the subject rather than
    // losing it — quieter, and no less wrong.
    expect(parseCsv(`a,The "urgent" one,b\n`)).toEqual([
      ["a", 'The "urgent" one', "b"],
    ]);
  });

  it("still treats a quote at the start of a field as an opener", () => {
    expect(parseCsv(`"a,b",c\n`)).toEqual([["a,b", "c"]]);
    expect(parseCsv(`"line\none",c\n`)).toEqual([["line\none", "c"]]);
    expect(parseCsv(`"say ""hi""",c\n`)).toEqual([['say "hi"', "c"]]);
  });

  it("does not count a space before the quote as the start", () => {
    // Excel reads it the same way: the field began with a space, so the quote is
    // just a character.
    expect(parseCsv(`a, "b,c",d\n`)).toEqual([["a", ' "b', 'c"', "d"]]);
  });
});

describe("unterminatedQuote", () => {
  it("flags a file that ends inside a quoted field", () => {
    const parsed = parseImportCsv(
      `subject,description,priority,category,requesterEmail\n"never closed,Body,high,Hardware,a@b.com\n`,
    );
    expect(parsed.unterminatedQuote).toBe(true);
  });

  it("is false for a well-formed file", () => {
    const parsed = parseImportCsv(
      `subject,description,priority,category,requesterEmail\n"quoted, subject",Body,high,Hardware,a@b.com\n`,
    );
    expect(parsed.unterminatedQuote).toBe(false);
    expect(parsed.rows[0][0]).toBe("quoted, subject");
  });
});

/**
 * Excel writes `;` wherever the system list separator is a semicolon. Such a file
 * opens perfectly in Excel, so before this the reader was told their file was
 * missing every required column and had nothing to go on.
 */
describe("delimiter sniffing", () => {
  it("defaults to a comma", () => {
    expect(sniffDelimiter("subject,description,priority\n")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
    expect(sniffDelimiter("onecolumn\n")).toBe(",");
  });

  it("picks the separator the header actually uses", () => {
    expect(sniffDelimiter("subject;description;priority\n")).toBe(";");
    expect(sniffDelimiter("subject\tdescription\tpriority\n")).toBe("\t");
  });

  it("ignores separators inside a quoted header cell", () => {
    // One quoted comma must not outvote three real semicolons.
    expect(sniffDelimiter(`"subject, long";description;priority;x\n`)).toBe(";");
  });

  it("reads a whole semicolon file, columns and all", () => {
    const parsed = parseImportCsv(
      "subject;description;priority;category;requesterEmail\nPrinter jam;Tray 2;high;Hardware;a@b.com\n",
    );
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows).toEqual([
      ["Printer jam", "Tray 2", "high", "Hardware", "a@b.com"],
    ]);
  });

  it("leaves commas alone inside a semicolon file", () => {
    const parsed = parseImportCsv(
      "subject;description;priority;category;requesterEmail\nJam, again;Tray 2, lower;high;Hardware;a@b.com\n",
    );
    expect(parsed.rows[0][0]).toBe("Jam, again");
    expect(parsed.rows[0][1]).toBe("Tray 2, lower");
  });
});
