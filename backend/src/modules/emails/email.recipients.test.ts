import { describe, expect, it } from "vitest";
import {
  audienceOf,
  emailRecipients,
  type RecipientContext,
} from "./email.recipients";
import { EMAIL_EVENTS, type EmailEvent } from "./email.events";

/**
 * Recipient rules — the safety property of the whole feature.
 *
 * Driven by a fake `db` rather than a real one on purpose: these assertions are
 * about a decision, not about SQL, and they have to be cheap enough that nobody
 * is tempted to skip them. The fake implements only the three reads the module
 * makes, so a change that starts reading something else fails loudly here.
 */

type FakeUser = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  language: string;
  customerId: number | null;
  teamId?: number | null;
};

const REQUESTER: FakeUser = {
  id: 1,
  name: "Dana Reyes",
  email: "dana@acme.com",
  isActive: true,
  language: "th",
  customerId: 10,
};
const ASSIGNEE: FakeUser = {
  id: 2,
  name: "Jo Patel",
  email: "jo@acme.com",
  isActive: true,
  language: "en",
  customerId: 10,
  teamId: 99,
};
const QUEUE_MATE: FakeUser = {
  id: 3,
  name: "Sam Lee",
  email: "sam@acme.com",
  isActive: true,
  language: "en",
  customerId: 10,
  teamId: 99,
};
/** Same team, DIFFERENT tenant — must never be mailed about customer 10's work. */
const OTHER_TENANT: FakeUser = {
  id: 4,
  name: "Kim Other",
  email: "kim@other.com",
  isActive: true,
  language: "en",
  customerId: 20,
  teamId: 99,
};

function fakeDb(opts: {
  users?: FakeUser[];
  defaultTeamId?: number | null;
} = {}) {
  const users = opts.users ?? [REQUESTER, ASSIGNEE, QUEUE_MATE, OTHER_TENANT];
  return {
    user: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        users.find((u) => u.id === where.id) ?? null,
      findMany: async ({
        where,
      }: {
        where: { teamId: number; isActive: boolean; customerId: number };
      }) =>
        users.filter(
          (u) =>
            u.teamId === where.teamId &&
            u.isActive === where.isActive &&
            u.customerId === where.customerId,
        ),
    },
    category: {
      findUnique: async () => ({
        defaultTeamId:
          opts.defaultTeamId === undefined ? 99 : opts.defaultTeamId,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ctx = (over: Partial<RecipientContext> = {}): RecipientContext => ({
  ticketId: 1046,
  customerId: 10,
  requesterId: REQUESTER.id,
  assigneeId: ASSIGNEE.id,
  categoryId: 5,
  actorId: null,
  ...over,
});

describe("the requester never receives internal traffic", () => {
  // The rule the whole feature is built around. Asserted on the recipient LIST,
  // not on a rendered body, because the list is where the decision is made — a
  // body that never gets composed cannot leak.
  it("an internal note resolves to the desk, with no requester in the list", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "comment.internal_note",
      ctx({ actorId: ASSIGNEE.id }),
      fakeDb(),
    );
    expect(recipients.map((r) => r.userId)).not.toContain(REQUESTER.id);
    expect(recipients.map((r) => r.email)).not.toContain(REQUESTER.email);
  });

  it("an internal note on an UNASSIGNED ticket goes to the queue, still not the requester", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "comment.internal_note",
      ctx({ assigneeId: null, actorId: 99 }),
      fakeDb(),
    );
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.map((r) => r.userId)).not.toContain(REQUESTER.id);
  });

  // The nastiest shape: an admin raised the ticket themselves AND is holding it.
  // They are the requester, so the desk's internal traffic about their own
  // ticket is not mailed to them — they read it in the app.
  it("excludes the requester even when they are also the assignee", async () => {
    const selfHeld = ctx({ assigneeId: REQUESTER.id, actorId: 3 });
    const { recipients } = await emailRecipients.forEvent(
      "comment.internal_note",
      selfHeld,
      fakeDb(),
    );
    expect(recipients.map((r) => r.userId)).not.toContain(REQUESTER.id);
  });

  it("excludes the requester when they sit in the queue team", async () => {
    const requesterInTeam = { ...REQUESTER, teamId: 99 };
    const { recipients } = await emailRecipients.forEvent(
      "queue.requester_replied",
      ctx({ assigneeId: null, actorId: REQUESTER.id }),
      fakeDb({ users: [requesterInTeam, ASSIGNEE, QUEUE_MATE] }),
    );
    expect(recipients.map((r) => r.userId)).not.toContain(REQUESTER.id);
  });

  // Belt and braces on the table itself: every staff event must be declared
  // staff, so adding one without thinking cannot quietly make it outbound.
  it("only the acknowledgement-style events are addressed to the requester", () => {
    const outward = EMAIL_EVENTS.filter(
      (e: EmailEvent) => audienceOf(e) === "requester",
    );
    expect([...outward].sort()).toEqual(
      [
        "comment.public_reply",
        "digest.multiple_updates",
        "ticket.auto_close_reminder",
        "ticket.closed",
        "ticket.created",
        "ticket.pending",
      ].sort(),
    );
  });
});

