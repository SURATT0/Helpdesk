"use client";

import * as React from "react";
import { Loader2, Mail, MessageSquare, Paperclip, X } from "lucide-react";
import { FIELD_TEXT, FIELD_TEXT_12 } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUploadAttachment } from "@/features/attachments/queries";
import { sendTyping } from "../api";
import { useCreateComment, useSendReply } from "../queries";

const ACCEPT =
  "image/*,.pdf,.csv,.xls,.xlsx,application/pdf,text/csv," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Tab = "chat" | "reply" | "note";

export function Composer({
  ticketId,
  requester,
  requesterEmail,
  canAddNote,
  internalOnly = false,
}: {
  ticketId: number;
  requester: string;
  requesterEmail: string;
  canAddNote: boolean;
  /**
   * This ticket has no external side — staff raised it and staff will close it
   * (see `isInternalThread`). Chat and email have no counterparty, so the note is
   * the only thing left to write, and the server agrees: it stores a comment on
   * such a ticket as a note and refuses the email outright.
   */
  internalOnly?: boolean;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  // Chat is the default: a quick public message posted straight to the thread.
  const [chosenTab, setChosenTab] = React.useState<Tab>("chat");
  const [body, setBody] = React.useState("");
  const [to, setTo] = React.useState(requesterEmail);
  const [files, setFiles] = React.useState<File[]>([]);
  const [sending, setSending] = React.useState(false);
  const [sentInfo, setSentInfo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const createComment = useCreateComment(ticketId);
  const sendReply = useSendReply(ticketId);
  const upload = useUploadAttachment(ticketId);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const lastTypingRef = React.useRef(0);
  const firstName = requester.split(" ")[0];

  // Emit a throttled "typing" ping while the user writes a chat message, so the
  // other participant sees a live indicator. Chat tab only; at most every 2.5s.
  function onBodyChange(value: string) {
    setBody(value);
    if (isChat && value.trim()) {
      const now = Date.now();
      if (now - lastTypingRef.current > 2500) {
        lastTypingRef.current = now;
        void sendTyping(ticketId);
      }
    }
  }

  // On an internal thread the note is the only tab, so which tab is live is not a
  // choice to remember — derived rather than held. That also covers moving from
  // one ticket to another without a remount: the composer keeps its state, and a
  // "chat" left over from the previous ticket would otherwise be the live tab on
  // a ticket that has no chat. Guarded by canAddNote so a viewer who cannot write
  // notes is never left with no composer at all (a requester cannot see a
  // staff-raised ticket, so this is defensive rather than a case that happens).
  const noteOnly = internalOnly && canAddNote;
  const tab: Tab = noteOnly ? "note" : chosenTab;
  const isReply = tab === "reply";
  const isNote = tab === "note";
  const isChat = tab === "chat";

  React.useEffect(() => setTo(requesterEmail), [requesterEmail]);

  function switchTab(next: Tab) {
    setChosenTab(next);
    setSentInfo(null);
    setError(null);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }
  async function uploadFiles() {
    for (const f of files) {
      try {
        await upload.mutateAsync(f);
      } catch {
        /* best-effort — the message is already saved */
      }
    }
  }

  // Chat + Internal note both post a comment (public vs internal). The message
  // posts optimistically — it appears in the thread instantly with a status — so
  // we clear the input right away. A failure surfaces as a "failed · retry"
  // bubble in the thread (see useCreateComment), not as an inline composer error.
  function postComment(internal: boolean) {
    const text = body.trim();
    if (!text) return;
    setError(null);
    const pendingFiles = files;
    createComment.mutate(
      { body: text, internal },
      {
        // Files are linked to the message that was just created, so the thread
        // can draw them inside its bubble. That means posting first and
        // uploading second: the id only exists once the server has the message.
        // A beat of delay before the images appear, in exchange for never
        // letting a failed upload block a message the user already sent.
        onSuccess: async (created) => {
          for (const f of pendingFiles) {
            try {
              await upload.mutateAsync({ file: f, commentId: created.id });
            } catch {
              /* best-effort — the message is already saved */
            }
          }
        },
      },
    );
    setBody("");
    setFiles([]);
  }

  async function sendReplyEmail() {
    const text = body.trim();
    const recipient = to.trim();
    if (!text || !recipient) return;
    setSending(true);
    setError(null);
    setSentInfo(null);
    try {
      const res = await sendReply.mutateAsync({
        to: recipient,
        body: text,
        attachments: files.map((f) => f.name),
      });
      await uploadFiles();
      setBody("");
      setFiles([]);
      // Queued, not delivered — the server hands it to its outbox and sweeps a
      // moment later, so "on its way" is the strongest true thing to say here.
      setSentInfo(t("composer.mailQueued", { to: recipient }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("composer.postError"));
    } finally {
      setSending(false);
    }
  }

  function submit() {
    if (isReply) return void sendReplyEmail();
    postComment(isNote);
  }

  const busy = sending || createComment.isPending;
  const canSend = isReply
    ? body.trim().length > 0 && to.trim().length > 0
    : body.trim().length > 0;

  const placeholder = isNote
    ? t("composer.notePlaceholder")
    : isReply
      ? t("composer.replyPlaceholder", { name: firstName })
      : t("composer.chatPlaceholder", { name: firstName });

  const sendLabel = busy
    ? t("composer.sending")
    : isReply
      ? t("composer.sendEmail")
      : isNote
        ? t("composer.saveNote")
        : t("composer.send");

  return (
    <div className="mt-auto overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex border-b border-hairline text-body font-semibold">
        {noteOnly ? null : (
          <button
            onClick={() => switchTab("chat")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5",
              isChat
                ? "border-b-2 border-brand text-brand-hover"
                : "text-muted",
            )}
          >
            <MessageSquare size={13} strokeWidth={2} />
            {t("composer.chat")}
          </button>
        )}
        {canAddNote && !noteOnly ? (
          <button
            onClick={() => switchTab("reply")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5",
              isReply
                ? "border-b-2 border-brand text-brand-hover"
                : "text-muted",
            )}
          >
            <Mail size={13} strokeWidth={2} />
            {t("composer.reply")}
          </button>
        ) : null}
        {canAddNote ? (
          <button
            onClick={() => switchTab("note")}
            className={cn(
              "px-4 py-2.5",
              isNote
                ? "border-b-2 border-warn text-[#a16207]"
                : "text-[#a16207]/70",
            )}
          >
            {t("composer.note")}
          </button>
        ) : null}
        {/* Says why the other two tabs are missing, so their absence reads as a
            rule about this ticket rather than something failing to load. */}
        {noteOnly ? (
          <span className="ml-auto self-center truncate px-4 text-caption font-normal text-faint">
            {t("composer.internalOnly")}
          </span>
        ) : null}
      </div>

      {/* Email header fields — reply tab only */}
      {isReply ? (
        <div className="flex flex-col divide-y divide-fill border-b border-hairline text-body">
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-12 flex-none font-medium text-faint">
              {t("composer.from")}
            </span>
            <span className="truncate text-muted">{user?.email ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <label
              htmlFor="reply-to"
              className="w-12 flex-none font-medium text-faint"
            >
              {t("composer.to")}
            </label>
            <input
              id="reply-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t("composer.toPlaceholder")}
              // Its own size rather than inheriting the header block's 12.5px —
              // an editable field has to clear the touch-zoom threshold.
              className={cn(
                "min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint focus:outline-none",
                FIELD_TEXT_12,
              )}
            />
          </div>
        </div>
      ) : null}

      <textarea
        rows={isReply ? 3 : 2}
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        onKeyDown={(e) => {
          // Chat: Enter sends, Shift+Enter for a newline (Reply/Note stay multiline).
          if (isChat && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend && !busy) submit();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "w-full resize-none px-4 py-3 text-ink placeholder:text-faint focus:outline-none",
          FIELD_TEXT,
          isNote && "bg-warn-tint",
        )}
      />

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-wash px-2 py-1 text-caption text-strong"
            >
              <Paperclip size={11} strokeWidth={2} className="text-faint" />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-faint">{formatSize(f.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={t("composer.removeFile", { name: f.name })}
                className="text-faint hover:text-danger"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2.5 border-t border-hairline bg-wash px-3 py-2.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-white px-2.5 py-1.5 text-dense text-muted hover:bg-app"
        >
          <Paperclip size={13} strokeWidth={2} />
          {t("composer.attach")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {error ? (
          <span className="text-caption font-medium text-danger">
            {error}
          </span>
        ) : sentInfo ? (
          <span className="text-caption font-medium text-success">
            {sentInfo}
          </span>
        ) : null}

        <span className="ml-auto flex items-center">
          <button
            onClick={submit}
            disabled={busy || !canSend}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3.5 py-[7px] text-body font-semibold text-white disabled:opacity-50",
              isNote
                ? "bg-warn hover:bg-[#92400e]"
                : "bg-brand hover:bg-brand-hover",
            )}
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : isReply ? (
              <Mail size={13} strokeWidth={2} />
            ) : isChat ? (
              <MessageSquare size={13} strokeWidth={2} />
            ) : null}
            {sendLabel}
          </button>
        </span>
      </div>
    </div>
  );
}
