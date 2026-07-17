import { env } from "../../../config/env";
import { NotImplemented } from "../../../shared/errors";
import type { ExternalTicket, ITicketSource } from "../source.types";

/**
 * Zendesk Support source (stub). `isConfigured()` reflects whether the
 * ZENDESK_* env vars are present; `fetchTickets()` is not written yet.
 *
 * To implement: call the Zendesk API
 *   GET https://{subdomain}.zendesk.com/api/v2/tickets.json
 * with Basic auth `{email}/token:{apiToken}` (base64), page through the
 * `tickets` array (follow `next_page`), and map each ticket → ExternalTicket:
 *   externalId  = String(ticket.id)
 *   externalUrl = `https://{subdomain}.zendesk.com/agent/tickets/${ticket.id}`
 *   subject     = ticket.subject
 *   description = ticket.description
 *   priority    = mapPriority(ticket.priority)   // urgent→critical, high→high…
 *   category    = deriveCategory(ticket)         // from a tag / custom field
 *   requesterEmail = (users sideload)[ticket.requester_id].email
 * Return the mapped array; the service reuses the CSV import pipeline from there.
 */
export class ZendeskSource implements ITicketSource {
  readonly id = "zendesk";
  readonly label = "Zendesk Support";
  readonly description =
    "Pull tickets from a Zendesk Support instance via the REST API.";
  readonly implemented = false;

  isConfigured(): boolean {
    const { subdomain, email, apiToken } = env.integrations.zendesk;
    return Boolean(subdomain && email && apiToken);
  }

  async fetchTickets(): Promise<ExternalTicket[]> {
    throw NotImplemented(
      "The Zendesk source is scaffolded but not implemented yet",
    );
  }
}
