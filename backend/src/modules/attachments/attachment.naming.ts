/**
 * How an attachment gets the name people see and download.
 *
 * Three names, deliberately kept apart, because each answers a different
 * question and mixing them is how path traversal and broken headers happen:
 *
 *   storageKey   where the bytes are. Opaque, random, no user input, no ticket
 *                id — see `storageKeyFor`.
 *   filename     what the uploader's machine called it. Stored verbatim, shown
 *                on hover, never used to build a path or a header.
 *   displayName  what the app shows and downloads as, built here.
 *
 * Pure functions with no imports on purpose: the rules below are also what the
 * backfill script applies to existing rows, so there is one implementation of
 * them rather than one in TypeScript and another in SQL.
 */

/** Longest slug taken from the uploader's filename. */
export const SLUG_MAX = 40;

/** Ceiling on the whole `displayName`, extension included. */
export const DISPLAY_NAME_MAX = 100;

/** Used when the uploader's name has nothing usable left in it. */
export const FALLBACK_SLUG = "attachment";

/**
 * Characters a filename may not contain, on any platform we might hand it to.
 *
 * Listed as explicit code points and assembled into the pattern, rather than
 * written as a character-class literal. This filter is the reason a name cannot
 * climb out of a path or split a header, and a class literal hides exactly the
 * mistakes that matter in it: a stray `-` becomes a range, and a space or a
 * control character is invisible in the source. Each entry below is legible and
 * commented.
 */
const ILLEGAL_CODE_POINTS = [
  0x2f, // "/"  path separator
  0x5c, // "\"  path separator (Windows)
  0x3a, // ":"  drive/stream separator
  0x2a, // "*"  wildcard
  0x3f, // "?"  wildcard
  0x22, // '"'  quotes the filename in a Content-Disposition header
  0x3c, // "<"
  0x3e, // ">"
  0x7c, // "|"  pipe
  0x7f, // DEL
];

/**
 * Also stripped: every C0 control character. A newline or a carriage return in a
 * filename can terminate a header line early; the rest are simply not names.
 *
 * Space and the dash are deliberately absent from both lists — a whitespace run
 * becomes one dash below, and stripping either first would turn
 * "error screen.png" into "errorscreen".
 */
const ILLEGAL = new RegExp(
  `[${ILLEGAL_CODE_POINTS.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}\\u0000-\\u001f]`,
  "g",
);

/**
 * Any run of whitespace. `\s` already covers the non-breaking space browsers
 * paste, so "ภาพ หน้าจอ" copied off a page collapses like any other gap.
 */
const WHITESPACE = /\s+/g;

/** A trailing `.ext` of 1-12 ASCII alphanumerics — not a Thai word after a dot. */
const TRAILING_EXT = /\.[A-Za-z0-9]{1,12}$/;

/**
 * At least one letter or digit, in any script.
 *
 * A name like `!!!.png` survives the illegal-character filter — `!` is a
 * perfectly legal filename character — but `T1046-01-!!!.png` names nothing, and
 * the rule is that such a name falls back. Unicode properties rather than an
 * ASCII range, so Thai, CJK and accented Latin all count as content.
 */
const HAS_CONTENT = /[\p{L}\p{N}]/u;

/**
 * Recover the real filename from a multipart upload.
 *
 * Busboy — under multer — decodes the `filename` parameter of a multipart part
 * as latin1, because that is what RFC 7578 nominally allows. Browsers send UTF-8.
 * So `ภาพหน้าจอ.png` arrives as `à¸ à¸²à¸žà¸«à¸™à¹‰à¸²à¸ˆà¸­.png`: the bytes are
 * intact, the interpretation is wrong, and every downstream name is built from
 * the wrong characters.
 *
 * Re-reading those latin1 code points as bytes and decoding them as UTF-8 undoes
 * it. Unconditional on purpose: for a pure-ASCII name the round trip is the
 * identity, and browsers do not send latin1 filenames, so there is no case this
 * makes worse. Applied at the HTTP boundary so nothing further in has to know
 * that multipart has an encoding quirk.
 */
export function decodeUploadName(originalname: string): string {
  const roundTrip = Buffer.from(originalname, "latin1").toString("utf8");
  // A replacement character means the bytes were not UTF-8 after all — keep what
  // arrived rather than replacing a readable name with question marks.
  return roundTrip.includes("�") ? originalname : roundTrip;
}

