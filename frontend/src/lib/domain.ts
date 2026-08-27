/**
 * Domain vocabulary shared across features — priority, roles, and the text
 * caps. Ticket status has its own file, `./ticket-status`.
 */

import { PRIORITY_DOT } from "./palette";

/**
 * Ticket status lives in `./ticket-status` — the stored vocabulary, the
 * displayed one, the derivation between them, the transition whitelist and the
 * badge palette, all in one file. Re-exported here ONLY as types so existing
 * imports of the domain vocabulary keep working.
 */
export type {
  DisplayStatus,
  TicketStatus,
  TicketStatusRecord,
} from "./ticket-status";

/**
 * Priority, most urgent first — the order a triage surface lists it in (the
 * filter facet, the bulk menu, the history filter).
 *
 * Four components used to declare this list themselves, in TWO different
 * orders, so the same menu read top-down differently on Create Ticket than on
 * the filter bar. One list, and the places that want it the other way up say so
 * by name below.
 */
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Mildest first — the order a FORM offers, matching the API's enum. A person
 * filling in a new ticket is choosing on a scale, and a scale that starts at
 * "critical" invites the top of the list; a triage queue is the opposite, which
 * is why both orders exist and neither is wrong.
 */
export const PRIORITIES_ASCENDING = [...PRIORITIES].reverse() as Priority[];

/**
 * Roles, mirroring the API's enum. `features/auth/schemas.ts` owns the runtime
 * parse (`roleSchema`); this is the same union as a type, so the rules below can
 * live here in lib/ without features/ depending on features/.
 */
export type Role = "super_admin" | "admin" | "user";

/**
 * Does this ticket's conversation have an external side at all?
 *
 * Mirrors `isInternalThread` in the API's shared/domain — the server enforces it
 * (a comment on such a ticket is stored as a note, an email reply is refused),
 * and this is what lets the UI stop offering the tabs that would be refused.
 *
 * A ticket raised by a `user` has a requester on the other end to chat with and
 * to mail. One raised by staff does not: they opened it, they work it, they close
 * it, so every message on it is an internal note. Keyed on the REQUESTER's role
 * and not the viewer's, so a second admin picking up the case sees the same
 * one-sided thread the requesting admin does.
 */
export function isInternalThread(requesterRole: Role): boolean {
  return requesterRole !== "user";
}

/**
 * Keyed on `Priority`, so a value added to `PRIORITIES` and not here is a type
 * error rather than a blank dot. Insertion order matches `PRIORITIES`, which is
 * what `Object.keys` on this used to be relied on for.
 *
 * The colours come from `lib/palette`, which the Tailwind config also reads —
 * these four hex values used to be written here AND as `colors.priority.*`, so
 * the dot beside a word and the `bg-priority-*` chip in the closed log could
 * drift apart.
 */
export const PRIORITY_META: Record<
  Priority,
  { label: string; dot: string }
> = {
  critical: { label: "Critical", dot: PRIORITY_DOT.critical },
  high: { label: "High", dot: PRIORITY_DOT.high },
  medium: { label: "Medium", dot: PRIORITY_DOT.medium },
  low: { label: "Low", dot: PRIORITY_DOT.low },
};

/**
 * Length caps on the free-text fields, mirroring `TEXT_MAX` in the API's
 * `shared/text.ts`. The server is the authority and refuses anything longer
 * with a 400; these exist so a person finds out while typing rather than after
 * submitting, where the only feedback is a flat "Invalid request".
 *
 * Keep the two in step: raising one without the other turns into either a
 * field that refuses what the API accepts, or the vague rejection again.
 */
export const TEXT_MAX = {
  SUBJECT: 200,
  BODY: 20_000,
} as const;