describe("public replies do reach the requester", () => {
  it("mails the requester when staff replied publicly", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "comment.public_reply",
      ctx({ actorId: ASSIGNEE.id }),
      fakeDb(),
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      userId: REQUESTER.id,
      email: REQUESTER.email,
      audience: "requester",
      lang: "th",
    });
  });
});

describe("nobody is told about their own action", () => {
  it("the agent who replied is not mailed their own reply", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "comment.requester_replied",
      ctx({ actorId: ASSIGNEE.id }),
      fakeDb(),
    );
    expect(recipients).toHaveLength(0);
  });

  it("the requester who replied is not mailed their own reply", async () => {
    const { recipients, reason } = await emailRecipients.forEvent(
      "ticket.pending",
      ctx({ actorId: REQUESTER.id }),
      fakeDb(),
    );
    expect(recipients).toHaveLength(0);
    expect(reason).toBe("actor_is_only_recipient");
  });

  // An admin acting on someone else's behalf is a third party, so both sides
  // still hear about it — this is the case the "no self-notification" rule must
  // not swallow.
  it("an admin acting for someone else does not suppress the requester's mail", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "ticket.pending",
      ctx({ actorId: 3 }),
      fakeDb(),
    );
    expect(recipients.map((r) => r.userId)).toEqual([REQUESTER.id]);
  });
});

describe("the unassigned queue", () => {
  it("routes to the category's team when nobody owns the ticket", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "queue.ticket_unassigned",
      ctx({ assigneeId: null }),
      fakeDb(),
    );
    expect(recipients.map((r) => r.userId).sort()).toEqual([
      ASSIGNEE.id,
      QUEUE_MATE.id,
    ]);
  });

  // A category is global but a team belongs to a tenant, so the two can point
  // at different customers. Mailing across that line would be a tenant leak.
  it("never reaches a team member from another tenant", async () => {
    const { recipients } = await emailRecipients.forEvent(
      "queue.ticket_unassigned",
      ctx({ assigneeId: null }),
      fakeDb(),
    );
    expect(recipients.map((r) => r.userId)).not.toContain(OTHER_TENANT.id);
  });

  // The product decision: a category with no default team mails nobody, and the
  // reason is what makes that visible in the Activity log instead of silent.
  it("suppresses with a reason when the category has no team", async () => {
    const { recipients, reason } = await emailRecipients.forEvent(
      "queue.ticket_unassigned",
      ctx({ assigneeId: null }),
      fakeDb({ defaultTeamId: null }),
    );
    expect(recipients).toHaveLength(0);
    expect(reason).toBe("no_assignee_and_no_queue_team");
  });
});

describe("unreachable recipients", () => {
  it("skips a requester with no usable address instead of throwing", async () => {
    const noEmail = { ...REQUESTER, email: "" };
    const { recipients, reason } = await emailRecipients.forEvent(
      "ticket.created",
      ctx(),
      fakeDb({ users: [noEmail, ASSIGNEE] }),
    );
    expect(recipients).toHaveLength(0);
    expect(reason).toBe("recipient_inactive_or_unreachable");
  });

  it("skips a deactivated assignee", async () => {
    const gone = { ...ASSIGNEE, isActive: false };
    const { recipients } = await emailRecipients.forEvent(
      "ticket.sla_breach",
      ctx(),
      fakeDb({ users: [REQUESTER, gone] }),
    );
    expect(recipients).toHaveLength(0);
  });

  it("falls back to the mail default when a language is unrecognised", async () => {
    const odd = { ...REQUESTER, language: "kl" };
    const { recipients } = await emailRecipients.forEvent(
      "ticket.created",
      ctx(),
      fakeDb({ users: [odd, ASSIGNEE] }),
    );
    expect(recipients[0].lang).toBe("th");
  });
});
