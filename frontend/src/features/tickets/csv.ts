/**
 * Minimal RFC-4180-ish CSV parser for the ticket import flow. Handles quoted
 * fields, embedded delimiters/newlines, and "" escapes. No dependency — the
 * import format is small and fixed, so a hand-rolled parser keeps the bundle lean.
 */

/** Delimiters a spreadsheet might have written. */
const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Which delimiter a file uses, guessed from its first line.
 *
 * Excel writes `;` instead of `,` wherever the system list separator is a
 * semicolon — most of continental Europe, and any Windows profile configured
 * that way. Those files open fine in Excel, so "it works in Excel but the import
 * says every column is missing" is the only symptom the reader gets.
 *
 * Only the header line is counted, and only outside quotes, so a comma inside a
 * quoted subject cannot outvote the real delimiter. Ties go to the earliest in
 * `DELIMITERS`, which keeps `,` the default for a single-column file where
 * nothing appears at all.
 */
export function sniffDelimiter(text: string): Delimiter {
  const firstLine = text.replace(/\r\n?/g, "\n").split("\n", 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export type CsvGrid = {
  rows: string[][];
  /**
   * A quoted field was opened and never closed, so everything after it was
   * swallowed into one cell. Reported rather than left to look like a short file —
   * silently losing the rest of an import is the whole reason this flag exists.
   */
  unterminatedQuote: boolean;
};

export function parseCsvGrid(text: string, delimiter?: Delimiter): CsvGrid {
  const sep = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  /**
   * Whether nothing has been consumed yet for the field being built. A `"` opens
   * a quoted field ONLY here.
   *
   * This is the difference between `Monitor 24" is dead` being one subject and
   * being the point where the parser starts swallowing the file: treating every
   * `"` as an opener meant one unpaired inch mark put the rest of the document —
   * delimiters, newlines and all — inside a single cell. RFC 4180 gives a quote
   * meaning only at the start of a field; anywhere else it is just a character,
   * which is also what Excel does.
   */
  let atFieldStart = true;
  // Normalise newlines so \r\n and \r behave like \n.
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === sep) {
      row.push(field);
      field = "";
      atFieldStart = true;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  // Flush the trailing field/row (files often lack a final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return {
    // Drop rows that are entirely empty (e.g. a blank trailing line).
    rows: rows.filter((r) => r.some((c) => c.trim().length > 0)),
    unterminatedQuote: inQuotes,
  };
}

/** The grid alone, for callers that do not care why a file came out short. */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  return parseCsvGrid(text, delimiter).rows;
}

/** The columns the import expects, in canonical (normalised) form. */
export const IMPORT_COLUMNS = [
  "subject",
  "description",
  "priority",
  "category",
  "requesterEmail",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

// Accept a few header spellings so a hand-made CSV still maps cleanly.
const HEADER_ALIASES: Record<string, ImportColumn> = {
  subject: "subject",
  title: "subject",
  description: "description",
  desc: "description",
  body: "description",
  priority: "priority",
  category: "category",
  requesteremail: "requesterEmail",
  requester: "requesterEmail",
  email: "requesterEmail",
  requester_email: "requesterEmail",
};

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

export type ParsedCsv = {
  /** Column → index in each data row; missing columns are absent. */
  columns: Partial<Record<ImportColumn, number>>;
  /** Data rows (header excluded). */
  rows: string[][];
  /** Canonical headers that couldn't be found in the file. */
  missingColumns: ImportColumn[];
  /** Which separator the file turned out to use. */
  delimiter: Delimiter;
  /** See `CsvGrid` — the file ended inside a quoted field, so rows were lost. */
  unterminatedQuote: boolean;
};

/**
 * Parse CSV text and map its header row to the import columns. Returns which
 * expected columns are missing so the caller can tell the user their file is
 * malformed before showing the (empty) preview.
 */
export function parseImportCsv(text: string): ParsedCsv {
  const delimiter = sniffDelimiter(text);
  const { rows: all, unterminatedQuote } = parseCsvGrid(text, delimiter);
  if (all.length === 0) {
    return {
      columns: {},
      rows: [],
      missingColumns: [...IMPORT_COLUMNS],
      delimiter,
      unterminatedQuote,
    };
  }
  const header = all[0];
  const columns: Partial<Record<ImportColumn, number>> = {};
  header.forEach((h, i) => {
    const canonical = HEADER_ALIASES[normaliseHeader(h)];
    if (canonical && columns[canonical] === undefined) columns[canonical] = i;
  });
  const missingColumns = IMPORT_COLUMNS.filter(
    (c) => columns[c] === undefined,
  );
  return {
    columns,
    rows: all.slice(1),
    missingColumns,
    delimiter,
    unterminatedQuote,
  };
}
