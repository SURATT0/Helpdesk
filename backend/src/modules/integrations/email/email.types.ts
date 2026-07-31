/** A normalised inbound email, provider-agnostic. */
export type InboundEmail = {
  /** Sender email address (lower-cased, parsed out of any "Name <addr>" form). */
  from: string;
  /** Sender display name, if the From header carried one. */
  fromName?: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** This message's own RFC 5322 Message-ID, when the provider forwards it. */
  messageId?: string;
  /**
   * Candidate ancestor Message-IDs from In-Reply-To + References, newest first.
   * Used to thread a reply onto the ticket it belongs to before falling back to
   * the `[#id]` subject tag.
   */
  inReplyTo?: string[];
};

export type IngestResult = {
  ticketId: number;
  requesterId: number;
  /** True when the sender wasn't a known user and a requester was created. */
  requesterCreated: boolean;
  /**
   * How the message was filed. `created` = a new ticket; `threaded` = appended to
   * an existing ticket as an email-channel comment; `duplicate` = this exact
   * Message-ID was already stored, so nothing was written (provider retry).
   */
  outcome: "created" | "threaded" | "duplicate";
  /** Set for `threaded` and `duplicate` — the comment the message landed on. */
  commentId?: number;
};

export type EmailStatus = {
  /** Inbound webhook accepts requests (a secret is configured). */
  webhookEnabled: boolean;
  /** Path providers should POST to. */
  endpoint: string;
  /** IMAP pull adapter has credentials (still a stub until implemented). */
  imapConfigured: boolean;
  /**
   * A system Reply-To is configured, so agent replies thread back onto the
   * ticket. False means replies leave without a reply address — the settings UI
   * surfaces this because it silently breaks the inbound loop.
   */
  replyToConfigured: boolean;
};
