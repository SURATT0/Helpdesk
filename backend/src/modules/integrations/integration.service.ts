import type { AuthUser } from "../../shared/auth";
import { BadRequest, NotFound, NotImplemented } from "../../shared/errors";
import {
  ticketService,
  type ImportResult,
  type ImportRow,
} from "../tickets/ticket.service";
import { sourceRegistry } from "./source.registry";
import { toSourceInfo, type SourceInfo } from "./source.types";

export type SyncResult = {
  source: string;
  fetched: number;
  import: ImportResult;
};

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
      throw BadRequest(`${source.label} is not configured`);
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
    return { source: id, fetched: external.length, import: result };
  },
};
