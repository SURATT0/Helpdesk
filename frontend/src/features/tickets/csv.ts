/**
 * Minimal RFC-4180-ish CSV parser for the ticket import flow. Handles quoted
 * fields, embedded commas/newlines, and "" escapes. No dependency — the import
 * format is small and fixed, so a hand-rolled parser keeps the bundle lean.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
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
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row (files often lack a final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop rows that are entirely empty (e.g. a blank trailing line).
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
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
};

/**
 * Parse CSV text and map its header row to the import columns. Returns which
 * expected columns are missing so the caller can tell the user their file is
 * malformed before showing the (empty) preview.
 */
export function parseImportCsv(text: string): ParsedCsv {
  const all = parseCsv(text);
  if (all.length === 0) {
    return { columns: {}, rows: [], missingColumns: [...IMPORT_COLUMNS] };
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
  return { columns, rows: all.slice(1), missingColumns };
}
