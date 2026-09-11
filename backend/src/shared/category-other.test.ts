import { describe, it, expect } from "vitest";
import {
  OTHER_CATEGORY_CODE,
  checkCategoryOther,
  needsOwnDescription,
  storedCategoryOther,
} from "./category-other";
import { categoryCode, STARTER_CATEGORY_NAMES } from "../modules/categories/category.code";

/**
 * The rule that keeps "Other" from becoming a second category list.
 *
 * Everything here is decided from a CODE and a string, with no database in
 * sight, which is the point: the same answer has to come back for every tenant's
 * copy of the row, and the one place that decides it is called from the one
 * place tickets are written.
 */

describe("which category asks for a description", () => {
  it("is the one whose whole meaning is 'none of the above'", () => {
    expect(needsOwnDescription(OTHER_CATEGORY_CODE)).toBe(true);
  });

  it("is not any of the ordinary ones", () => {
    for (const name of STARTER_CATEGORY_NAMES) {
      const code = categoryCode(name);
      expect(needsOwnDescription(code), name).toBe(code === OTHER_CATEGORY_CODE);
    }
  });

  it("keys on the code, so a renamed or translated copy still counts", () => {
    // A tenant may call their copy "อื่นๆ". The name is a display decision; the
    // code is the identity, which is the whole reason the column exists.
    expect(needsOwnDescription(OTHER_CATEGORY_CODE)).toBe(true);
    expect(needsOwnDescription("NETWORK")).toBe(false);
  });

  it("ships 'Other' in the starter set, so a new customer has the option", () => {
    const codes = STARTER_CATEGORY_NAMES.map(categoryCode);
    expect(codes).toContain(OTHER_CATEGORY_CODE);
    // Last, because it is the answer for a ticket the others do not fit —
    // offering it first would invite it as a default.
    expect(codes[codes.length - 1]).toBe(OTHER_CATEGORY_CODE);
  });
});

describe("filing under Other", () => {
  it("needs something written down", () => {
    expect(checkCategoryOther({ categoryCode: OTHER_CATEGORY_CODE })).toEqual({
      reason: "missing",
    });
  });

  it("treats whitespace as nothing written down", () => {
    // A space bar is not a description. This is also why the zod schema has
    // `min: 0` — a minimum there would refuse this as a field-length error and
    // this rule would never be reached to give the real answer.
    for (const blank of ["", " ", "   ", "\t", "\n  \n"]) {
      expect(
        checkCategoryOther({ categoryCode: OTHER_CATEGORY_CODE, categoryOther: blank }),
        JSON.stringify(blank),
      ).toEqual({ reason: "missing" });
    }
  });

  it("accepts a real description, in any script", () => {
    for (const text of ["Printer jams", "เครื่องพิมพ์กระดาษติด", "VPN 掉线"]) {
      expect(
        checkCategoryOther({ categoryCode: OTHER_CATEGORY_CODE, categoryOther: text }),
        text,
      ).toBeNull();
    }
  });
});

describe("filing under anything else", () => {
  it("passes with no description", () => {
    expect(checkCategoryOther({ categoryCode: "NETWORK" })).toBeNull();
  });

  it("refuses a description rather than silently dropping it", () => {
    // Dropping it would lose something a person typed and meant. And a client
    // that fills this for an ordinary category has misunderstood the field,
    // which is worth saying while it is still one client rather than three.
    expect(
      checkCategoryOther({ categoryCode: "NETWORK", categoryOther: "something" }),
    ).toEqual({ reason: "not_applicable" });
  });

  it("does not mind whitespace, which is the same as nothing", () => {
    expect(
      checkCategoryOther({ categoryCode: "NETWORK", categoryOther: "   " }),
    ).toBeNull();
  });
});

describe("what gets stored", () => {
  it("trims, so the column holds the words and not the typing", () => {
    expect(
      storedCategoryOther({
        categoryCode: OTHER_CATEGORY_CODE,
        categoryOther: "  printer jams  ",
      }),
    ).toBe("printer jams");
  });

  it("stores null, never an empty string", () => {
    // "Nobody wrote one" and "somebody wrote nothing" are the same fact, and two
    // spellings of it in a column is how a later query gets it wrong.
    expect(
      storedCategoryOther({ categoryCode: OTHER_CATEGORY_CODE, categoryOther: "  " }),
    ).toBeNull();
    expect(storedCategoryOther({ categoryCode: "NETWORK" })).toBeNull();
  });

  it("keeps nothing for a category that does not take one", () => {
    expect(
      storedCategoryOther({ categoryCode: "NETWORK", categoryOther: "ignored" }),
    ).toBeNull();
  });
});
