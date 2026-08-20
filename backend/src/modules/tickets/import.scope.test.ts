import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { mayImportForRequester, type RequesterCandidate } from "./ticket.scope";

const actor = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "admin@acme.com",
    name: "A",
    role: "admin",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

const requester = (
  over: Partial<RequesterCandidate> = {},
): RequesterCandidate => ({ id: 2, customerId: 7, ...over });

describe("mayImportForRequester", () => {
  it("lets an admin file for someone in their own customer", () => {
    expect(mayImportForRequester(actor(), requester())).toBe(true);
  });

  it("refuses a requester in another customer", () => {
    // The reason this rule exists: `create` files the ticket under the
    // requester's customer, so allowing this writes a ticket into a tenant the
    // importer does not belong to — and it then vanishes from their own list
    // while the batch still counts it as created.
    expect(mayImportForRequester(actor(), requester({ customerId: 9 }))).toBe(
      false,
    );
  });

  it("refuses a requester who belongs to no customer", () => {
    // `create` rejects these anyway (a ticket needs a tenant), but failing the
    // row here names the right field instead of surfacing a thrown message.
    expect(mayImportForRequester(actor(), requester({ customerId: null }))).toBe(
      false,
    );
  });

  it("keys on reach, not on the role name", () => {
    // A super_admin who belongs to a customer stays inside it — the same rule
    // the rest of the module keys on `isPlatformWide` for.
    expect(
      mayImportForRequester(
        actor({ role: "super_admin", customerId: 7 }),
        requester({ customerId: 9 }),
      ),
    ).toBe(false);
  });

  it("lets a platform-wide super_admin file for any customer", () => {
    const platform = actor({ role: "super_admin", customerId: null });
    expect(mayImportForRequester(platform, requester({ customerId: 7 }))).toBe(true);
    expect(mayImportForRequester(platform, requester({ customerId: 9 }))).toBe(true);
  });

  it("grants nothing to customer-less staff who are not platform-wide", () => {
    // Lacking a customer must not read as reaching every customer.
    const stray = actor({ role: "admin", customerId: null });
    expect(mayImportForRequester(stray, requester({ customerId: 7 }))).toBe(false);
    expect(mayImportForRequester(stray, requester({ customerId: null }))).toBe(false);
  });
});