/**
 * The slug part of a display name, from the uploader's own filename.
 *
 * Thai is preserved rather than transliterated: the point of the slug is that
 * the person who uploaded the file can still recognise it, and "ภาพหน้าจอ" turned
 * into "phaap-naa-cho" is recognisable to nobody. The header that carries it is
 * RFC 5987 encoded, so non-ASCII costs nothing there either.
 *
 * The extension is stripped before slugging and re-attached by the caller from
 * the VERIFIED type, so a file claiming `.png` cannot smuggle its own suffix in.
 */
export function slugify(originalName: string): string {
  const cleaned = originalName
    .replace(TRAILING_EXT, "")
    // Whitespace BEFORE the illegal-character sweep, deliberately. A newline or
    // a tab is both a control character and a word boundary; stripping it first
    // gives "headinjected", turning it into a dash first gives "head-injected".
    // Both are safe — the control character is gone either way — but only one of
    // them still reads as the name the uploader typed. The control characters
    // that are NOT whitespace are not word boundaries and are simply removed.
    .replace(WHITESPACE, "-")
    .replace(ILLEGAL, "")
    // Collapse runs that piled up once characters were removed.
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    // Leading/trailing punctuation reads as damage rather than as a name, and a
    // leading dot would make the file hidden on unix.
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, SLUG_MAX)
    // Slicing can land mid-punctuation; trim the tail again.
    .replace(/[-.]+$/, "");
  return HAS_CONTENT.test(cleaned) ? cleaned : FALLBACK_SLUG;
}

/**
 * The sequence number, as text.
 *
 * Two digits normally, widening to three past the 99th file so a busy ticket
 * cannot produce a collision or a truncated number. Widening rather than
 * wrapping: `T1046-100-…` is longer than `T1046-99-…`, but it is still unique,
 * which is the property that matters.
 */
export function formatSequence(seq: number): string {
  return String(seq).padStart(seq > 99 ? 3 : 2, "0");
}

/**
 * `T<ticketId>-<seq>-<slug>.<ext>`, capped at `DISPLAY_NAME_MAX`.
 *
 * When the cap bites, the SLUG is what gives way — the prefix identifies the
 * file within its ticket and the extension tells the reader (and their OS) what
 * it is, so neither can be shortened without losing something the name is for.
 *
 * `ext` comes from the verified content type, without a dot.
 */
export function buildDisplayName(args: {
  ticketId: number;
  sequence: number;
  originalName: string;
  ext: string;
}): string {
  const { ticketId, sequence, originalName, ext } = args;
  const prefix = `T${ticketId}-${formatSequence(sequence)}-`;
  const suffix = ext ? `.${ext}` : "";
  const room = DISPLAY_NAME_MAX - prefix.length - suffix.length;

  if (room <= 0) {
    // Pathological: a ticket id long enough to eat the whole budget. Still
    // return something unique and readable rather than something over the cap.
    return `${prefix}${FALLBACK_SLUG}${suffix}`.slice(0, DISPLAY_NAME_MAX);
  }

  let slug = slugify(originalName);
  if (slug.length > room) {
    slug = slug.slice(0, room).replace(/[-.]+$/, "");
    if (slug.length === 0) slug = FALLBACK_SLUG.slice(0, room);
  }
  return `${prefix}${slug}${suffix}`;
}

/**
 * The object key the bytes are stored under.
 *
 * Nothing in it comes from the uploader: not the name, not the claimed
 * extension, and not the ticket id. The name is excluded because it is attacker
 * controlled; the ticket id is excluded because a key that encodes what it holds
 * turns a guessed or leaked key into a way to enumerate a customer's tickets,
 * and because it tempts callers into deriving one from the other instead of
 * reading the row. The extension is the VERIFIED one, from the file's own magic
 * bytes — see attachment.sniff.
 *
 * `random` is injected so tests can pin the shape without stubbing crypto.
 */
export function storageKeyFor(ext: string, random: string): string {
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
  return `attachments/${random}${safeExt}`;
}

/** The thumbnail's key, derived from the object's own key and nothing else. */
export function thumbKeyFor(storageKey: string): string {
  const dot = storageKey.lastIndexOf(".");
  return dot > storageKey.lastIndexOf("/")
    ? `${storageKey.slice(0, dot)}-thumb${storageKey.slice(dot)}`
    : `${storageKey}-thumb`;
}
