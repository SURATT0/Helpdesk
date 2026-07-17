import { env } from "../../../config/env";
import { NotImplemented } from "../../../shared/errors";
import type { ExternalTicket, ITicketSource } from "../source.types";

/**
 * Email inbox (IMAP) source (stub). `isConfigured()` reflects the IMAP_* env
 * vars; `fetchTickets()` is not written yet.
 *
 * To implement: connect with an IMAP client (e.g. `imapflow`), open INBOX,
 * search UNSEEN, fetch + parse each message (e.g. `mailparser`), then — rather
 * than mapping to ExternalTicket and going through importMany (which requires an
 * existing requester) — route each message through emailService.ingest(), which
 * already handles unknown senders (auto-creating a requester), subject-tag
 * priority, and the default category. Mark messages \Seen once ingested.
 * Because the ingestion path differs, this adapter mainly exists so IMAP shows
 * up in the integrations list with a real configured/not-configured status.
 */
export class ImapEmailSource implements ITicketSource {
  readonly id = "imap-email";
  readonly label = "Email inbox (IMAP)";
  readonly description =
    "Poll an IMAP mailbox and turn unread messages into tickets.";
  readonly implemented = false;

  isConfigured(): boolean {
    const { host, user, password } = env.integrations.imap;
    return Boolean(host && user && password);
  }

  async fetchTickets(): Promise<ExternalTicket[]> {
    throw NotImplemented(
      "IMAP polling is scaffolded; wire it to emailService.ingest()",
    );
  }
}
