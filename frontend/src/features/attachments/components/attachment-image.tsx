"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { fetchAttachmentObjectUrl } from "../api";
import type { Attachment } from "../schemas";

/**
 * One image inside a chat bubble.
 *
 * The `src` is an object URL, not the endpoint. The route needs a bearer token
 * and an `<img>` cannot send one — the access token lives in memory rather than
 * in a cookie precisely so there is no ambient credential a URL could ride on.
 * So the bytes are fetched, wrapped, and the URL revoked on unmount.
 *
 * Three states, and the reason this is a component rather than an `<img>`:
 *
 *   loading      the box is already the right size, from `width`/`height` on the
 *                row. A chat scrolls, so an image that arrives with no reserved
 *                height shoves every message below it — the one layout bug a
 *                reader actually notices.
 *   unavailable  the row exists but the bytes are gone (404 from storage). Says
 *                so, and never throws — a missing file must not take the thread
 *                down with it.
 *   broken       the bytes arrived but the browser could not decode them.
 *                Reported to the parent so it can fall back to a download card
 *                rather than leaving the browser's torn-image glyph.
 */
export function AttachmentImage({
  attachment,
  maxWidth,
  onBroken,
  onOpen,
  className,
}: {
  attachment: Attachment;
  /** Cap in px. The aspect ratio is preserved; height follows. */
  maxWidth: number;
  /** Called when the image cannot be decoded, so the caller can show a card. */
  onBroken?: () => void;
  onOpen?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [url, setUrl] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  React.useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    // The thread loads the resized copy; the lightbox asks for the full file.
    fetchAttachmentObjectUrl(attachment.id, "thumb")
      .then((next) => {
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
        setState("ready");
      })
      .catch(() => {
        if (!revoked) setState("unavailable");
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  /**
   * The reserved box.
   *
   * `width`/`height` attributes rather than a CSS aspect-ratio, because those are
   * what the browser uses to reserve space before any CSS has applied — which is
   * the moment that matters. They are scaled down to the cap here so the
   * attribute pair still describes the box the element will actually occupy.
   */
  const box = React.useMemo(() => {
    const w = attachment.width;
    const h = attachment.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxWidth / w);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }, [attachment.width, attachment.height, maxWidth]);

  if (state === "unavailable") {
    return (
      <div
        role="img"
        aria-label={t("attachment.unavailable")}
        style={box ? { width: box.width, height: box.height } : undefined}
        className={cn(
          "flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-wash px-3 py-4 text-center",
          className,
        )}
      >
        <ImageOff size={16} className="text-faint" />
        <span className="text-caption text-faint">{t("attachment.unavailable")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      // The box is on the button too, so the placeholder and the loaded image
      // occupy identical space and nothing shifts when the bytes land.
      style={box ? { width: box.width, height: box.height } : undefined}
      className={cn(
        "group relative block overflow-hidden rounded-md border border-line bg-wash",
        state === "loading" && "animate-pulse",
        className,
      )}
      aria-label={attachment.displayName}
      title={t("attachment.originalName", { name: attachment.filename })}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- object URL from an
        // authed fetch; next/image cannot carry the bearer token.
        <img
          src={url}
          alt={attachment.displayName}
          width={box?.width}
          height={box?.height}
          loading="lazy"
          decoding="async"
          onError={() => {
            setState("unavailable");
            onBroken?.();
          }}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
        />
      ) : null}
    </button>
  );
}
