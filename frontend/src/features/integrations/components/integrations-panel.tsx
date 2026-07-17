"use client";

import * as React from "react";
import { Mail, Plug, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useEmailStatus, useSources, useSyncSource } from "../queries";
import type { SourceInfo } from "../schemas";

type RowResult = { created: number; failed: number } | { error: string };

function StatusBadge({ source }: { source: SourceInfo }) {
  const { t } = useI18n();
  const [label, classes] = !source.implemented
    ? [t("integrations.comingSoon"), "bg-[#f1f5f9] text-[#475569]"]
    : source.configured
      ? [t("integrations.connected"), "bg-[#dcfce7] text-[#15803d]"]
      : [t("integrations.notConfigured"), "bg-[#fef3c7] text-[#b45309]"];
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        classes,
      )}
    >
      {label}
    </span>
  );
}

export function IntegrationsPanel() {
  const { t } = useI18n();
  const { data: sources = [], isLoading, isError } = useSources();
  const { data: email } = useEmailStatus();
  const sync = useSyncSource();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, RowResult>>({});

  function runSync(id: string) {
    setActiveId(id);
    setResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    sync.mutate(id, {
      onSuccess: (res) =>
        setResults((r) => ({
          ...r,
          [id]: { created: res.import.created, failed: res.import.failed },
        })),
      onError: (err) =>
        setResults((r) => ({
          ...r,
          [id]: {
            error:
              err instanceof ApiError ? err.message : t("integrations.syncError"),
          },
        })),
      onSettled: () => setActiveId(null),
    });
  }

  return (
    <Card className="p-5">
      <div className="mb-3.5 flex items-center gap-2">
        <Plug size={16} className="text-brand" />
        <div>
          <div className="text-[14px] font-semibold text-ink">
            {t("integrations.title")}
          </div>
          <div className="mt-0.5 text-[12px] text-faint">
            {t("integrations.note")}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-[12.5px] text-faint">{t("common.loading")}</div>
      ) : isError ? (
        <div className="text-[12.5px] text-[#dc2626]">
          {t("integrations.loadError")}
        </div>
      ) : sources.length === 0 ? (
        <div className="text-[12.5px] text-faint">{t("integrations.empty")}</div>
      ) : (
        <div className="flex flex-col divide-y divide-[#eef1f5]">
          {sources.map((s) => {
            const canSync = s.implemented && s.configured;
            const busy = activeId === s.id;
            const result = results[s.id];
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">
                      {s.label}
                    </span>
                    <StatusBadge source={s} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {s.description}
                  </div>
                  {!s.implemented ? (
                    <div className="mt-0.5 text-[11.5px] text-faint">
                      {s.configured
                        ? t("integrations.credsDetected")
                        : t("integrations.configureHint")}
                    </div>
                  ) : null}
                  {result ? (
                    <div
                      className={cn(
                        "mt-1 text-[11.5px] font-medium",
                        "error" in result
                          ? "text-[#dc2626]"
                          : result.failed > 0
                            ? "text-[#c2410c]"
                            : "text-[#15803d]",
                      )}
                    >
                      {"error" in result
                        ? result.error
                        : t("integrations.syncResult", {
                            created: result.created,
                            failed: result.failed,
                          })}
                    </div>
                  ) : null}
                </div>
                <div className="flex-none">
                  {canSync ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runSync(s.id)}
                      disabled={busy}
                    >
                      <RefreshCw
                        size={13}
                        className={cn(busy && "animate-spin")}
                      />
                      {busy ? t("integrations.syncing") : t("integrations.sync")}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      {t("integrations.sync")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inbound email (webhook) — a push surface, not a sync source */}
      {email ? (
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Mail size={15} className="text-brand" />
                <span className="text-[13.5px] font-semibold text-ink">
                  {t("integrations.email.title")}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    email.webhookEnabled
                      ? "bg-[#dcfce7] text-[#15803d]"
                      : "bg-[#f1f5f9] text-[#475569]",
                  )}
                >
                  {email.webhookEnabled
                    ? t("integrations.email.enabled")
                    : t("integrations.email.disabled")}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted">
                {t("integrations.email.note")}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] font-medium text-faint">POST</span>
                <code className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
                  {email.endpoint}
                </code>
              </div>
              {!email.webhookEnabled ? (
                <div className="mt-1 text-[11.5px] text-faint">
                  {t("integrations.email.enableHint")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
