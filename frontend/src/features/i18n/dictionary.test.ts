import { describe, expect, it } from "vitest";
import { dictionaries } from "./dictionary";

/**
 * The two dictionaries must stay in step.
 *
 * A key present in one language and missing from the other renders as the raw
 * key — or silently falls back to English, which is the failure this file exists
 * to catch: an English sentence sitting in the middle of an otherwise Thai
 * screen reads as a bug long before anyone traces it to a missing entry.
 */
const { en, th } = dictionaries;

describe("dictionary parity", () => {
  it("translates every English key into Thai", () => {
    const missing = Object.keys(en).filter((k) => !(k in th));
    expect(missing).toEqual([]);
  });

  it("has no Thai key without an English original", () => {
    const orphans = Object.keys(th).filter((k) => !(k in en));
    expect(orphans).toEqual([]);
  });

  it("leaves no entry blank", () => {
    for (const [lang, dict] of Object.entries(dictionaries)) {
      const blank = Object.entries(dict)
        .filter(([, v]) => v.trim() === "")
        .map(([k]) => `${lang}:${k}`);
      expect(blank).toEqual([]);
    }
  });

  it("keeps the same placeholders on both sides of a pair", () => {
    // `{n}` dropped from a translation loses the number entirely; one invented
    // in a translation renders as literal braces.
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(en)
      .filter((k) => k in th)
      .filter((k) => holes(en[k]).join() !== holes(th[k]).join());
    expect(mismatched).toEqual([]);
  });

  it("translates the server's import rejection reasons", () => {
    // These arrive from the API as reason codes precisely so they can be worded
    // here; a missing one would put the server's English back on screen.
    for (const key of [
      "import.srv.unknownCategory",
      "import.srv.unknownRequester",
      "import.srv.failed",
    ]) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(th[key], `th ${key}`).toBeTruthy();
      expect(th[key], `th ${key} should not be the English text`).not.toBe(en[key]);
    }
  });
});
