/** A normalised inbound email, provider-agnostic. */
export type InboundEmail = {
  /** Sender email address (lower-cased, parsed out of any "Name <addr>" form). */
  from: string;
  /** Sender display name, if the From header carried one. */
  fromName?: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** RFC 5322 Message-ID of this mail, when the provider passes it through. */
  messageId?: string;
  /** In-Reply-To header — kept for a future header-based threading upgrade. */
  inReplyTo?: string;
  /**
   * `X-Deskly-Ticket-Id`, echoed back by a client that quoted our headers.
   *
   * The subject tag is the only routing signal that survives every client, but
   * it is also the one a person can edit, delete, or have rewritten for them by
   * a mail app that "cleans up" prefixes. This header is the belt to that
   * brace: when it comes back it is unambiguous. It is no more trusted than the
   * tag — both are attacker-supplied — so it locates a candidate ticket and the
   * same `senderMayReply` check decides whether the sender may write to it.
   */
  ticketIdHeader?: number;
};

/**
 * What one inbound mail turned into. `kind` distinguishes the two paths:
 * a reply recognised by its `[#123]` subject tag is appended to that ticket's
 * thread; anything else opens a new ticket.
 */
export type IngestResult = {
  kind: "ticket" | "comment" | "duplicate";
  ticketId: number;
  requesterId: number;
  /** True when the sender wasn't a known user and a requester was created. */
  requesterCreated: boolean;
  /** Set when the mail was threaded onto an existing ticket. */
  commentId?: number;
};

export type EmailStatus = {
  /** Inbound webhook accepts requests (a secret is configured). */
  webhookEnabled: boolean;
  /** Path providers should POST to. */
  endpoint: string;
  /** IMAP pull adapter has credentials (still a stub until implemented). */
  imapConfigured: boolean;
};
