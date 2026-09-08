import { describe, expect, it } from "vitest";
import { customerReach, isPlatformWide, mayGrantReach } from "./auth";
import type { Role } from "./domain";

const principal = (
  role: Role,
  customerId: number | null,
  customerIds?: number[] | null,
) => ({ role, customerId, customerIds });

/**
 * Reach is the predicate every row-level scope filters on, so these are the
 * tests that say what "which customers may this person see" means. The scope
 * builders each have their own file for the clause they produce; this one is
 * about the decision they all share.
 */
describe("customerReach", () => {
  it("is the home customer when nothing has been granted", () => {
    // The behaviour every account had before grants existed, and still the
    // answer for almost everyone — which is why an empty table needed no backfill.
    expect(customerReach(principal("admin", 7))).toEqual([7]);
  });

  it("treats a token minted before grants existed as home-only", () => {
    // `customerIds` absent, not empty: a token still in flight across the deploy.
    expect(customerReach({ customerId: 7 })).toEqual([7]);
    expect(customerReach({ customerId: 7, customerIds: null })).toEqual([7]);
  });

  it("always includes home, even when the grant list forgets it", () => {
    expect(customerReach(principal("admin", 7, [9])).sort()).toEqual([7, 9]);
  });

  it("does not double-count home when the grant repeats it", () => {
    expect(customerReach(principal("admin", 7, [7, 9])).sort()).toEqual([7, 9]);
  });

  it("is empty for someone with no customer and no grant", () => {
    // Empty means "no customer of their own" and nothing more. Whether that
    // person reaches everything is `isPlatformWide`'s question, not this one —
    // a scope builder that read an empty reach as "unfiltered" would hand every
    // tenant to any customer-less agent.
    expect(customerReach(principal("admin", null))).toEqual([]);
  });

  it("gives a customer-less principal exactly what they were granted", () => {
    expect(customerReach(principal("admin", null, [9]))).toEqual([9]);
  });
});

describe("isPlatformWide alongside reach", () => {
  it("does not become true by granting every customer", () => {
    // The distinction the model rests on. Platform-wide reaches the customer
    // created tomorrow; a grant list does not, and collapsing the two would let
    // a grant quietly become the top privilege.
    const everything = principal("super_admin", 3, [1, 2, 3]);
    expect(customerReach(everything).sort()).toEqual([1, 2, 3]);
    expect(isPlatformWide(everything)).toBe(false);
  });

  it("does not become true by granting a customer-less admin every customer", () => {
    const granted = principal("admin", null, [1, 2, 3]);
    expect(isPlatformWide(granted)).toBe(false);
  });

  it("stays keyed on the top role AND no home customer", () => {
    expect(isPlatformWide(principal("super_admin", null))).toBe(true);
    expect(isPlatformWide(principal("super_admin", null, []))).toBe(true);
  });

  it("is not conferred by a grant onto a super admin who has a home", () => {
    expect(isPlatformWide(principal("super_admin", 1, [2]))).toBe(false);
  });
});

describe("mayGrantReach", () => {
  it("is platform-wide only", () => {
    expect(mayGrantReach(principal("super_admin", null))).toBe(true);
  });

  it("is refused to a customer's own super admin", () => {
    expect(mayGrantReach(principal("super_admin", 1))).toBe(false);
  });

  it("is refused to an admin, who may create a customer but not walk into one", () => {
    // The escalation this closes: creating a tenant is allowed at admin level,
    // so if granting reach were too, an admin could make a customer and let
    // themselves in without anyone reviewing it.
    expect(mayGrantReach(principal("admin", 1))).toBe(false);
    expect(mayGrantReach(principal("admin", null))).toBe(false);
  });

  it("is not earned by holding a wide grant already", () => {
    expect(mayGrantReach(principal("super_admin", 1, [1, 2, 3]))).toBe(false);
  });
});
