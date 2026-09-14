"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Info, Loader2, ShieldAlert, Tag } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useCreateCategory, useOtherDescriptions } from "../queries";
import type { OtherDescription } from "../schemas";

/**
 * What people have been filing under "Other", and the one thing to do about it.
 *
 * This page exists because the alternative to it is worse. A free-text box on
 * the category picker collects exactly the vocabulary a desk does not have a
 * category for — which is valuable — and left alone it stays invisible, so the
 * category list never learns anything and every report has a growing "Other"
 * slice that says nothing. Reading the phrases side by side is what turns a
 * recurring one into a decision.
 *
 * Promoting creates the category and stops there. It deliberately does NOT
 * re-file the tickets that used the phrase: their category is what the desk
 * actually worked them under, and rewriting it would change what every closed
 * period's report says. The old tickets keep their own words, which are still on
 * their pages.
 */
export function OtherDescriptionsView() {
  const { t } = useI18n();
  const { user } = useAuth();
  // Mirrors the server's `category:write`, held by no role explicitly so only a
  // super admin's wildcard satisfies it. The API is the gate; this only decides
  // whether to ask for data that would come back 403.
  const canManage = user?.role === "super_admin";
  const { data, isLoading, isError, refetch } = useOtherDescriptions({
    enabled: canManage,
  });

  if (!canManage) {
    return (
      <>
        <Topbar titleKey="nav.categories" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-10 text-center">
            <ShieldAlert size={22} className="text-faint" />
            <div className="text-lead font-semibold text-ink">
              {t("categories.forbidden")}
            </div>
            <div className="max-w-[46ch] text-body text-subtle">
              {t("categories.forbiddenNote")}
            </div>
          </div>
        </main>
      </>
    );
  }

  const rows = data ?? [];

  return (
    <>
      <Topbar titleKey="nav.categories" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="mb-4 flex max-w-[68ch] items-start gap-2 text-body leading-relaxed text-subtle">
          <Info size={14} className="mt-[2px] flex-none text-faint" />
          {t("categories.explainer")}
        </p>

        {isLoading ? (
          <LoadingRow />
        ) : isError ? (
          <ErrorState message={t("categories.loadError")} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState message={t("categories.emptyNote")} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <PhraseCard
                key={`${row.customerId}-${row.text}`}
                row={row}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * One phrase, with the promotion form folded into it.
 *
 * The name is pre-filled with what the person typed and stays editable: their
 * words are the best starting point and rarely the right category name —
 * "printer keeps jamming on floor 2" is a ticket, "Printing" is a category.
 */
function PhraseCard({ row }: { row: OtherDescription }) {
  const { t, locale } = useI18n();
  const create = useCreateCategory();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(row.text);
  const [code, setCode] = React.useState("");
  const [done, setDone] = React.useState<string | null>(null);

  /**
   * Whether the server can derive a code from this name.
   *
   * `categoryCode` keeps only letters and digits, so a name written entirely in
   * Thai derives to an empty string — which is not a usable grouping key. Asking
   * for one here rather than letting the request fail means the person is told
   * while they are still typing the name.
   */
  const derivable = /[a-zA-Z0-9]/.test(name);
  const ready = name.trim().length >= 2 && (derivable || /^[A-Z0-9_]{2,}$/.test(code));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || create.isPending) return;
    create.mutate(
      {
        name: name.trim(),
        customerId: row.customerId,
        ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
      },
      {
        onSuccess: (created) => {
          setDone(created.name);
          setOpen(false);
        },
      },
    );
  }

  return (
    // The hook exists because a phrase is free text: a test cannot address this
    // card by its wording without pinning words a person typed. Same reasoning
    // as the notification panel's own attribute.
    <Card className="p-4" data-other-phrase>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* The phrase itself, in the reader's face rather than in a column —
              it is the thing being judged, and it can be a whole sentence. */}
          <div className="text-lead font-semibold leading-snug text-ink">
            {row.text}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-faint">
            <span className="font-semibold text-muted">
              {t("categories.timesUsed", { n: row.count })}
            </span>
            <span>{row.customerName}</span>
            <span>
              {t("categories.lastUsed", {
                when: new Date(row.lastUsedAt).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }),
              })}
            </span>
          </div>
          {/* The tickets behind the phrase. A count alone is a number; these are
              what let somebody read the cases before naming a category for them. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.ticketIds.slice(0, 8).map((id) => (
              <Link
                key={id}
                href={`/tickets/${id}`}
                className={cn(
                  "inline-flex items-center rounded-md border border-line bg-white px-2 py-0.5 font-mono text-caption text-muted hover:bg-app hover:text-ink",
                  TOUCH_TARGET,
                )}
              >
                #{id}
              </Link>
            ))}
            {row.ticketIds.length > 8 ? (
              <span className="text-caption text-faint">
                {t("categories.andMore", { n: row.ticketIds.length - 8 })}
              </span>
            ) : null}
          </div>
        </div>

        {done ? (
          <span className="inline-flex items-center gap-1.5 text-body font-medium text-success">
            <Check size={14} strokeWidth={2.5} />
            {t("categories.promoted", { name: done })}
          </span>
        ) : open ? null : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Tag size={13} strokeWidth={2} />
            {t("categories.promote")}
          </Button>
        )}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-3 border-t border-hairline pt-3">
          <p className="mb-2 max-w-[62ch] text-caption leading-relaxed text-faint">
            {/* Said before the button is pressed, because it is the part people
                assume the other way round. */}
            {t("categories.promoteNote", { customer: row.customerName })}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-dense font-medium text-subtle">
                {t("categories.nameLabel")}
              </span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className={cn(
                  "w-full min-w-0 rounded-md border border-edge bg-white px-2.5 py-1.5 text-ink sm:w-64",
                  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                  FIELD_TEXT_12,
                )}
              />
            </label>

            {/* Only when the server could not derive one. Showing it always would
                put a field nobody needs in front of everybody. */}
            {derivable ? null : (
              <label className="flex flex-col gap-1">
                <span className="text-dense font-medium text-subtle">
                  {t("categories.codeLabel")}
                </span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="PRINTING"
                  maxLength={64}
                  className={cn(
                    "w-full min-w-0 rounded-md border border-edge bg-white px-2.5 py-1.5 font-mono text-ink sm:w-44",
                    "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                    FIELD_TEXT_12,
                  )}
                />
              </label>
            )}

            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              {t("categories.promote")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setName(row.text);
                setCode("");
                create.reset();
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>

          {!derivable ? (
            <p className="mt-1.5 max-w-[62ch] text-caption leading-relaxed text-faint">
              {t("categories.codeHint")}
            </p>
          ) : null}

          {create.isError ? (
            <p className="mt-2 text-body font-medium text-danger">
              {create.error instanceof ApiError
                ? create.error.message
                : t("categories.promoteError")}
            </p>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
