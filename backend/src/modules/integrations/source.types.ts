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
