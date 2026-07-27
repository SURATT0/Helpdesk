## Summary

<!-- What changes and why. One or two sentences is fine. -->

## Changes

<!-- The notable ones. Skip if the diff speaks for itself. -->

-

## Testing

<!-- What you actually ran or clicked, beyond CI. -->

-

## Invariant checklist

Only tick what applies — CI covers types, lint, and the test suites, so this list is deliberately
limited to the cross-layer rules CI cannot check. Delete the section for docs-only changes.

- [ ] **Row scoping** — any new ticket/user query is scoped in the **repository** (`WHERE` clause),
      not only behind permission middleware. Requesters see their own tickets; agents and managers
      see everything within their own customer; admins see all customers.
- [ ] **Tenant isolation** — new tables/queries carry `customer_id`, and nothing leaks across
      customers (a null `customerId` on the JWT means platform admin).
- [ ] **Status transitions** — go through the whitelist in the ticket service (illegal jumps return
      409 `ILLEGAL_TRANSITION`), and each transition appends a `ticket_status_history` row.
- [ ] **Audit** — every new mutation writes an `audit_logs` row. Tickets are closed, never deleted.
- [ ] **Auth** — access token stays in memory only (never `localStorage`); refresh cookie stays
      httpOnly and rotates on use.
- [ ] **Migration** — schema changes ship with a Prisma migration, and the seed still runs clean.
- [ ] **Design fidelity** — UI matches the tokens in `frontend/CLAUDE.md` (theme, status/priority
      palettes, shell dimensions).

## Notes for review

<!-- Anything deliberately left out, follow-up work, or a decision worth a second look. -->
