"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, Clock } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { STATUS_TRANSITIONS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { Composer } from "./composer";
import { PropertiesRail } from "./properties-rail";
import { slaColor, toneForName } from "../data";
import type { Comment, CommentSendStatus } from "../schemas";
import {
  useCommentStream,
  useComments,
  useCreateComment,
  useRemoveFailedComment,
  useTicket,
  useUpdateTicketStatus,
} from "../queries";

const WRITE_ROLES = ["admin", "manager", "agent"];

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
  /** Resend a failed message. */
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  // Chat-style bubbles: agent on the right (green accent), requester on the
  // left (white); internal notes keep their amber regardless of side.
  const bubble = internal
    ? "border-[#fde68a] bg-[#fffbeb]"
    : fromAgent
      ? "border-[#b4dcc3] bg-[#e4f2ea]"
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
            <span className="text-[13px] font-semibold text-ink">{author}</span>
            {internal ? (
              <span className="rounded-[9px] bg-[#fef3c7] px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-[#b45309]">
                {t("detail.internalNote")}
              </span>
            ) : null}
            <span
              className={`text-[11.5px] ${internal ? "text-[#b8834a]" : "text-faint"}`}
            >
              {internal ? time : `${role} · ${time}`}
            </span>
          </div>
        )}
        {children}
        {status === "sending" ? (
          <div className="mt-1 text-right text-[11px] text-faint">
            {t("chat.sending")}
          </div>
        ) : status === "failed" ? (
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-[#dc2626]">
            <span>{t("chat.failed")}</span>
            <button
              type="button"
              onClick={onRetry}
              className="font-semibold underline hover:no-underline"
            >
              {t("chat.retry")}
            </button>
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
  const commentsQuery = useComments(id);
  const createComment = useCreateComment(id);
  const removeFailed = useRemoveFailedComment(id);
  const { typingNames } = useCommentStream(id); // live comments + typing over SSE

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
  const [unread, setUnread] = React.useState(0);
  const [firstUnreadKey, setFirstUnreadKey] = React.useState<string | null>(null);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior) => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const markSeen = React.useCallback(() => {
    seenRef.current = commentsRef.current.length;
    setUnread(0);
    setFirstUnreadKey(null);
  }, []);

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
      return;
    }
    const last = comments[total - 1];
    const lastIsOwn = !!last && last.author.id === user?.id;
    if (atBottomRef.current || lastIsOwn) {
      seenRef.current = total;
      setUnread(0);
      setFirstUnreadKey(null);
      scrollToBottom("smooth");
    } else if (total > seenRef.current) {
      setUnread(total - seenRef.current);
      const firstUnseen = comments[seenRef.current];
      if (firstUnseen) {
        const key = firstUnseen.clientId ?? `c${firstUnseen.id}`;
        setFirstUnreadKey((cur) => cur ?? key);
      }
    }
  }, [commentsData, commentsLoaded, user?.id, scrollToBottom]);

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

  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;
  const canResolve =
    canWrite && (STATUS_TRANSITIONS[ticket.status] ?? []).includes("resolved");
  const comments = commentsQuery.data ?? [];
  commentsRef.current = comments; // latest snapshot for the scroll/jump handlers

  // The requester's opening description + every comment, as one chat timeline.
  const messages = [
    {
      key: "desc",
      author: ticket.requester,
      tone: "red" as const,
      roleKey: "requester",
      time: formatTime(ticket.createdAt, lang),
      body: ticket.description,
      internal: false,
      fromAgent: false,
      sendStatus: undefined as CommentSendStatus | undefined,
      clientId: undefined as string | undefined,
    },
    ...comments.map((c) => ({
      key: c.clientId ?? `c${c.id}`,
      author: c.author.name,
      tone: toneForName(c.author.name),
      roleKey: c.author.role,
      time: formatTime(c.createdAt, lang),
      body: c.body,
      internal: c.internal,
      fromAgent: c.author.role !== "requester",
      sendStatus: c.sendStatus,
      clientId: c.clientId,
    })),
  ];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_312px] lg:overflow-hidden">
      {/* thread column */}
      <div className="flex min-w-0 flex-col border-line lg:overflow-hidden lg:border-r">
        <header className="border-b border-line bg-panel px-5 py-4 sm:px-7">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-faint">
            <Link href="/tickets" className="hover:text-muted">
              {t("detail.tickets")}
            </Link>
            <span>›</span>
            <span className="font-mono font-medium">#{ticket.id}</span>
            {canResolve ? (
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    statusMutation.mutate({ id: ticket.id, status: "resolved" })
                  }
                  disabled={statusMutation.isPending}
                  className="rounded-md border border-[#e2caa5] bg-[#efe0cd] px-3 py-1.5 text-[12.5px] font-semibold text-brand-hover hover:bg-[#e7d3b8] disabled:opacity-50"
                >
                  {statusMutation.isPending
                    ? t("detail.saving")
                    : t("detail.markResolved")}
                </button>
              </span>
            ) : null}
          </div>
          <h1 className="text-[19px] font-bold tracking-[-0.01em] text-ink">
            {ticket.subject}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <StatusBadge status={ticket.status} />
            <span className="inline-flex items-center rounded-full border border-line bg-white px-2.5 py-[3px]">
              <PriorityIndicator priority={ticket.priority} />
            </span>
            <span className="text-[12.5px] text-muted">
              {ticket.category} · {t("detail.opened")}{" "}
              {formatOpened(ticket.createdAt, lang)} {t("detail.by")}{" "}
              <strong className="text-ink">{ticket.requester}</strong>
            </span>
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 font-mono text-[12px] font-semibold"
              style={{
                color: slaColor[ticket.slaState],
                borderColor: `${slaColor[ticket.slaState]}55`,
              }}
            >
              <Clock size={12} strokeWidth={2} />
              SLA {ticket.slaDue}
            </span>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-testid="chat-scroll"
          className="relative flex flex-1 flex-col gap-4 p-5 sm:p-7 lg:overflow-y-auto"
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
                      "whitespace-pre-wrap text-[13.5px] leading-relaxed",
                      m.internal ? "text-[#57430f]" : "text-[#334155]",
                    )}
                  >
                    {m.body}
                  </p>
                </MessageBubble>
              );
              if (m.key === firstUnreadKey) {
                return (
                  <React.Fragment key={`unread-${m.key}`}>
                    <div className="my-3 flex items-center gap-2" role="separator">
                      <span className="h-px flex-1 bg-[#fecaca]" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#dc2626]">
                        {t("chat.unreadDivider")}
                      </span>
                      <span className="h-px flex-1 bg-[#fecaca]" />
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
              className="flex items-center gap-2 px-1 text-[12.5px] text-muted"
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
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_12px_rgba(15,23,42,.18)] hover:bg-brand-hover"
              >
                <ArrowDown size={13} strokeWidth={2.5} />
                {t("chat.jumpNew", { count: String(unread) })}
              </button>
            </div>
          ) : null}

          <Composer
            ticketId={ticket.id}
            requester={ticket.requester}
            requesterEmail={ticket.requesterEmail}
            canAddNote={canWrite}
          />
          <div ref={bottomRef} aria-hidden />
        </div>
      </div>

      <div className="border-t border-line lg:overflow-y-auto lg:border-t-0">
        <PropertiesRail ticket={ticket} />
      </div>
    </div>
  );
}
