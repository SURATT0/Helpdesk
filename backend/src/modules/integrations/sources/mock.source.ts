import type { ExternalTicket, ITicketSource } from "../source.types";

/**
 * A built-in source that returns a fixed set of sample tickets. It needs no
 * configuration and is always available, so the whole sync pipeline (fetch →
 * normalise → importMany → per-row results) can be exercised end-to-end before
 * any real provider is wired up. The categories/emails below match the demo
 * seed so an import actually succeeds against a seeded database.
 */
export class MockSource implements ITicketSource {
  readonly id = "mock";
  readonly label = "Sample source (mock)";
  readonly description =
    "Built-in demo source with a few sample tickets — no configuration needed.";
  readonly implemented = true;

  isConfigured(): boolean {
    return true;
  }

  async fetchTickets(): Promise<ExternalTicket[]> {
    return [
      {
        externalId: "MOCK-101",
        externalUrl: "https://example.test/browse/MOCK-101",
        subject: "Imported from mock: laptop won't boot",
        description: "Powers on then shows a black screen after the logo.",
        priority: "high",
        category: "Hardware",
        requesterEmail: "a.lindqvist@acme.com",
      },
      {
        externalId: "MOCK-102",
        externalUrl: "https://example.test/browse/MOCK-102",
        subject: "Imported from mock: cannot send external email",
        description: "Outbound mail to non-Acme addresses bounces.",
        priority: "medium",
        category: "Email",
        requesterEmail: "dana.reyes@acme.com",
      },
      {
        externalId: "MOCK-103",
        externalUrl: "https://example.test/browse/MOCK-103",
        subject: "Imported from mock: VPN request for contractor",
        description: "Needs temporary VPN access for a two-week engagement.",
        priority: "low",
        category: "Access",
        requesterEmail: "a.lindqvist@acme.com",
      },
    ];
  }
}
