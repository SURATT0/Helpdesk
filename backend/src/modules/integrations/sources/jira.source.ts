import { env } from "../../../config/env";
import { NotImplemented } from "../../../shared/errors";
import type { ExternalTicket, ITicketSource } from "../source.types";

/**
 * Jira Cloud source (stub). `isConfigured()` reflects whether the JIRA_* env
 * vars are present; `fetchTickets()` is not written yet.
 *
 * To implement: call the Jira REST API v3 search endpoint
 *   GET {baseUrl}/rest/api/3/search?jql={jql}
 * with Basic auth `email:apiToken` (base64), page through `issues`, and map each
 * issue → ExternalTicket:
 *   externalId  = issue.key                         (e.g. "SUP-123")
 *   externalUrl = `${baseUrl}/browse/${issue.key}`
 *   subject     = issue.fields.summary
 *   description = renderAdf(issue.fields.description)   // ADF → plain text
 *   priority    = mapPriority(issue.fields.priority.name)  // Highest/High→high…
 *   category    = issue.fields.components?.[0]?.name ?? "General"
 *   requesterEmail = issue.fields.reporter.emailAddress    // needs GDPR-strict
 *                    account handling on some sites
 * Return the mapped array; the service reuses the CSV import pipeline from there.
 */
export class JiraSource implements ITicketSource {
  readonly id = "jira";
  readonly label = "Jira Cloud";
  readonly description =
    "Pull issues from a Jira Cloud project via the REST API (JQL-filtered).";
  readonly implemented = false;

  isConfigured(): boolean {
    const { baseUrl, email, apiToken } = env.integrations.jira;
    return Boolean(baseUrl && email && apiToken);
  }

  async fetchTickets(): Promise<ExternalTicket[]> {
    throw NotImplemented(
      "The Jira source is scaffolded but not implemented yet",
    );
  }
}
