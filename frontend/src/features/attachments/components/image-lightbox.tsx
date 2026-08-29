"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, ImageOff, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { downloadAttachment, fetchAttachmentObjectUrl } from "../api";
import type { Attachment } from "../schemas";

/**
 * The full-size view, opened by clicking a thumbnail.
 *
 * Escape and a backdrop click both close it, focus is trapped and the page
 * behind is scroll-locked — all of which comes from the shared `Dialog`, which
 * owns that behaviour so six modals do not each get it slightly wrong.
 *
 * The arrows appear only when the message carried more than one image, and they
 * move within that message's images: the set the reader was looking at, not
 * every file on the ticket.
 */
export function ImageLightbox({
  images,
  startIndex,
  onClose,
}: {
  images: Attachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = React.useState(startIndex);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  const current = images[index];
  const many = images.length > 1;

  const step = React.useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + images.length) % images.length);
    },
    [images.length],
  );

  // Arrow keys, so a reader flicking through a set does not have to aim at a
  // button. Escape is the Dialog's; adding it here would fire twice.
  React.useEffect(() => {
    if (!many) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [many, step]);

  // The full file, not the thumbnail — this is the view that exists to show
  // detail the bubble was too small for.
  React.useEffect(() => {
    if (!current) return;
    let revoked = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchAttachmentObjectUrl(current.id, "full")
      .then((next) => {
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current]);

  if (!current) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      label={current.displayName}
      backdrop="bg-ink/80"
      panelClassName="max-w-[min(1100px,94vw)]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className="truncate text-control font-semibold text-white"
              title={t("attachment.originalName", { name: current.filename })}
            >
              {current.displayName}
            </div>
            {many ? (
              <div className="text-caption text-white/60">
                {t("attachment.counter", {
                  n: index + 1,
                  total: images.length,
                })}
              </div>
            ) : null}
          </div>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => downloadAttachment(current.id, current.displayName)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-white/25 px-3 py-1.5 text-body font-semibold text-white hover:bg-white/10",
                TOUCH_TARGET,
              )}
            >
              <Download size={13} strokeWidth={2} />
              {t("attachment.download")}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("attachment.close")}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md border border-white/25 text-white hover:bg-white/10",
                TOUCH_TARGET,
              )}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-[240px] items-center justify-center">
          {failed ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ImageOff size={22} className="text-white/50" />
              <span className="text-body text-white/70">
                {t("attachment.unavailable")}
              </span>
            </div>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL from
            // an authed fetch; next/image cannot carry the bearer token.
            <img
              src={url}
              alt={current.displayName}
              onError={() => setFailed(true)}
              className="max-h-[78vh] w-auto max-w-full rounded-md object-contain"
            />
          ) : (
            <div className="py-16 text-body text-white/60">
              {t("attachment.loading")}
            </div>
          )}

          {many ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t("attachment.previous")}
                className={cn(
                  "absolute left-0 grid h-10 w-10 place-items-center rounded-full bg-ink/60 text-white hover:bg-ink/80",
                  TOUCH_TARGET,
                )}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t("attachment.next")}
                className={cn(
                  "absolute right-0 grid h-10 w-10 place-items-center rounded-full bg-ink/60 text-white hover:bg-ink/80",
                  TOUCH_TARGET,
                )}
              >
                <ChevronRight size={18} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
