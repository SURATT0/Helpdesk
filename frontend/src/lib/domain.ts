/**
 * Domain vocabulary shared across features — priority, roles, and the text
 * caps. Ticket status has its own file, `./ticket-status`.
 */

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

export type Priority = "low" | "medium" | "high" | "critical";

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

export const PRIORITY_META: Record<
  Priority,
  { label: string; dot: string }
> = {
  critical: { label: "Critical", dot: "#dc2626" },
  high: { label: "High", dot: "#f59e0b" },
  medium: { label: "Medium", dot: "#3b82f6" },
  low: { label: "Low", dot: "#94a3b8" },
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

