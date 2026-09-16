"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ChevronRight, Pencil } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-error";
import { isInternalThread } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { isConversationClosed, STATUS_TRANSITIONS } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";
import { TOUCH_HEIGHT } from "@/components/ui/touch";
import { mayEditOwnWording } from "@/lib/ticket-editable";
import { EditTicketModal } from "./edit-ticket-modal";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { MessageAttachments } from "@/features/attachments/components/message-attachments";
import { Composer } from "./composer";
import { PropertiesRail } from "./properties-rail";
import { CancelTicketDialog } from "./cancel-ticket-dialog";
import { RejectClosureDialog } from "./reject-closure-dialog";
import { ResolutionDialog } from "./resolution-dialog";
import { SlaBadge } from "./sla-badge";
import { useAssessSla } from "../use-sla";
import { toneForName } from "../data";
import { markRead } from "../api";
import type { Comment, CommentSendStatus } from "../schemas";
import {
  useCommentStream,
  useComments,
  useCreateComment,
  useRemoveFailedComment,
  useTicket,
  useConfirmClosure,
  useRejectClosure,
  useUpdateTicketStatus,
} from "../queries";

const localeOf = (lang: string) => (lang === "th" ? "th-TH" : "en-US");

const formatTime = (iso: string, lang: string) =>
  new Date(iso).toLocaleTimeString(localeOf(lang), {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatOpened = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(localeOf(lang), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function MessageBubble({
  author,
  tone,
  role,
  time,
  children,
  internal,
  fromAgent,
  grouped,
  status,
  receipt,
  onRetry,
}: {
  author: string;
  tone?: "blue" | "green" | "pink" | "red";
  role: string;
  time: string;
  children: React.ReactNode;
  internal?: boolean;
  /** Agent-side message → right-aligned + tinted, like a chat app. */
  fromAgent?: boolean;
  /** Consecutive message from the same author → hide avatar + header, tighten. */
  grouped?: boolean;
  /** Send state for the caller's own optimistic message (sending / failed). */
  status?: CommentSendStatus;
  /** Read receipt for the caller's own last delivered message (sent / read). */
  receipt?: "sent" | "read" | null;
  /** Resend a failed message. */
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  // Chat-style bubbles: agent on the right (green accent), requester on the
  // left (white); internal notes keep their amber regardless of side.
  const bubble = internal
    ? "border-warn-edge bg-warn-tint"
    : fromAgent
      ? "border-accent-line bg-accent-soft"
      : "border-line bg-white";
  return (
    <div
      className={cn(
        "flex gap-3 first:mt-0",
        grouped ? "mt-1" : "mt-4",
        fromAgent && "flex-row-reverse",
      )}
    >
      {grouped ? (
        <div className="w-8 flex-none" aria-hidden />
      ) : (
        <Avatar name={author} tone={tone} size={32} className="flex-none" />
      )}
      <div
        className={cn(
          "max-w-[82%] rounded-lg border px-4 py-3.5",
          bubble,
        )}
      >
        {grouped ? null : (
          <div
            className={cn(
              "mb-1.5 flex items-baseline gap-2",
              fromAgent && "flex-row-reverse",
            )}
          >
            <span className="text-control font-semibold text-ink">{author}</span>
            {internal ? (
              <span className="rounded-tile bg-warn-bg px-2 py-0.5 text-eyebrow font-bold tracking-eyebrow text-warn">
                {t("detail.internalNote")}
              </span>
            ) : null}
            <span
              className={`text-caption ${internal ? "text-[#b8834a]" : "text-faint"}`}
            >
              {internal ? time : `${role} · ${time}`}
            </span>
          </div>
        )}
        {children}
        {status === "sending" ? (
          <div className="mt-1 text-right text-meta text-faint">
            {t("chat.sending")}
          </div>
        ) : status === "failed" ? (
          <div className="mt-1 flex items-center justify-end gap-1.5 text-meta text-danger">
            <span>{t("chat.failed")}</span>
            <button
              type="button"
              onClick={onRetry}
              className="font-semibold underline hover:no-underline"
            >
              {t("chat.retry")}
            </button>
          </div>
        ) : receipt ? (
          <div
            className={cn(
              "mt-1 text-right text-meta",
              receipt === "read" ? "text-accent" : "text-faint",
            )}
          >
            {receipt === "read" ? `✓✓ ${t("chat.read")}` : `✓ ${t("chat.sent")}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Three softly bouncing dots for the "is typing…" indicator. */
function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function TicketDetailView({ id }: { id: number }) {
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const statusMutation = useUpdateTicketStatus();
  const confirmClosure = useConfirmClosure();
  const rejectClosure = useRejectClosure();
  // One flag for both, so neither button can be pressed while the other is
  // mid-flight — they move the same ticket in opposite directions.
  const closureBusy = confirmClosure.isPending || rejectClosure.isPending;
  const [rejecting, setRejecting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  /**
   * Whether the properties fold-out is open. Below `lg` only — from `lg` up the
   * rail is the right-hand column and this state is not consulted.
   *
   * Closed to begin with: on a phone the thread now fills the screen, and what
   * somebody opens a ticket for is the conversation.
   */
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  // "Done — ask requester" asks what was done before it patches, so the button
  // opens this rather than firing the mutation. Holds the error too: the dialog
  // stays open on a failure with the typed text intact, instead of closing and
  // losing what the agent wrote.
  const [resolving, setResolving] = React.useState(false);
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const commentsQuery = useComments(id);
  const createComment = useCreateComment(id);
  const removeFailed = useRemoveFailedComment(id);
  const { typingNames, reads } = useCommentStream(id); // live comments/typing/reads
  const assess = useAssessSla();

  // Resend a message that failed to post: drop the failed entry, then re-send
  // (which creates a fresh optimistic entry).
  const retryMessage = (msg: {
    clientId?: string;
    body: string;
    internal: boolean;
  }) => {
    if (msg.clientId) removeFailed(msg.clientId);
    createComment.mutate({ body: msg.body, internal: msg.internal });
  };

  // Unread tracking + auto-scroll. We only follow the conversation to the bottom
  // when the reader is already there (or just sent a message); otherwise incoming
  // messages accrue as "unread" and surface via a divider + a jump-to-latest pill,
  // so scrolling back through history isn't yanked away.
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const commentsRef = React.useRef<Comment[]>([]);
  const seenRef = React.useRef(0); // # of comments the reader has seen
  const atBottomRef = React.useRef(true);
  const initRef = React.useRef(false);
  const lastSentReadRef = React.useRef(0);
  const [unread, setUnread] = React.useState(0);
  const [firstUnreadKey, setFirstUnreadKey] = React.useState<string | null>(null);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior) => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  // Tell the server we've read up to the newest real (server-assigned) comment,
  // so the other participant's messages flip to "read". Only advances forward.
  const markReadLatest = React.useCallback(() => {
    let latestId = 0;
    for (const c of commentsRef.current) if (c.id > latestId) latestId = c.id;
    if (latestId > lastSentReadRef.current) {
      lastSentReadRef.current = latestId;
      void markRead(id, latestId);
    }
  }, [id]);

  const markSeen = React.useCallback(() => {
    seenRef.current = commentsRef.current.length;
    setUnread(0);
    setFirstUnreadKey(null);
    markReadLatest();
  }, [markReadLatest]);

  const jumpToLatest = React.useCallback(() => {
    atBottomRef.current = true;
    markSeen();
    scrollToBottom("smooth");
  }, [markSeen, scrollToBottom]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    if (nearBottom) markSeen();
  }, [markSeen]);

  const commentsData = commentsQuery.data;
  const commentsLoaded = commentsQuery.isSuccess;
  React.useEffect(() => {
    if (!commentsLoaded) return;
    const comments = commentsData ?? [];
    const total = comments.length;
    // First successful load: everything on screen counts as already read.
    if (!initRef.current) {
      initRef.current = true;
      seenRef.current = total;
      scrollToBottom("auto");
      markReadLatest();
      return;
    }
    const last = comments[total - 1];
    const lastIsOwn = !!last && last.author.id === user?.id;
    if (atBottomRef.current || lastIsOwn) {
      seenRef.current = total;
      setUnread(0);
      setFirstUnreadKey(null);
      scrollToBottom("smooth");
      markReadLatest();
    } else if (total > seenRef.current) {
      setUnread(total - seenRef.current);
      const firstUnseen = comments[seenRef.current];
      if (firstUnseen) {
        const key = firstUnseen.clientId ?? `c${firstUnseen.id}`;
        setFirstUnreadKey((cur) => cur ?? key);
      }
    }
  }, [commentsData, commentsLoaded, user?.id, scrollToBottom, markReadLatest]);

  if (isLoading) {
    return <LoadingRow label={t("detail.loading", { id })} />;
  }
  if (isError || !ticket) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        message={notFound ? t("detail.notFound", { id }) : t("detail.loadError")}
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }

  /**
   * Working this ticket: the desk's "Done" button, and the internal-note tab on
   * the composer. Both are `ticket:write` on the API — the status route by
   * middleware, the note by `commentService.create` — so both are that
   * permission here, not the role list this used to carry.
   */
  const canWrite = hasPermission(user, "ticket:write");
  // "Done, over to the requester" — the move that finishes the desk's part.
  const canResolve =
    canWrite && (STATUS_TRANSITIONS[ticket.status] ?? []).includes("pending");
  /**
   * The requester's half: this ticket is mine, and it is waiting on me.
   *
   * Keyed on being the requester of this row rather than on a role, exactly as
   * the API is — an admin who raised their own ticket answers it the same way
   * anyone else does, and an admin who did not raise it uses the status menu.
   */
  const awaitingMyConfirmation =
    user != null &&
    ticket.requesterId === user.id &&
    ticket.status === "pending";
  /**
   * The requester withdrawing a ticket the desk has not moved yet.
   *
   * Same two facts the API checks (`requireOwnUntouchedTicket`): this row is
   * mine, and its status is still `new`. Assignment is not a move, so a ticket
   * with somebody's name on it is still cancellable — exactly as it is still
   * editable, and for the same reason.
   */
  const canCancel =
    user != null && ticket.requesterId === user.id && ticket.status === "new";
  /**
   * The public thread is over, so the composer is not offered. Mirrors
   * `isConversationClosed` on the API, which refuses the post regardless — this
   * is so nobody types a paragraph into a thread nobody is reading.
   *
   * Notes are a separate question: staff keep theirs on an ended ticket, which
   * is why this gates the composer's PUBLIC half rather than the whole box.
   */
  const conversationClosed = isConversationClosed(ticket.status);
  const comments = commentsQuery.data ?? [];
  commentsRef.current = comments; // latest snapshot for the scroll/jump handlers

  // The requester's opening description + every comment, as one chat timeline.
  const messages = [
    {
      key: "desc",
      id: 0,
      authorId: undefined as number | undefined,
      author: ticket.requester,
      tone: "red" as const,
      roleKey: "user",
      time: formatTime(ticket.createdAt, lang),
      body: ticket.description,
      internal: false,
      fromAgent: false,
      sendStatus: undefined as CommentSendStatus | undefined,
      clientId: undefined as string | undefined,
      // The opening message is the ticket description, which carries no files of
      // its own — ticket-level attachments live in the sidebar.
      attachments: [] as Comment["attachments"],
    },
    ...comments.map((c) => ({
      key: c.clientId ?? `c${c.id}`,
      id: c.id,
      authorId: c.author.id as number | undefined,
      author: c.author.name,
      tone: toneForName(c.author.name),
      roleKey: c.author.role,
      time: formatTime(c.createdAt, lang),
      body: c.body,
      attachments: c.attachments ?? [],
      internal: c.internal,
      fromAgent: c.author.role !== "user",
      sendStatus: c.sendStatus,
      clientId: c.clientId,
    })),
  ];

  // Read receipt: the newest of my own delivered (server-acked) messages that
  // another participant has read shows "read"; otherwise my newest own shows
  // "sent". Only one indicator, on my last own message (chat-app convention).
  const readBy = Math.max(
    0,
    ...Object.entries(reads)
      .filter(([uid]) => Number(uid) !== user?.id)
      .map(([, v]) => v),
  );
  let lastOwnKey: string | null = null;
  let lastOwnId = 0;
  for (const m of messages) {
    if (m.authorId === user?.id && m.id > 0 && !m.sendStatus) {
      lastOwnKey = m.key;
      lastOwnId = m.id;
    }
  }
  const lastOwnReceipt: "sent" | "read" | null = lastOwnKey
    ? readBy >= lastOwnId
      ? "read"
      : "sent"
    : null;

  return (
    /* `overflow-hidden` at every width, not just `lg`.

       Below `lg` this element used to be the page's scroller, so the whole
       document grew with the conversation: header, thread and composer scrolled
       together and the composer sat at the bottom of a 50-message page rather
       than on screen. The thread now owns the only scrollbar at every width — see
       the chat pane below. */
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* One header across the full width. It used to sit inside the thread
          column, which squeezed the title and the badge row into 1fr while the
          rail stood empty beside them. */}
      <header className="flex-none border-b border-line bg-panel px-5 py-4 sm:px-7">
        {/* `flex-wrap` so the SLA badge below can drop to a line of its own on a
            narrow screen instead of squeezing the breadcrumb or widening the
            header. `gap-y-2` gives it room when it does. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-dense text-faint">
          <Link href="/tickets" className="hover:text-muted">
            {t("detail.tickets")}
          </Link>
          <span>›</span>
          <span className="font-mono font-medium">#{ticket.id}</span>
          {/* BELOW md only. On a phone the box sat a row and a half from the
              number whose clock it describes, so here it goes right after it.
              From `md` up the copy in the title row below takes over — the
              desktop layout is the one it always had.

              Rendered twice rather than moved, which is safe here and was not
              for the notification bell: `SlaBadge` is presentational, holds no
              state and opens no connection, so a second instance costs a span.
              Moving one element instead is not possible — the two positions are
              in different flex parents, and `order` cannot cross them. */}
          <span className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1 text-dense md:hidden">
            <span className="text-caption font-semibold text-muted">SLA</span>
            <SlaBadge sla={assess(ticket)} />
          </span>
          {canResolve || awaitingMyConfirmation || canCancel ? (
            // flex-wrap: a requester answering their own pending ticket gets two
            // buttons here on top of whatever the desk is offered, and the strip
            // must wrap rather than widen the header past the viewport.
            <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {canResolve ? (
                <button
                  type="button"
                  onClick={() => {
                    setResolveError(null);
                    setResolving(true);
                  }}
                  disabled={statusMutation.isPending}
                  className="rounded-md border border-[#e2caa5] bg-[#efe0cd] px-3 py-1.5 text-body font-semibold text-brand-hover hover:bg-[#e7d3b8] disabled:opacity-50"
                >
                  {statusMutation.isPending
                    ? t("detail.saving")
                    : t("detail.markResolved")}
                </button>
              ) : null}
              {awaitingMyConfirmation ? (
                <>
                  <button
                    type="button"
                    onClick={() => confirmClosure.mutate(ticket.id)}
                    disabled={closureBusy}
                    className="rounded-md border border-accent-line bg-accent-soft px-3 py-1.5 text-body font-semibold text-brand-hover hover:bg-[#d7ebe0] disabled:opacity-50"
                  >
                    {closureBusy ? t("detail.saving") : t("closure.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    disabled={closureBusy}
                    className="rounded-md border border-line bg-white px-3 py-1.5 text-body font-semibold text-muted hover:text-ink disabled:opacity-50"
                  >
                    {t("closure.reject")}
                  </button>
                </>
              ) : null}
              {/* Withdrawing it. Quiet styling on purpose: this is the way out,
                  not something to nudge anybody towards, and it sits last. */}
              {canCancel ? (
                <button
                  type="button"
                  onClick={() => setCancelling(true)}
                  className="rounded-md border border-line bg-white px-3 py-1.5 text-body font-semibold text-muted hover:text-danger"
                >
                  {t("cancelTicket.action")}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        {/* Title and badges share one row now that the header has the whole
            width to spend. `min-w-0 break-words` on the heading is what keeps a
            200-character subject — the longest the API accepts, and it may have
            no spaces in it — from widening the document instead of wrapping. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-subject font-bold tracking-heading text-ink">
            {ticket.subject}
          </h1>
          {/* Offered only while the edit would actually be accepted — the same
              two conditions the API applies, mirrored in `mayEditOwnWording`.
              The API decides again inside the write, so this is an affordance
              and not the guard; hiding a button has never been enforcement. */}
          {mayEditOwnWording({
            status: ticket.status,
            requesterId: ticket.requesterId,
            viewerId: user?.id,
            comments: commentsQuery.data ?? [],
          }) ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-dense font-medium text-muted hover:bg-app",
                TOUCH_HEIGHT,
              )}
            >
              <Pencil size={13} strokeWidth={2} />
              {t("editTicket.action")}
            </button>
          ) : null}
          <StatusBadge status={ticket.displayStatus} />
          <span className="inline-flex items-center rounded-full border border-line bg-white px-2.5 py-[3px]">
            <PriorityIndicator priority={ticket.priority} />
          </span>
          <span className="text-body text-muted">
            {ticket.category} · {t("detail.opened")}{" "}
            {formatOpened(ticket.createdAt, lang)} {t("detail.by")}{" "}
            <strong className="text-ink">{ticket.requester}</strong>
          </span>
          {/* FROM md up — the position this box has always had on a desktop,
              pushed to the far right of the title row. The mobile copy in the
              breadcrumb above is hidden at this width, so exactly one is ever
              on screen. */}
          <span className="ml-auto hidden items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1.5 md:inline-flex">
            <span className="text-caption font-semibold text-muted">SLA</span>
            <SlaBadge sla={assess(ticket)} />
          </span>
        </div>
      </header>

      {/* A flex COLUMN below `lg`, the two-column grid from `lg` up.

          It was a single-column grid below `lg`, which made the thread and the
          rail two auto-sized rows: the thread grew with the conversation and the
          page scrolled to reach either. As a flex column the thread can take
          `flex-1` of a bounded height and scroll inside itself, which is what
          lets the composer stay put. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[1fr_312px]">
        {/* thread column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line lg:border-r">
          {/* The conversation, and the only thing on this page that scrolls.

              `overflow-y-auto` is unprefixed now. It used to be `lg:` only, so
              below `lg` nothing here scrolled at all and the whole document grew
              with the thread instead.

              `min-h-0` is belt-and-braces rather than the fix: `overflow-y-auto`
              already zeroes a flex child's automatic minimum (that minimum only
              applies while overflow is `visible`). It is written out because the
              day somebody changes this back to `overflow-visible` for a dropdown
              that is being clipped, the column silently stops being able to
              shrink and the composer starts collapsing again — and this is the
              line that says why it must not.

              What the messages themselves must NOT have is a floor: the inner
              list is content-sized on purpose, so it overflows this box and this
              box scrolls, rather than the two of them pushing the composer. */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="chat-scroll"
            className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 sm:p-7"
          >
            <div className="flex flex-col">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                // Group consecutive messages from the same author on the same side.
                const grouped =
                  !!prev &&
                  prev.author === m.author &&
                  prev.internal === m.internal &&
                  prev.fromAgent === m.fromAgent;
                const bubble = (
                  <MessageBubble
                    key={m.key}
                    author={m.author}
                    tone={m.tone}
                    role={t(`role.${m.roleKey}`)}
                    time={m.time}
                    internal={m.internal}
                    fromAgent={m.fromAgent}
                    grouped={grouped}
                    status={m.sendStatus}
                    receipt={m.key === lastOwnKey ? lastOwnReceipt : null}
                    onRetry={
                      m.sendStatus === "failed"
                        ? () =>
                            retryMessage({
                              clientId: m.clientId,
                              body: m.body,
                              internal: m.internal,
                            })
                        : undefined
                    }
                  >
                    <p
                      className={cn(
                        // `break-words` beside `whitespace-pre-wrap`: the latter
                        // wraps at spaces, and a pasted URL or stack frame has
                        // none — it ran straight out of the bubble's 82% instead
                        // of wrapping inside it. The two together keep every line
                        // in the bubble whatever is in it.
                        "whitespace-pre-wrap break-words text-lead leading-relaxed",
                        m.internal ? "text-[#57430f]" : "text-strong",
                      )}
                    >
                      {m.body}
                    </p>
                    {/* Files sent with this message, drawn in the bubble. An
                        optimistic message has none yet — they appear when the
                        upload that follows the post lands and the thread
                        refetches. */}
                    <MessageAttachments
                      attachments={m.attachments ?? []}
                      className="mt-2"
                    />
                  </MessageBubble>
                );
                if (m.key === firstUnreadKey) {
                  return (
                    <React.Fragment key={`unread-${m.key}`}>
                      <div className="my-3 flex items-center gap-2" role="separator">
                        <span className="h-px flex-1 bg-danger-edge" />
                        <span className="text-meta font-bold uppercase tracking-eyebrow text-danger">
                          {t("chat.unreadDivider")}
                        </span>
                        <span className="h-px flex-1 bg-danger-edge" />
                      </div>
                      {bubble}
                    </React.Fragment>
                  );
                }
                return bubble;
              })}
            </div>

            {commentsQuery.isLoading ? (
              <LoadingRow label={t("detail.loadingConversation")} />
            ) : null}

            {typingNames.length > 0 ? (
              <div
                className="flex items-center gap-2 px-1 text-body text-muted"
                aria-live="polite"
              >
                <TypingDots />
                <span>
                  {typingNames.length === 1
                    ? t("chat.typingOne", { name: typingNames[0] })
                    : t("chat.typingMany")}
                </span>
              </div>
            ) : null}

            {unread > 0 ? (
              <div className="pointer-events-none sticky bottom-2 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-dense font-semibold text-white shadow-[0_2px_12px_rgba(15,23,42,.18)] hover:bg-brand-hover"
                >
                  <ArrowDown size={13} strokeWidth={2.5} />
                  {t("chat.jumpNew", { count: String(unread) })}
                </button>
              </div>
            ) : null}

            {/* The scroll anchor stays the LAST thing in the scroller, because
                `scrollToBottom` works by scrolling it into view. */}
            <div ref={bottomRef} aria-hidden />
          </div>

          {/* The composer, a SIBLING of the conversation rather than the last
              thing inside it.

              It used to sit inside the scroller, which gave it two faults at
              once: flexbox squeezed it (see `min-h-0` above), and whatever height
              survived scrolled away with the messages, so on a long thread you
              had to scroll to the bottom to reach the thing you were trying to
              type into. `flex-none` is the other half of the rule — it takes the
              height its own content asks for and neither stretches nor shrinks,
              whether the conversation has fifty messages or none.

              Deliberately NOT `position: fixed`: this page has a properties rail
              beside it and a header above it, and a viewport-pinned bar would lie
              across both. Pinned to the bottom of the thread column is the same
              effect without the collision. */}
          <div className="flex-none px-5 pb-5 sm:px-7 sm:pb-7">
            {/* The conversation is over, and there is nothing left this viewer
                may write. A line saying so, not an empty space: a composer that
                simply vanishes reads as a page that failed to load, and the
                sentence is also where the way back is named. `flex-none` above
                means this shorter box is simply shorter — it does not let the
                conversation grow into the room it gives up.

                Staff still get the composer here — `internalOnly` collapses it
                to the note tab — because notes stay open on an ended ticket.
                What decides between the two is whether the viewer has anything
                left to say, not the ticket's status alone. */}
            {conversationClosed && !canWrite ? (
              <div className="rounded-lg border border-dashed border-line bg-wash px-4 py-3 text-body text-subtle">
                {t(
                  ticket.status === "cancelled"
                    ? "composer.lockedCancelled"
                    : "composer.lockedClosed",
                )}
              </div>
            ) : (
              <Composer
                ticketId={ticket.id}
                requester={ticket.requester}
                requesterEmail={ticket.requesterEmail}
                canAddNote={canWrite}
                // Once the public thread is shut, a note is the only thing left
                // to write — the same shape a staff-raised ticket has from the
                // start, and the composer already knows how to be that.
                internalOnly={
                  conversationClosed || isInternalThread(ticket.requesterRole)
                }
              />
            )}
          </div>
        </div>

        {/* Properties. From `lg` up it is the right-hand column and always open.
            Below `lg` it moves ABOVE the conversation (`order-first`) and folds
            away behind its own heading, because the thread now fills the screen
            and nothing scrolls past it to reach this. Collapsed by default: the
            reason to open a ticket on a phone is to read and answer it.

            `order` moves it visually only, so the conversation still comes first
            in the DOM for a screen reader and for tab order. */}
        <div className="order-first flex-none overflow-hidden border-b border-line lg:order-none lg:overflow-y-auto lg:border-b-0">
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            aria-expanded={detailsOpen}
            aria-controls="ticket-properties"
            className={cn(
              "flex w-full items-center gap-2 px-5 text-left text-dense font-semibold text-muted hover:text-ink sm:px-7 lg:hidden",
              TOUCH_HEIGHT,
            )}
          >
            <ChevronRight
              size={14}
              strokeWidth={2.5}
              className={cn("transition-transform", detailsOpen && "rotate-90")}
            />
            {/* Deliberately NOT "Properties": the rail's own first section is
                already called that, and a fold-out heading repeating its first
                child reads as a bug. It also keeps `getByText("Properties")` in
                the layout spec matching one element rather than two, one of
                which is hidden at desktop width. */}
            {t("detail.detailsToggle")}
          </button>
          {/* Bounded below `lg` so a long rail cannot take the conversation's
              room; from `lg` up the column scrolls as it always did. */}
          <div
            id="ticket-properties"
            className={cn(
              "max-h-[50dvh] overflow-y-auto lg:max-h-none lg:overflow-visible lg:block",
              detailsOpen ? "block" : "hidden",
            )}
          >
            <PropertiesRail ticket={ticket} />
          </div>
        </div>
      </div>

      {rejecting ? (
        <RejectClosureDialog
          ticketId={ticket.id}
          onClose={() => setRejecting(false)}
          onRejected={() => setRejecting(false)}
        />
      ) : null}

      {cancelling ? (
        <CancelTicketDialog
          ticketId={ticket.id}
          onClose={() => setCancelling(false)}
          onCancelled={() => setCancelling(false)}
        />
      ) : null}

      {resolving ? (
        <ResolutionDialog
          target="pending"
          busy={statusMutation.isPending}
          error={resolveError}
          onCancel={() => setResolving(false)}
          onSubmit={(resolution) => {
            setResolveError(null);
            statusMutation.mutate(
              { id: ticket.id, status: "pending", resolution },
              {
                onSuccess: () => setResolving(false),
                onError: (err) =>
                  setResolveError(apiErrorMessage(err, t, "status.updateError")),
              },
            );
          }}
        />
      ) : null}

      {/* Mounted rather than conditionally created, so its own close effect can
          reset the draft from the ticket. All three dialogs portal to <body>, so
          where they sit in this tree is a readability choice, not a layout one —
          out of the scroller, where they were only ever confusing. */}
      <EditTicketModal
        ticket={ticket}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}
