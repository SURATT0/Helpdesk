import type { AuthUser } from "../../shared/auth";
import {
  NotFound,
  NotImplemented,
  SourceNotConfigured,
} from "../../shared/errors";
import {
  ticketService,
  type ImportResult,
  type ImportRow,
} from "../tickets/ticket.service";
import { sourceRegistry } from "./source.registry";
import {
  isMailSource,
  toSourceInfo,
  type MailSyncResult,
  type SourceInfo,
} from "./source.types";

/**
 * What a sync did, in the shape of whatever kind of source ran.
 *
 * Two shapes rather than one flattened superset, because the two say different
 * things. A ticket system reports rows imported; mail reports what each message
 * BECAME — a new ticket, a reply threaded onto an existing one, or a duplicate
 * already seen. Collapsing those into "imported: 3" would hide the distinction
 * that matters most when mail starts misbehaving.
 */
export type SyncResult =
  | { source: string; kind: "import"; fetched: number; import: ImportResult }
  | { source: string; kind: "mail"; mail: MailSyncResult };

export const integrationService = {
  /** All registered sources with their implemented/configured status. */
  listSources(): SourceInfo[] {
    return sourceRegistry.list().map(toSourceInfo);
  },

  /**
   * Pull tickets from one source and create them via the shared import pipeline
   * (the same `importMany` used by CSV import — resolving category names and
   * requester emails, with per-row results). A source that isn't implemented or
   * isn't configured fails fast with a clear error before any fetch.
   */
  async syncFromSource(id: string, user: AuthUser): Promise<SyncResult> {
    const source = sourceRegistry.get(id);
    if (!source) throw NotFound(`Unknown source "${id}"`);
    if (!source.implemented) {
      throw NotImplemented(`${source.label} is not implemented yet`);
    }
    if (!source.isConfigured()) {
      throw SourceNotConfigured(source.label);
    }

    // Mail ingests itself. `importMany` below needs a requester who already
    // exists, knows nothing about threading a reply onto the ticket it answers,
    // and would re-import every message it has seen before — so a mail adapter
    // goes to `emailService.ingest()` instead, the same path the inbound
    // webhook uses. See `IMailSource`.
    if (isMailSource(source)) {
      return { source: id, kind: "mail", mail: await source.syncMail() };
    }

    const external = await source.fetchTickets();
    const rows: ImportRow[] = external.map((t) => ({
      subject: t.subject,
      description: t.description,
      priority: t.priority,
      category: t.category,
      requesterEmail: t.requesterEmail,
    }));
    const result = await ticketService.importMany(rows, user);
    return { source: id, kind: "import", fetched: external.length, import: result };
  },
};
