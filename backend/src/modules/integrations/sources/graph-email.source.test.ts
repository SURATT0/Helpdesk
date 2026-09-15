import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toInboundEmail, GraphEmailSource } from "./graph-email.source";
import { resetGraphToken } from "../email/graph-client";

/**
 * The Microsoft 365 adapter, without Microsoft.
 *
 * There is no tenant to point these at, and one that existed would make the
 * suite depend on somebody's mailbox and somebody's network. What IS ours, and
 * what these cover, is everything between the wire and the ingest call: which
 * field becomes which, what happens to a message with no sender, whether a
 * failed mail stops the sweep, and whether a mail is marked read before it is
 * safely a ticket.
 *
 * The one thing they cannot prove is that Graph's responses look like the
 * fixtures — that is what a first run against a real tenant is for.
 */

const ingest = vi.hoisted(() => vi.fn());
vi.mock("../email/email.service", () => ({ emailService: { ingest } }));

const graphEnv = vi.hoisted(() => ({
  tenantId: "tenant-1",
  clientId: "client-1",
  clientSecret: "shhh",
  mailbox: "support@contoso.com",
  pageSize: 25,
  markAsRead: true,
}));
vi.mock("../../../config/env", () => ({
  env: { integrations: { graph: graphEnv } },
}));
vi.mock("../../../shared/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe("mapping a Graph message onto an inbound email", () => {
  const base = {
    id: "graph-handle-1",
    internetMessageId: "<abc@contoso.com>",
    subject: "Printer is on fire",
    bodyPreview: "It really is.",
    from: { emailAddress: { address: "Ann@Contoso.com", name: "Ann" } },
  };

  it("takes the sender, subject and text, and lower-cases the address", () => {
    const mail = toInboundEmail(base)!;
    expect(mail.from).toBe("ann@contoso.com");
    expect(mail.fromName).toBe("Ann");
    expect(mail.subject).toBe("Printer is on fire");
    expect(mail.text).toBe("It really is.");
  });

  it("threads on the RFC Message-ID, never on Graph's own handle", () => {
    // Graph's `id` is per-MAILBOX: the same mail read from two mailboxes has two
    // of them and one Message-ID. Dedup keyed on the handle would let the same
    // mail open a second ticket from a second mailbox.
    const mail = toInboundEmail(base)!;
    expect(mail.messageId).toBe("<abc@contoso.com>");
    expect(mail.messageId).not.toBe(base.id);
  });

  it("falls back to `sender` when `from` is absent", () => {
    const mail = toInboundEmail({
      ...base,
      from: undefined,
      sender: { emailAddress: { address: "relay@contoso.com" } },
    })!;
    expect(mail.from).toBe("relay@contoso.com");
  });

  it("skips a message with no sender at all rather than guessing one", () => {
    expect(toInboundEmail({ ...base, from: undefined, sender: undefined })).toBeNull();
  });

  it("strips HTML only when there is no preview to use", () => {
    const mail = toInboundEmail({
      ...base,
      bodyPreview: undefined,
      body: {
        contentType: "html",
        content: "<p>Hello&nbsp;<b>there</b></p><script>alert(1)</script>",
      },
    })!;
    expect(mail.text).toBe("Hello there");
    expect(mail.text).not.toMatch(/<|script/);
  });

  it("gives a subjectless mail a subject rather than an empty one", () => {
    expect(toInboundEmail({ ...base, subject: "   " })!.subject).toBe("(no subject)");
  });
});

describe("one sync of the mailbox", () => {
  const source = new GraphEmailSource();
  let calls: { url: string; init?: RequestInit }[];

  function reply(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  beforeEach(() => {
    calls = [];
    ingest.mockReset();
    // A fresh token per test, so the cache cannot leak between them. It lives
    // in the shared Graph client now, which both directions share.
    resetGraphToken();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("login.microsoftonline.com")) {
          return reply({ access_token: "tok", expires_in: 3600 });
        }
        if (String(url).includes("/messages?")) {
          return reply({
            value: [
              {
                id: "h1",
                internetMessageId: "<one@x>",
                subject: "One",
                bodyPreview: "first",
                from: { emailAddress: { address: "a@x.com" } },
              },
              {
                id: "h2",
                internetMessageId: "<two@x>",
                subject: "Two",
                bodyPreview: "second",
                from: { emailAddress: { address: "b@x.com" } },
              },
            ],
          });
        }
        return reply({});
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is configured only when all four values are present", () => {
    expect(source.isConfigured()).toBe(true);
    graphEnv.clientSecret = "";
    expect(source.isConfigured()).toBe(false);
    graphEnv.clientSecret = "shhh";
  });

  it("asks for unread mail oldest first, so a reply never precedes its own mail", async () => {
    await source.syncMail();
    const list = calls.find((c) => c.url.includes("/messages?"))!;
    expect(list.url).toContain("isRead+eq+false");
    expect(list.url).toContain("receivedDateTime+asc");
    expect(list.url).toContain(encodeURIComponent("support@contoso.com"));
  });

  it("counts what each mail became, not how many arrived", async () => {
    ingest
      .mockResolvedValueOnce({ kind: "ticket", ticketId: 1, requesterId: 1, requesterCreated: true })
      .mockResolvedValueOnce({ kind: "duplicate", ticketId: 1, requesterId: 1, requesterCreated: false });

    const res = await source.syncMail();
    expect(res).toMatchObject({ fetched: 2, tickets: 1, comments: 0, duplicates: 1 });
    expect(res.failures).toHaveLength(0);
  });

  it("marks a mail read only AFTER it is safely a ticket", async () => {
    ingest.mockResolvedValue({ kind: "ticket", ticketId: 1, requesterId: 1, requesterCreated: false });
    await source.syncMail();
    const patches = calls.filter((c) => c.init?.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0].init!.body).toBe(JSON.stringify({ isRead: true }));
  });

  it("leaves a mail unread when ingest throws, and carries on to the next", async () => {
    // Unread IS the record that it still needs handling — marking it anyway
    // would lose the mail entirely.
    ingest
      .mockRejectedValueOnce(new Error("no tenant to file it under"))
      .mockResolvedValueOnce({ kind: "ticket", ticketId: 2, requesterId: 1, requesterCreated: false });

    const res = await source.syncMail();
    expect(res.tickets).toBe(1);
    expect(res.failures).toEqual([
      { messageId: "<one@x>", reason: "no tenant to file it under" },
    ]);
    // Exactly one PATCH: the mail that failed was left alone.
    expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(1);
  });

  it("reuses one token for the whole sweep", async () => {
    ingest.mockResolvedValue({ kind: "ticket", ticketId: 1, requesterId: 1, requesterCreated: false });
    await source.syncMail();
    expect(calls.filter((c) => c.url.includes("login.microsoftonline.com"))).toHaveLength(1);
  });

  it("says what Microsoft said when the token is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ error_description: "AADSTS7000215: bad secret" }, false, 401)),
    );
    resetGraphToken();
    await expect(source.syncMail()).rejects.toThrow(/AADSTS7000215/);
  });

  it("refuses to be used as a ticket-list source", async () => {
    await expect(source.fetchTickets()).rejects.toThrow(/syncMail/);
  });
});
