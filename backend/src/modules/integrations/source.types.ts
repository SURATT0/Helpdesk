import type { Priority } from "../../shared/domain";

/**
 * A ticket as fetched from an external system, already normalised onto Deskly's
 * vocabulary. Each adapter is responsible for translating its own fields
 * (Jira issue types, Zendesk priorities, …) into this shape, so the rest of the
 * pipeline never learns a provider's quirks. `externalId`/`externalUrl` are kept
 * for a future de-duplication / back-link feature; the import path ignores them
 * for now.
 */
export type ExternalTicket = {
  externalId: string;
  externalUrl?: string;
  subject: string;
  description: string;
  priority: Priority;
  category: string;
  requesterEmail: string;
};

/**
 * A pluggable external ticket source. Mirrors the IFileStorage adapter pattern:
 * one interface, many drivers, chosen/registered centrally. To add a provider,
 * implement this and register it in source.registry.ts — nothing else changes.
 */
export interface ITicketSource {
  /** Stable machine id used in the URL, e.g. "jira". */
  readonly id: string;
  /** Human label for the UI, e.g. "Jira Cloud". */
  readonly label: string;
  /** One-line description shown on the integrations card. */
  readonly description: string;
  /** False while the adapter is still a stub (real fetch not written yet). */
  readonly implemented: boolean;
  /** Whether the required credentials/config are present in the environment. */
  isConfigured(): boolean;
  /** Pull tickets from the source, normalised to ExternalTicket. */
  fetchTickets(): Promise<ExternalTicket[]>;
}

/**
 * What one sync of a mail source did.
 *
 * Mail is counted by what it BECAME, not by how many rows were created: the
 * same sweep can open tickets, append replies to threads it recognises, and
 * discard mail it has already seen. A single "imported" number would hide the
 * last two, and those are the ones worth watching — a sudden pile of duplicates
 * says the read-marking is not sticking.
 */
export type MailSyncResult = {
  fetched: number;
  tickets: number;
  comments: number;
  duplicates: number;
  /** Messages that threw, with the reason. One bad mail must not stop the rest. */
  failures: { messageId?: string; reason: string }[];
};

/**
 * A source that turns MAIL into tickets, and does the turning itself.
 *
 * Mail cannot go through `fetchTickets` → `importMany` like a ticket system
 * does. That path needs a requester who already exists, knows nothing about
 * threading a reply onto the ticket it answers, and would re-import every
 * message it has seen before. `emailService.ingest()` handles all three, and is
 * the same path the inbound webhook uses — so a mail adapter calls it directly
 * rather than flattening a conversation into rows and losing what makes it one.
 *
 * `ingestsOwnMail` is the flag the sync endpoint branches on. It is a property
 * rather than an `instanceof` so the registry stays a list of interfaces.
 */
export interface IMailSource extends ITicketSource {
  readonly ingestsOwnMail: true;
  syncMail(): Promise<MailSyncResult>;
}

export function isMailSource(s: ITicketSource): s is IMailSource {
  return (s as IMailSource).ingestsOwnMail === true;
}

/** DTO describing a source's availability, returned by GET /integrations/sources. */
export type SourceInfo = {
  id: string;
  label: string;
  description: string;
  implemented: boolean;
  configured: boolean;
};

export function toSourceInfo(s: ITicketSource): SourceInfo {
  return {
    id: s.id,
    label: s.label,
    description: s.description,
    implemented: s.implemented,
    configured: s.isConfigured(),
  };
}
