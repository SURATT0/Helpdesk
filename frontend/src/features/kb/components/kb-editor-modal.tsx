"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useCategories } from "@/features/tickets/queries";
import { useCreateArticle, useUpdateArticle } from "../queries";
import type { KbArticle, KbArticleInput } from "../schemas";

const FIELD = cn(
  "rounded-md border border-line bg-white px-3 py-[7px] text-ink placeholder:text-faint focus:border-brand focus:outline-none",
  FIELD_TEXT_13,
);

/** The server's own limits, mirrored so the counter and the API agree. */
const LIMITS = { title: 200, excerpt: 500, readMin: 60, tags: 12 };

/**
 * Write or edit an article.
 *
 * One form for both: creating and editing differ only in which mutation runs and
 * whether the id is already spoken for, and splitting them would mean two copies
 * of the same nine fields drifting apart.
 *
 * Save and publish are separate buttons rather than a status dropdown. "Publish"
 * is a decision about who can see this, and burying it in a select alongside
 * `readMin` invites making it by accident — a new article starts as a draft and
 * stays one until someone says otherwise.
 *
 * Which buttons appear depends on where the article already is. Editing a
 * PUBLISHED one offers only Save, and saves it published: a "save as draft"
 * button next to it would be an unpublish — taking a live article away from
 * everyone — dressed up as the safe option.
 */
export function KbEditorModal({
  article,
  onClose,
  onCreated,
}: {
  /** Omitted when writing a new one. */
  article?: KbArticle;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { data: categories = [] } = useCategories();
  const create = useCreateArticle();
  const update = useUpdateArticle();
  const editing = article != null;
  // Already visible to everyone: the only save on offer keeps it that way.
  const live = article?.status === "published";

  const [title, setTitle] = React.useState(article?.title ?? "");
  const [excerpt, setExcerpt] = React.useState(article?.excerpt ?? "");
  const [body, setBody] = React.useState(article?.body ?? "");
  const [categoryId, setCategoryId] = React.useState<number | null>(
    article?.categoryId ?? null,
  );
  // Held as the raw comma-separated string the author is typing, so a trailing
  // comma mid-word does not make a tag appear and vanish under the cursor.
  const [tagText, setTagText] = React.useState(article?.tags.join(", ") ?? "");
  const [readMin, setReadMin] = React.useState(String(article?.readMin ?? 3));
  const [error, setError] = React.useState<string | null>(null);

  // First category as the default, once they have loaded — a picker that starts
  // on nothing makes an author choose something they have no opinion about.
  React.useEffect(() => {
    if (categoryId == null && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const tags = React.useMemo(
    () => [
      ...new Set(
        tagText
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    [tagText],
  );

  const minutes = Number(readMin);
  const pending = create.isPending || update.isPending;
  const incomplete =
    title.trim().length < 3 ||
    excerpt.trim().length < 10 ||
    body.trim().length < 20 ||
    categoryId == null ||
    tags.length > LIMITS.tags ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > LIMITS.readMin;

  function save(status: "draft" | "published") {
    if (categoryId == null) return;
    setError(null);
    const input: KbArticleInput = {
      title: title.trim(),
      excerpt: excerpt.trim(),
      body: body.trim(),
      categoryId,
      tags,
      readMin: minutes,
      status,
    };
    const onError = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : t("kb.saveError"));

    if (editing) {
      update.mutate(
        { id: article.id, input },
        { onSuccess: () => onClose(), onError },
      );
    } else {
      create.mutate(input, {
        onSuccess: (created) => {
          onCreated?.(created.id);
          onClose();
        },
        onError,
      });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      label={editing ? t("kb.editTitle") : t("kb.newTitle")}
      align="start"
      panelClassName="max-w-[640px]"
    >
      <div className="flex max-h-[88dvh] flex-col overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">
              {editing ? t("kb.editTitle") : t("kb.newTitle")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#475569]">
              {editing
                ? t("kb.editNote", { id: article.id })
                : t("kb.newNote")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("kb.close")}
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app",
              TOUCH_TARGET,
            )}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="kb-title">
              {t("kb.titleLabel")}
            </label>
            <input
              id="kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.title}
              placeholder={t("kb.titlePlaceholder")}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <label
                className="text-[12px] font-medium text-faint"
                htmlFor="kb-category"
              >
                {t("kb.categoryLabel")}
              </label>
              <select
                id="kb-category"
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className={cn(FIELD, "px-2.5")}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-[140px]">
              <label
                className="text-[12px] font-medium text-faint"
                htmlFor="kb-readmin"
              >
                {t("kb.readMinLabel")}
              </label>
              <input
                id="kb-readmin"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.readMin}
                value={readMin}
                onChange={(e) => setReadMin(e.target.value)}
                className={FIELD}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-[12px] font-medium text-faint"
              htmlFor="kb-excerpt"
            >
              {t("kb.excerptLabel")}
            </label>
            <textarea
              id="kb-excerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
              maxLength={LIMITS.excerpt}
              placeholder={t("kb.excerptPlaceholder")}
              className={cn(FIELD, "resize-none py-2")}
            />
            <span className="text-[11.5px] text-faint">
              {t("kb.excerptHelp")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="kb-body">
              {t("kb.bodyLabel")}
            </label>
            <textarea
              id="kb-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder={t("kb.bodyPlaceholder")}
              className={cn(FIELD, "resize-y py-2 font-mono text-[12.5px]")}
            />
            <span className="text-[11.5px] text-faint">{t("kb.bodyHelp")}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="kb-tags">
              {t("kb.tagsLabel")}
            </label>
            <input
              id="kb-tags"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder={t("kb.tagsPlaceholder")}
              className={FIELD}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#475569]"
                >
                  {tag}
                </span>
              ))}
              <span className="text-[11.5px] text-faint">
                {t("kb.tagsHelp", { n: LIMITS.tags })}
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-2.5 text-[12.5px] font-medium text-[#dc2626]">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("kb.cancel")}
          </Button>
          {live ? null : (
            <Button
              variant="outline"
              onClick={() => save("draft")}
              disabled={incomplete || pending}
            >
              {t("kb.saveDraft")}
            </Button>
          )}
          <Button
            onClick={() => save("published")}
            disabled={incomplete || pending}
          >
            {pending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("kb.saving")}
              </>
            ) : live ? (
              t("kb.save")
            ) : (
              t("kb.publish")
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
