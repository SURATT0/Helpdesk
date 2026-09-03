import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { DEFAULT_LANG, isLang, type Lang } from "../../shared/i18n";
import type { Audience, EmailEvent } from "./email.events";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * One decided recipient. `audience` travels WITH the address because it is what
 * selects the payload type downstream — deciding it here, once, is what stops a
 * later stage from having to re-derive "is this person the requester?" and
 * getting a different answer.
 */
export type Recipient = {
  userId: number;
  /** Display name, carried so the greeting works for a queue member too. */
  name: string;
  email: string;
  lang: Lang;
  audience: Audience;
};

/** What the caller knows about the ticket at the moment the event happened. */
export type RecipientContext = {
  ticketId: number;
  customerId: number;
  requesterId: number;
  assigneeId: number | null;
  categoryId: number;
  /** Who performed the action. Never mailed about their own action. */
  actorId: number | null;
};

/** Why a resolution produced nobody — recorded on the suppressed outbox row. */
export type NoRecipientReason =
  | "no_assignee_and_no_queue_team"
  | "queue_team_has_no_members_in_tenant"
  | "actor_is_only_recipient"
  | "recipient_inactive_or_unreachable";

export type Resolution =
  | { recipients: Recipient[]; reason?: undefined }
  | { recipients: []; reason: NoRecipientReason };

/**
 * Which events go outward to the requester, and which stay inside the desk.
 *
 * The whole safety property of this feature rests on this table, so it is a
 * table rather than a chain of ifs: every event names its audience once, in one
 * place, and a reader can check the list against the spec by eye.
 */
const AUDIENCE_OF: Record<EmailEvent, Audience> = {
  "ticket.created": "requester",
  "comment.public_reply": "requester",
  "ticket.pending": "requester",
  "ticket.auto_close_reminder": "requester",
  "ticket.closed": "requester",
  "digest.multiple_updates": "requester",

  "ticket.assigned": "staff",
  "comment.requester_replied": "staff",
  "ticket.closure_rejected": "staff",
  "comment.internal_note": "staff",
  "ticket.sla_warning": "staff",
  "ticket.sla_breach": "staff",
  "queue.ticket_unassigned": "staff",
  "queue.requester_replied": "staff",
  "digest.bulk_assigned": "staff",
};

export function audienceOf(event: EmailEvent): Audience {
  return AUDIENCE_OF[event];
}

type UserRow = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  language: Lang | string;
  customerId: number | null;
};

const SELECT_USER = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  language: true,
  customerId: true,
} as const;

/**
 * A user is mailable when the account is still live and the address could
 * plausibly be delivered to. Both are cheap checks that prevent a guaranteed
 * bounce from occupying the retry queue for three attempts.
 */
function mailable(u: UserRow | null | undefined): u is UserRow {
  return Boolean(u && u.isActive && u.email.includes("@"));
}

function toRecipient(u: UserRow, audience: Audience): Recipient {
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    lang: isLang(u.language) ? u.language : DEFAULT_LANG,
    audience,
  };
}

/**
 * Everyone holding the queue for a ticket nobody is assigned to: the members of
 * the team the ticket's CATEGORY routes to by default.
 *
 * Two filters, both load-bearing:
 *
 * 1. `Category.defaultTeamId` is nullable, and per the product decision a
 *    category with no team means nobody is mailed — the caller records a
 *    `suppressed` row naming the category so the gap is visible in the Activity
 *    log rather than silent.
 *
 * 2. Members are narrowed to the TICKET's customer. A category is global while a
 *    team belongs to a tenant, so a category whose default team sits in customer
 *    B would otherwise mail B's staff about A's ticket. Equality with the
 *    ticket's `customerId` is the same predicate `ticketScopeWhere` uses for
 *    customer-bound staff; staff with no customer of their own are deliberately
 *    NOT included, because merely lacking a customer does not grant reach into
 *    every tenant (see `isPlatformWide` — that needs the top role as well).
 */
async function queueTeamFor(
  ctx: RecipientContext,
  db: Db,
): Promise<{ users: UserRow[]; reason?: NoRecipientReason }> {
  const category = await db.category.findUnique({
    where: { id: ctx.categoryId },
    select: { defaultTeamId: true },
  });
  if (category?.defaultTeamId == null) {
    return { users: [], reason: "no_assignee_and_no_queue_team" };
  }
  const users = (await db.user.findMany({
    where: {
      teamId: category.defaultTeamId,
      isActive: true,
      customerId: ctx.customerId,
    },
    select: SELECT_USER,
  })) as UserRow[];
  return users.length > 0
    ? { users }
    : { users: [], reason: "queue_team_has_no_members_in_tenant" };
}

export const emailRecipients = {
  /**
   * Decide who receives mail for one event — BEFORE any email exists.
   *
   * This ordering is the mechanism the spec asks for, and it is the opposite of
   * the tempting one: composing a message and then filtering its recipients
   * means an internal note has already been written into a string that a later
   * bug could deliver. Here the note's recipient list simply never contains the
   * requester, so there is nothing to leak and nothing to filter.
   *
   * Three rules, applied in order:
   *
   *   - the actor is always removed; nobody is told about their own action
   *   - a `requester` event resolves to the requester alone
   *   - a `staff` event resolves to the assignee, falling back to the queue team
   *     when nobody owns the ticket — which is exactly the case (#1046) where a
   *     breach otherwise goes unseen
   *
   * The requester is not a candidate for any staff event under any condition:
   * they are never added to the list, rather than added and then removed.
   */
  async forEvent(
    event: EmailEvent,
    ctx: RecipientContext,
    db: Db = prisma,
  ): Promise<Resolution> {
    const audience = audienceOf(event);

    if (audience === "requester") {
      if (ctx.requesterId === ctx.actorId) {
        return { recipients: [], reason: "actor_is_only_recipient" };
      }
      const user = (await db.user.findUnique({
        where: { id: ctx.requesterId },
        select: SELECT_USER,
      })) as UserRow | null;
      if (!mailable(user)) {
        return { recipients: [], reason: "recipient_inactive_or_unreachable" };
      }
      return { recipients: [toRecipient(user, "requester")] };
    }

    // --- staff -------------------------------------------------------------
    // Queue events are addressed to the queue by definition; the others go to
    // the assignee and only fall back to the queue when there isn't one.
    const isQueueEvent = event.startsWith("queue.");
    let candidates: UserRow[];
    let emptyReason: NoRecipientReason | undefined;

    if (!isQueueEvent && ctx.assigneeId != null) {
      const assignee = (await db.user.findUnique({
        where: { id: ctx.assigneeId },
        select: SELECT_USER,
      })) as UserRow | null;
      candidates = mailable(assignee) ? [assignee] : [];
      if (candidates.length === 0) emptyReason = "recipient_inactive_or_unreachable";
    } else {
      const queue = await queueTeamFor(ctx, db);
      candidates = queue.users;
      emptyReason = queue.reason;
    }

    const recipients = candidates
      .filter((u) => u.id !== ctx.actorId)
      // Belt and braces: the requester is not a staff recipient even if they
      // somehow hold the assignee slot or sit in the queue team. An admin who
      // raised their own ticket reads it in the app; they are not mailed the
      // desk's internal traffic about it.
      .filter((u) => u.id !== ctx.requesterId)
      .filter(mailable)
      .map((u) => toRecipient(u, "staff"));

    if (recipients.length === 0) {
      return {
        recipients: [],
        reason:
          emptyReason ??
          (candidates.length > 0
            ? "actor_is_only_recipient"
            : "recipient_inactive_or_unreachable"),
      };
    }
    return { recipients };
  },
};
