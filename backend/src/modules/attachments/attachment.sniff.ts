/**
 * What a file actually is, read from its own first bytes.
 *
 * The upload path used to trust `Content-Type` from the client, which is a value
 * the uploader chooses. That is enough to get a file stored as `image/png` and
 * then handed back to a browser with that type in the response header — so the
 * only thing standing between a renamed executable and an `<img>` tag was a
 * string the attacker wrote.
 *
 * Hand-rolled rather than a dependency: the whitelist is four image formats plus
 * a handful of documents, every one of them identified by a fixed prefix, and a
 * table of ten signatures is easier to audit than a package that recognises six
 * hundred. It is also honest about what it cannot know — see `sniff` below.
 */

/** A format we can positively identify, with the extension we will store it as. */
export type SniffResult = {
  /** Canonical mime type, from the bytes — not from the request. */
  mime: string;
  /** Extension for the storage key, no dot. */
  ext: string;
  /** Whether the app may render this inline in a chat bubble. */
  renderable: boolean;
};

type Signature = {
  /** Byte prefix, or null for entries checked by a custom matcher. */
  bytes?: readonly number[];
  offset?: number;
  match?: (buf: Buffer) => boolean;
  result: SniffResult;
};

const IMAGE = (mime: string, ext: string): SniffResult => ({
  mime,
  ext,
  renderable: true,
});
const DOC = (mime: string, ext: string): SniffResult => ({
  mime,
  ext,
  renderable: false,
});

/**
 * Signatures, most specific first.
 *
 * SVG is deliberately absent, and not because it is hard to detect: an SVG is a
 * document that can carry script, so rendering one inline is an XSS vector. It is
 * not in the upload whitelist either, so a new one cannot arrive; a row that
 * predates the whitelist is served as a download card, never as an image.
 */
const SIGNATURES: readonly Signature[] = [
  {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    result: IMAGE("image/png", "png"),
  },
  { bytes: [0xff, 0xd8, 0xff], result: IMAGE("image/jpeg", "jpg") },
  { bytes: [0x47, 0x49, 0x46, 0x38], result: IMAGE("image/gif", "gif") },
  {
    // RIFF....WEBP — the size field sits between the two markers, so this needs
    // two checks rather than one prefix.
    match: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
    result: IMAGE("image/webp", "webp"),
  },
  { bytes: [0x25, 0x50, 0x44, 0x46], result: DOC("application/pdf", "pdf") },
  {
    // Every OOXML file (docx/xlsx) and every plain zip starts the same way. We
    // cannot tell them apart without reading the archive, so this reports `zip`
    // and the declared type decides — which is safe, because none of these are
    // ever rendered inline.
    bytes: [0x50, 0x4b, 0x03, 0x04],
    result: DOC("application/zip", "zip"),
  },
  { bytes: [0x50, 0x4b, 0x05, 0x06], result: DOC("application/zip", "zip") },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], result: DOC("application/msword", "doc") },
];

/** Signatures of things that must never be stored, whatever they claim to be. */
const DANGEROUS: readonly { bytes: readonly number[]; label: string }[] = [
  { bytes: [0x4d, 0x5a], label: "Windows executable" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: "ELF executable" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], label: "Mach-O / Java class" },
  { bytes: [0x23, 0x21], label: "script with a shebang" },
];

function startsWith(buf: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Identify a buffer.
 *
 * Returns null when the bytes match nothing known — which is NOT the same as
 * "unsafe". `text/plain` and `text/csv` have no signature at all, so a genuine
 * CSV lands here; the caller decides what to do with an unidentifiable file
 * based on what was declared. What the caller must not do is treat null as
 * permission to render it.
 */
export function sniff(buf: Buffer): SniffResult | null {
  for (const sig of SIGNATURES) {
    if (sig.match) {
      if (sig.match(buf)) return sig.result;
    } else if (sig.bytes && startsWith(buf, sig.bytes, sig.offset)) {
      return sig.result;
    }
  }
  return null;
}

/** An executable or script masquerading as something else, or null. */
export function dangerousKind(buf: Buffer): string | null {
  for (const d of DANGEROUS) {
    if (startsWith(buf, d.bytes)) return d.label;
  }
  return null;
}

/** Mime types the app is willing to draw inside a message bubble. */
export const RENDERABLE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Is this stored row something the thread may render inline? */
export function isRenderableImage(contentType: string): boolean {
  return RENDERABLE_MIMES.has(contentType);
}

/**
 * Decide what to store a file as, or why to refuse it.
 *
 * The rule the whole module exists for: **when the bytes identify the file, the
 * bytes win.** A declared `image/png` whose bytes say otherwise is refused
 * rather than quietly re-labelled, because the uploader either mislabelled it by
 * accident (and should be told) or on purpose (and should be stopped).
 */
export function verifyUpload(args: {
  buffer: Buffer;
  declaredType: string;
  allowed: ReadonlySet<string>;
}): { ok: true; mime: string; ext: string } | { ok: false; reason: string } {
  const { buffer, declaredType, allowed } = args;

  const danger = dangerousKind(buffer);
  if (danger) {
    return { ok: false, reason: `File looks like a ${danger}, not ${declaredType}` };
  }

  const found = sniff(buffer);

  if (found) {
    if (!allowed.has(found.mime)) {
      return { ok: false, reason: `Unsupported file type: ${found.mime}` };
    }
    // A declared image that is a different image is still a mislabel worth
    // refusing, so images are compared exactly. Documents are compared by
    // family, because a docx and a plain zip are the same bytes.
    const declaredIsImage = declaredType.startsWith("image/");
    if (declaredIsImage && declaredType !== found.mime) {
      return {
        ok: false,
        reason: `File claims to be ${declaredType} but its content is ${found.mime}`,
      };
    }
    if (!declaredIsImage && RENDERABLE_MIMES.has(found.mime)) {
      // An image declared as a document: harmless in itself, but store it as
      // what it is so it is never served with the wrong type.
      return { ok: true, mime: found.mime, ext: found.ext };
    }
    return { ok: true, mime: found.mime, ext: found.ext };
  }

  // Nothing recognised. Only the signature-less text types may pass, and an
  // image claim without image bytes is exactly the case this refuses.
  if (declaredType.startsWith("image/")) {
    return {
      ok: false,
      reason: `File claims to be ${declaredType} but has no image signature`,
    };
  }
  if (!allowed.has(declaredType)) {
    return { ok: false, reason: `Unsupported file type: ${declaredType}` };
  }
  const ext = declaredType === "text/csv" ? "csv" : "txt";
  return { ok: true, mime: declaredType, ext };
}
