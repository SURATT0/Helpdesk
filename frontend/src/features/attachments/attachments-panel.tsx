"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Download,
  Eye,
  FileText,
  ImageOff,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import {
  downloadAttachment,
  fetchAttachmentObjectUrl,
  viewAttachment,
} from "./api";
import {
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "./queries";
import type { Attachment } from "./schemas";

const MANAGE_ROLES = new Set(["admin", "manager", "agent"]);

/** Trash button with a two-step inline confirm (no blocking dialog). */
function DeleteButton({
  name,
  onConfirm,
  busy,
}: {
  name: string;
  onConfirm: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = React.useState(false);
  if (confirming) {
    return (
      <span className="flex flex-none items-center gap-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          aria-label={t("att.confirmDelete", { name })}
          className="text-[#dc2626] hover:text-[#b91c1c] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Check size={14} strokeWidth={2.5} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          aria-label={t("common.cancel")}
          className="text-faint hover:text-muted"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title={t("att.delete")}
      aria-label={t("att.deleteFile", { name })}
      className="flex-none text-faint hover:text-[#dc2626]"
    >
      <Trash2 size={13} strokeWidth={2} />
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (contentType: string) => contentType.startsWith("image/");

type Opened = { id: number; filename: string; url: string };

/**
 * Inline thumbnail for an image attachment. The bytes come from an authed
 * endpoint, so we fetch a blob → object URL and revoke it on unmount. Clicking
 * the thumbnail opens the shared lightbox (reusing the already-loaded URL, so no
 * second fetch).
 */
function ImageThumb({
  file,
  onOpen,
  onDownload,
  onDelete,
  deleting,
}: {
  file: Attachment;
  onOpen: (o: Opened) => void;
  onDownload: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let created: string | null = null;
    fetchAttachmentObjectUrl(file.id)
      .then((u) => {
        if (active) {
          created = u;
          setUrl(u);
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file.id]);

  const open = () =>
    url && onOpen({ id: file.id, filename: file.filename, url });

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line px-2.5 py-2 text-[12px] hover:bg-app">
      {/* Small thumbnail: an at-a-glance indicator that an image is attached */}
      <button
        type="button"
        onClick={open}
        disabled={!url}
        aria-label={t("att.previewFile", { name: file.filename })}
        className="flex-none overflow-hidden rounded border border-line bg-[#f1f5f9]"
        style={{ width: 40, height: 40 }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={file.filename}
            className="h-full w-full object-cover"
          />
        ) : failed ? (
          <span className="flex h-full w-full items-center justify-center text-faint">
            <ImageOff size={15} strokeWidth={2} />
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-faint">
            <Loader2 size={14} className="animate-spin" />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[#334155]">
          {file.filename}
        </div>
        <div className="text-[11px] text-faint">
          {formatSize(file.sizeBytes)}
        </div>
      </div>

      {/* Link-style Preview button — opens the full image centred on screen */}
      <button
        type="button"
        onClick={open}
        disabled={!url}
        className="flex-none inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-hover hover:underline disabled:opacity-50"
      >
        <Eye size={13} strokeWidth={2} />
        {t("att.preview")}
      </button>
      <button
        type="button"
        onClick={onDownload}
        title={t("att.download")}
        aria-label={t("att.downloadFile", { name: file.filename })}
        className="flex-none text-faint hover:text-brand-hover"
      >
        <Download size={13} strokeWidth={2} />
      </button>
      {onDelete ? (
        <DeleteButton
          name={file.filename}
          onConfirm={onDelete}
          busy={!!deleting}
        />
      ) : null}
    </div>
  );
}

/** Row for a non-image attachment: filename opens it in a new tab. */
function FileRow({
  file,
  onView,
  onDownload,
  onDelete,
  deleting,
}: {
  file: Attachment;
  onView: () => void;
  onDownload: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-[12px] hover:bg-app">
      <FileText size={14} strokeWidth={2} className="flex-none text-muted" />
      <button
        type="button"
        onClick={onView}
        title={t("att.view")}
        className="min-w-0 flex-1 truncate text-left font-medium text-[#334155] hover:text-brand-hover"
      >
        {file.filename}
      </button>
      <span className="flex-none text-[11px] text-faint">
        {formatSize(file.sizeBytes)}
      </span>
      <button
        type="button"
        onClick={onView}
        title={t("att.view")}
        aria-label={t("att.viewFile", { name: file.filename })}
        className="flex-none text-faint hover:text-brand-hover"
      >
        <Eye size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onDownload}
        title={t("att.download")}
        aria-label={t("att.downloadFile", { name: file.filename })}
        className="flex-none text-faint hover:text-brand-hover"
      >
        <Download size={13} strokeWidth={2} />
      </button>
      {onDelete ? (
        <DeleteButton
          name={file.filename}
          onConfirm={onDelete}
          busy={!!deleting}
        />
      ) : null}
    </div>
  );
}

/** Full-size image preview overlay. */
function Lightbox({
  opened,
  onClose,
}: {
  opened: Opened;
  onClose: () => void;
}) {
  const { t } = useI18n();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  // Portal to <body> so the overlay is centered on the whole viewport, escaping
  // the properties rail's scroll container (a fixed element can otherwise be
  // trapped by a transformed/clipping ancestor).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("att.previewFile", { name: opened.filename })}
      className="fixed inset-0 z-[60] grid place-items-center p-6"
      style={{ background: "rgba(15,23,42,.8)" }}
      onClick={onClose}
    >
      {/* Centered modal card */}
      <div
        className="flex max-h-[88vh] max-w-[880px] flex-col overflow-hidden rounded-xl bg-panel shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
            {opened.filename}
          </span>
          <button
            type="button"
            onClick={() => downloadAttachment(opened.id, opened.filename)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted hover:bg-app"
          >
            <Download size={13} strokeWidth={2} />
            {t("att.download")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("att.closePreview")}
            className="inline-flex items-center justify-center rounded-md border border-line p-1.5 text-muted hover:bg-app"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="grid place-items-center overflow-auto bg-[#0f172a] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={opened.url}
            alt={opened.filename}
            className="max-h-[74vh] max-w-full object-contain"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AttachmentsPanel({ ticketId }: { ticketId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: files = [], isLoading, isError } = useAttachments(ticketId);
  const upload = useUploadAttachment(ticketId);
  const del = useDeleteAttachment(ticketId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const canManage = user ? MANAGE_ROLES.has(user.role) : false;

  function remove(file: Attachment) {
    setActionError(null);
    setDeletingId(file.id);
    del.mutate(file.id, {
      onError: () =>
        setActionError(t("att.deleteError", { name: file.filename })),
      onSettled: () => setDeletingId(null),
    });
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  // Download/view hit an authed binary endpoint that can fail (e.g. the file is
  // missing from storage → 404). Catch it and show why, instead of failing silently.
  async function download(file: Attachment) {
    setActionError(null);
    try {
      await downloadAttachment(file.id, file.filename);
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 404
          ? t("att.missing", { name: file.filename })
          : t("att.downloadError", { name: file.filename }),
      );
    }
  }
  async function view(file: Attachment) {
    setActionError(null);
    try {
      await viewAttachment(file.id);
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 404
          ? t("att.missing", { name: file.filename })
          : t("att.downloadError", { name: file.filename }),
      );
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {isLoading ? (
        <div className="text-[11.5px] text-faint">{t("common.loading")}</div>
      ) : isError ? (
        <div className="text-[11.5px] font-medium text-[#dc2626]">
          {t("att.loadError")}
        </div>
      ) : files.length === 0 ? (
        <div className="text-[11.5px] text-faint">{t("att.empty")}</div>
      ) : (
        files.map((f) =>
          isImage(f.contentType) ? (
            <ImageThumb
              key={f.id}
              file={f}
              onOpen={setOpened}
              onDownload={() => download(f)}
              onDelete={canManage ? () => remove(f) : undefined}
              deleting={deletingId === f.id}
            />
          ) : (
            <FileRow
              key={f.id}
              file={f}
              onView={() => view(f)}
              onDownload={() => download(f)}
              onDelete={canManage ? () => remove(f) : undefined}
              deleting={deletingId === f.id}
            />
          ),
        )
      )}

      {actionError ? (
        <span className="text-[11px] font-medium text-[#dc2626]">
          {actionError}
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[#cbd5e1] px-3 py-2 text-[12px] font-medium text-muted hover:bg-app disabled:opacity-50"
      >
        {upload.isPending ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Upload size={13} strokeWidth={2} />
        )}
        {upload.isPending ? t("att.uploading") : t("att.upload")}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={onPick} />

      {upload.isError ? (
        <span className="text-[11px] font-medium text-[#dc2626]">
          {t("att.uploadError")}
        </span>
      ) : null}

      {opened ? <Lightbox opened={opened} onClose={() => setOpened(null)} /> : null}
    </div>
  );
}
