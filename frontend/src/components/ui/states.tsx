"use client";

import { Loader2, AlertCircle } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[#eef1f5]", className)}
      aria-hidden
    />
  );
}

export function LoadingRow({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-faint">
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
      <AlertCircle size={20} className="text-[#dc2626]" />
      <div className="text-[13px] font-medium text-ink">
        {message ?? t("common.loadError")}
      </div>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1 rounded-md border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#475569] hover:bg-app"
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
    <div className="p-8 text-center text-[13px] text-faint">
      {message ?? t("common.empty")}
    </div>
  );
}
