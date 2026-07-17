"use client";

import * as React from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
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
import {
  useCommentStream,
  useComments,
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
      </div>
    </div>
  );
}

export function TicketDetailView({ id }: { id: number }) {
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const statusMutation = useUpdateTicketStatus();
  const commentsQuery = useComments(id);
  useCommentStream(id); // live updates over SSE (replaces polling)

  // Auto-scroll to the newest message. Depends on the comment count, so it fires
  // on load and whenever polling brings a new message in — but not on every
  // re-render.
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const commentCount = commentsQuery.data?.length ?? 0;
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [commentCount]);

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
    },
    ...comments.map((c) => ({
      key: `c${c.id}`,
      author: c.author.name,
      tone: toneForName(c.author.name),
      roleKey: c.author.role,
      time: formatTime(c.createdAt, lang),
      body: c.body,
      internal: c.internal,
      fromAgent: c.author.role !== "requester",
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

        <div className="flex flex-1 flex-col gap-4 p-5 sm:p-7 lg:overflow-y-auto">
          <div className="flex flex-col">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              // Group consecutive messages from the same author on the same side.
              const grouped =
                !!prev &&
                prev.author === m.author &&
                prev.internal === m.internal &&
                prev.fromAgent === m.fromAgent;
              return (
                <MessageBubble
                  key={m.key}
                  author={m.author}
                  tone={m.tone}
                  role={t(`role.${m.roleKey}`)}
                  time={m.time}
                  internal={m.internal}
                  fromAgent={m.fromAgent}
                  grouped={grouped}
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
            })}
          </div>

          {commentsQuery.isLoading ? (
            <LoadingRow label={t("detail.loadingConversation")} />
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
