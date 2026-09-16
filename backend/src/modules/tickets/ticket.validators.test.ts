import { describe, expect, it } from "vitest";
import { DB_STATUSES } from "../../shared/ticket-status";
import { deskSettableStatus, ticketStatus, updateStatusBody } from "./ticket.validators";

/**
 * The one place the desk's vocabulary is deliberately narrower than the
 * database's.
 *
 * `cancelled` is the requester withdrawing their own request. The transition
 * whitelist can say `new → cancelled` is a legal move but cannot say who may
 * make it, so keeping the value off `PATCH /:id/status` is what actually makes
 * it the requester's — and a literal list is easy to widen by accident.
 */
describe("what the desk may set", () => {
  it("accepts every stored status except cancelled", () => {
    expect([...deskSettableStatus.options].sort()).toEqual(
      DB_STATUSES.filter((s) => s !== "cancelled").sort(),
    );
  });

  it("refuses a cancellation sent to the desk's endpoint", () => {
    expect(updateStatusBody.safeParse({ status: "cancelled" }).success).toBe(
      false,
    );
  });

  it("still lets the desk take a withdrawal back", () => {
    // `cancelled → new` is in the whitelist so a mis-cancelled ticket is not a
    // trapdoor, and the desk reaches it through this same endpoint.
    expect(updateStatusBody.safeParse({ status: "new" }).success).toBe(true);
  });

  it("keeps the storable vocabulary complete, cancellations included", () => {
    // `ticketStatus` is the wider one — filters and imports speak it, so a
    // cancelled ticket stays findable.
    expect([...ticketStatus.options].sort()).toEqual([...DB_STATUSES].sort());
  });
});
