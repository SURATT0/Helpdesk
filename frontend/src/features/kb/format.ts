/**
 * The article's revision date, written in the reader's language.
 *
 * The API sends a full ISO timestamp — `updated_at` is a real column now, and
 * the server has no way of knowing which day that instant falls on for whoever
 * is reading. An article wants a date rather than a minute, so the time is
 * dropped here, in the reader's own timezone.
 */
export const formatUpdated = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
