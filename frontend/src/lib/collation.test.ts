import { describe, expect, it } from "vitest";
import { compareText, compareTextLast } from "./collation";

/**
 * The test set from the audit, in the order a Thai dictionary puts it.
 *
 * Within one initial consonant, order is by vowel, and a syllable with no
 * written vowel comes first — so ก gives กบ, then เกม, then ไก่. The leading
 * vowels เ แ โ ใ ไ are the whole point: they are written first and sorted last,
 * which is exactly what a code-point sort gets backwards.
 */
const CORRECT = [
  "กบ",
  "เกม",
  "ไก่",
  "ขนม",
  "แขก",
  "งาน",
  "จอ",
  "ใจ",
  "เน็ต",
  "โปรแกรม",
  "ฟอง",
  "ไฟ",
  "ระบบ",
  "อีเมล",
  "ฮาร์ดดิสก์",
];

describe("Thai sorts the way a Thai reader reads it", () => {
  it("puts the audit's test set in dictionary order", () => {
    const shuffled = [...CORRECT].reverse();
    expect([...shuffled].sort(compareText)).toEqual(CORRECT);
  });

  it("keeps เกม beside กบ and ไก่ rather than at the end", () => {
    // The regression in one line. Under a code-point sort เกม lands after every
    // consonant-initial word, eleventh of seventeen instead of second.
    const sorted = [...CORRECT].reverse().sort(compareText);
    expect(sorted.indexOf("เกม")).toBe(1);
    expect(sorted.indexOf("ไก่")).toBe(2);
    expect(sorted.indexOf("เกม")).toBeLessThan(sorted.indexOf("ขนม"));
  });

  it("sorts every leading vowel after its own consonant, not after the alphabet", () => {
    for (const [vowelWord, consonantAfter] of [
      ["เกม", "ขนม"], // เ under ก, before ข
      ["แขก", "งาน"], // แ under ข, before ง
      ["ใจ", "เน็ต"], // ใ under จ, before น
      ["โปรแกรม", "ฟอง"], // โ under ป, before ฟ
      ["ไฟ", "ระบบ"], // ไ under ฟ, before ร
    ] as const) {
      expect(
        compareText(vowelWord, consonantAfter),
        `${vowelWord} should sort before ${consonantAfter}`,
      ).toBeLessThan(0);
    }
  });
});

describe("mixing Thai and English", () => {
  it("groups Thai first and Latin last", () => {
    const mixed = ["network", "กบ", "Network", "ไก่"];
    expect([...mixed].sort(compareText)).toEqual([
      "กบ",
      "ไก่",
      "network",
      "Network",
    ]);
  });

  it("keeps Network and network adjacent by folding case", () => {
    expect(compareText("Network", "network")).toBe(0);
    const sorted = ["network", "กบ", "Network"].sort(compareText);
    expect(Math.abs(sorted.indexOf("Network") - sorted.indexOf("network"))).toBe(
      1,
    );
  });
});

describe("numbers inside names", () => {
  it("reads digit runs as numbers, so 2 comes before 10", () => {
    expect(["Project 10", "Project 2", "Project 1"].sort(compareText)).toEqual([
      "Project 1",
      "Project 2",
      "Project 10",
    ]);
  });

  it("does the same for a Thai name", () => {
    expect(["โครงการ 10", "โครงการ 2"].sort(compareText)).toEqual([
      "โครงการ 2",
      "โครงการ 10",
    ]);
  });
});

describe("the same input always gives the same output", () => {
  it("does not depend on the order it started in", () => {
    // What a re-render or a filter does: the same rows, differently arranged.
    // If the comparator were not a total order, the list would visibly jump.
    const a = [...CORRECT].sort(compareText);
    const b = [...CORRECT].reverse().sort(compareText);
    const c = [...CORRECT].slice(7).concat(CORRECT.slice(0, 7)).sort(compareText);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });
});

describe("compareTextLast", () => {
  it("files the absent ones at the end, where an empty string would not", () => {
    const rows = ["ไก่", null, "network", undefined, "กบ"];
    expect([...rows].sort(compareTextLast)).toEqual([
      "กบ",
      "ไก่",
      "network",
      null,
      undefined,
    ]);
  });

  it("treats two absent values as equal rather than reordering them", () => {
    expect(compareTextLast(null, undefined)).toBe(0);
  });
});
