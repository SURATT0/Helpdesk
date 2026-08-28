"use client";

import * as React from "react";
import { Download, FileText } from "lucide-react";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { downloadAttachment } from "../api";
import type { Attachment } from "../schemas";
import { AttachmentImage } from "./attachment-image";
import { ImageLightbox } from "./image-lightbox";

/** Widest a single image gets inside a bubble. */
const BUBBLE_MAX_WIDTH = 320;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A non-image file: icon, name, size, download.
 *
 * This is also where a stored SVG lands. Not an oversight — an SVG is a document
 * that can carry script, so it is never given an `<img>`, and the server's
 * `isImage` is what decides that for every surface at once.
 */
function FileCard({ attachment }: { attachment: Attachment }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-2">
      <FileText size={15} className="flex-none text-faint" />
      <div className="min-w-0 flex-1 leading-tight">
        <div
          className="truncate text-body font-medium text-ink"
          title={t("attachment.originalName", { name: attachment.filename })}
        >
          {attachment.displayName}
        </div>
        <div className="text-caption text-faint">
          {formatSize(attachment.sizeBytes)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => downloadAttachment(attachment.id, attachment.displayName)}
        aria-label={t("attachment.downloadNamed", { name: attachment.displayName })}
        className={cn(
          "grid h-7 w-7 flex-none place-items-center rounded-md text-subtle hover:bg-app",
          TOUCH_TARGET,
        )}
      >
        <Download size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * The files a message was sent with, drawn inside its bubble.
 *
 * Images become thumbnails; everything else stays the icon-and-name card it
 * always was. An image that turns out not to decode is demoted to a card at
 * runtime — the alternative is the browser's torn-image glyph, which tells the
 * reader nothing and offers them nothing.
 *
 * Layout: one image gets its full width up to the cap; two to four sit in a
 * two-column grid; five or more go to three columns so a long set does not turn
 * a bubble into a column of stacked photographs.
 */
export function MessageAttachments({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  const [broken, setBroken] = React.useState<ReadonlySet<number>>(new Set());
  const [lightboxAt, setLightboxAt] = React.useState<number | null>(null);

  const markBroken = React.useCallback((id: number) => {
    setBroken((prev) => new Set(prev).add(id));
  }, []);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.isImage && !broken.has(a.id));
  const files = attachments.filter((a) => !a.isImage || broken.has(a.id));

  const columns = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {images.length > 0 ? (
        <div
          data-image-grid={images.length}
          data-columns={columns}
          className={cn(
            "grid gap-1.5",
            columns === 1 && "grid-cols-1",
            columns === 2 && "grid-cols-2",
            columns === 3 && "grid-cols-3",
          )}
          // The cap applies to the whole grid, not to each cell: two 320px images
          // side by side would be twice as wide as the single-image case and
          // burst the bubble.
          style={{ maxWidth: BUBBLE_MAX_WIDTH }}
        >
          {images.map((a, i) => (
            <AttachmentImage
              key={a.id}
              attachment={a}
              // Each cell gets its share of the cap, minus the gaps.
              maxWidth={Math.floor((BUBBLE_MAX_WIDTH - (columns - 1) * 6) / columns)}
              onBroken={() => markBroken(a.id)}
              onOpen={() => setLightboxAt(i)}
              className={columns === 1 ? undefined : "aspect-square"}
            />
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="flex flex-col gap-1.5" style={{ maxWidth: BUBBLE_MAX_WIDTH }}>
          {files.map((a) => (
            <FileCard key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}

      {lightboxAt != null && images.length > 0 ? (
        <ImageLightbox
          images={images}
          startIndex={Math.min(lightboxAt, images.length - 1)}
          onClose={() => setLightboxAt(null)}
        />
      ) : null}
    </div>
  );
}
