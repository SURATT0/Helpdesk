import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How outbound mail leaves through Graph, and what happens when the app was
 * granted only half of what it needs.
 *
 * Creating a draft writes to the mailbox, so it needs `Mail.ReadWrite` — a
 * SEPARATE permission from the `Mail.Send` that sending itself needs. A tenant
 * that consented to one and not the other is not a hypothetical; it is where
 * this fallback came from. The desk must not sit silent holding a credential
 * that can send perfectly well.
 *
 * What these pin is the behaviour a real tenant taught us: the draft is tried,
 * a 403 is taken as the answer rather than an error, the answer is remembered
 * so the next mail does not pay for it again, and anything else still fails
 * loudly.
 */

const graphEnv = vi.hoisted(() => ({
  tenantId: "tenant-1",
  clientId: "client-1",
  clientSecret: "shhh",
  mailbox: "support@contoso.com",
  pageSize: 25,
  markAsRead: true,
  send: true,
}));

vi.mock("../../../config/env", () => ({
  env: {
    smtp: { host: "", from: "Deskly <support@contoso.com>" },
    integrations: { graph: graphEnv },
  },
}));

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../../shared/logger", () => ({ logger: log }));

const graphFetch = vi.hoisted(() => vi.fn());
vi.mock("./graph-client", () => ({
  graphFetch,
  graphConfigured: () => true,
  safeText: async (r: { text: () => Promise<string> }) => r.text(),
}));

/** A fetch-ish response, only as much of one as the sender actually reads. */
const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const MAIL = {
  from: "Deskly <support@contoso.com>",
  to: "ann@contoso.com",
  subject: "[#1042] VPN drops",
  text: "Looking into it.",
  html: "<p>Looking into it.</p>",
  headers: { "X-Deskly-Ticket-Id": "1042" },
};

/** A fresh module graph per case — the fallback is remembered per instance. */
async function freshSender() {
  vi.resetModules();
  const { mailSender } = await import("./mail-sender");
  return mailSender;
}

beforeEach(() => {
  graphFetch.mockReset();
  log.warn.mockReset();
});

describe("when the app may write drafts", () => {
  it("drafts, sends that draft, and returns the id Exchange stamped", async () => {
    graphFetch
      .mockResolvedValueOnce(
        reply(201, { id: "draft-1", internetMessageId: "<stamped@contoso.com>" }),
      )
      .mockResolvedValueOnce(reply(202));

    const sender = await freshSender();
    const res = await sender.send(MAIL as never);

    expect(res).toEqual({
      transport: "graph",
      messageId: "<stamped@contoso.com>",
    });
    // The id is the whole reason for the second round trip: the threading chain
    // is built from what the PREVIOUS send returned.
    expect(graphFetch).toHaveBeenCalledTimes(2);
    expect(graphFetch.mock.calls[1][0]).toContain("/messages/draft-1/send");
  });

  it("puts the ticket header on the message", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(201, { id: "draft-1" }))
      .mockResolvedValueOnce(reply(202));

    const sender = await freshSender();
    await sender.send(MAIL as never);

    const body = JSON.parse(graphFetch.mock.calls[0][1].body);
    expect(body.internetMessageHeaders).toEqual([
      { name: "X-Deskly-Ticket-Id", value: "1042" },
    ]);
  });
});

describe("when the app holds only Mail.Send", () => {
  it("falls back to sendMail and the mail still goes", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(403, { error: { code: "ErrorAccessDenied" } }))
      .mockResolvedValueOnce(reply(202));

    const sender = await freshSender();
    const res = await sender.send(MAIL as never);

    // No messageId, and deliberately not an invented one: a Message-ID no mail
    // server stamped would be a reference to a message that does not exist.
    expect(res).toEqual({ transport: "graph" });
    expect(graphFetch.mock.calls[1][0]).toContain("/sendMail");
  });

  it("carries the same message either way", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(403, {}))
      .mockResolvedValueOnce(reply(202));

    const sender = await freshSender();
    await sender.send(MAIL as never);

    const sent = JSON.parse(graphFetch.mock.calls[1][1].body);
    expect(sent.message.subject).toBe(MAIL.subject);
    expect(sent.message.toRecipients[0].emailAddress.address).toBe(MAIL.to);
    // The header travels on the direct path too — which is why losing the draft
    // costs the recipient's threading and not the desk's routing.
    expect(sent.message.internetMessageHeaders).toEqual([
      { name: "X-Deskly-Ticket-Id", value: "1042" },
    ]);
  });

  it("stops trying to draft, rather than paying a 403 per mail", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(403, {})) // first draft attempt
      .mockResolvedValueOnce(reply(202)) // first sendMail
      .mockResolvedValueOnce(reply(202)); // second mail, straight to sendMail

    const sender = await freshSender();
    await sender.send(MAIL as never);
    await sender.send(MAIL as never);

    expect(graphFetch).toHaveBeenCalledTimes(3);
    expect(graphFetch.mock.calls[2][0]).toContain("/sendMail");
  });

  it("says so once, not on every mail", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(403, {}))
      .mockResolvedValue(reply(202));

    const sender = await freshSender();
    await sender.send(MAIL as never);
    await sender.send(MAIL as never);

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("failures that are not about permission", () => {
  it("still throws when the draft fails for another reason", async () => {
    // A 401 is a broken credential and a 404 a mailbox that does not exist.
    // Quietly sending direct on either would turn a misconfiguration into mail
    // that loses its threading forever, with nothing said.
    graphFetch.mockResolvedValueOnce(reply(404, { error: { code: "NotFound" } }));

    const sender = await freshSender();
    await expect(sender.send(MAIL as never)).rejects.toThrow(/404/);
  });

  it("throws when sendMail itself is refused", async () => {
    graphFetch
      .mockResolvedValueOnce(reply(403, {}))
      .mockResolvedValueOnce(reply(500, { error: { code: "ServiceUnavailable" } }));

    const sender = await freshSender();
    await expect(sender.send(MAIL as never)).rejects.toThrow(/sendMail failed/);
  });
});
