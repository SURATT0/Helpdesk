/** A normalised inbound email, provider-agnostic. */
export type InboundEmail = {
  /** Sender email address (lower-cased, parsed out of any "Name <addr>" form). */
  from: string;
  /** Sender display name, if the From header carried one. */
  fromName?: string;
  subject: string;
  /** Plain-text body. */
  text: string;
};

export type IngestResult = {
  ticketId: number;
  requesterId: number;
  /** True when the sender wasn't a known user and a requester was created. */
  requesterCreated: boolean;
};

export type EmailStatus = {
  /** Inbound webhook accepts requests (a secret is configured). */
  webhookEnabled: boolean;
  /** Path providers should POST to. */
  endpoint: string;
  /** IMAP pull adapter has credentials (still a stub until implemented). */
  imapConfigured: boolean;
};
