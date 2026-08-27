"use client";

import { Loader2, AlertCircle } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-hairline", className)}
      aria-hidden
    />
  );
}

export function LoadingRow({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-control text-faint">
      <Loader2 size={15} className="animate-spin" />
      {label ?? t("common.loading")}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <AlertCircle size={20} className="text-danger" />
      <div className="text-control font-medium text-ink">
        {message ?? t("common.loadError")}
      </div>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1 rounded-md border border-line bg-white px-3 py-1.5 text-body font-semibold text-subtle hover:bg-app"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="p-8 text-center text-control text-faint">
      {message ?? t("common.empty")}
    </div>
  );
}
