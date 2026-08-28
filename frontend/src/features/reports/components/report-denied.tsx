"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Info, X } from "lucide-react";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

/**
 * The one line a reader gets after being sent back here from a report they may
 * not open.
 *
 * Says that access was refused and nothing else — not which report, not what it
 * contains, not who may see it. A message naming the missing page would tell an
 * agent that a table comparing them to their colleagues exists, which is the
 * disclosure the whole change is there to prevent.
 *
 * Dismissing clears the query param rather than only hiding the element, so a
 * refresh or a back-navigation does not bring the notice back.
 */
export function ReportDenied() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const denied = params.get("denied") === "1";

  if (!denied) return null;

  return (
    <div className="px-6 pt-6">
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-warn-edge bg-warn-tint px-4 py-3"
      >
        <Info size={15} className="mt-px flex-none text-warn" />
        <span className="flex-1 text-body text-warn-ink">
          {t("report.denied")}
        </span>
        <button
          type="button"
          onClick={() => router.replace("/reports")}
          aria-label={t("report.denied.dismiss")}
          className={cn(
            "grid h-6 w-6 flex-none place-items-center rounded text-warn hover:bg-warn-bg",
            TOUCH_TARGET,
          )}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
