"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { updateMyProfile } from "@/features/users/api";
import { userKeys } from "@/features/users/queries";
import { IntegrationsPanel } from "@/features/integrations/components/integrations-panel";
import type { Lang } from "@/features/i18n/dictionary";

// Roles that may connect/sync external sources (mirrors backend `ticket:import`).
const CAN_INTEGRATE = new Set(["admin", "manager", "agent"]);

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3.5">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {note ? (
          <div className="mt-0.5 text-[12px] text-faint">{note}</div>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "th", label: "ไทย" },
];

export function SettingsView() {
  const { t, lang, setLang } = useI18n();
  const { user, patchUser, logout } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = React.useState(user?.name ?? "");
  const [saved, setSaved] = React.useState(false);

  const save = useMutation({
    mutationFn: (n: string) => updateMyProfile(n),
    onSuccess: (u) => {
      patchUser({ name: u.name });
      qc.invalidateQueries({ queryKey: userKeys.all });
      setSaved(true);
    },
  });

  if (!user) return null;

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== user.name;

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-6">
      {/* Account */}
      <Section title={t("settings.account")} note={t("settings.accountNote")}>
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={user.name} size={44} />
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="rounded-full bg-[#e4f2ea] px-2.5 py-0.5 font-semibold text-brand-hover">
              {t(`role.${user.role}`)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <Label>{t("settings.name")}</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
                save.reset();
              }}
              maxLength={80}
            />
          </div>
          <div>
            <Label>{t("settings.email")}</Label>
            <Input
              value={user.email}
              disabled
              readOnly
              className="bg-[#f8fafc] text-muted"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => save.mutate(trimmed)}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? t("settings.saving") : t("settings.save")}
          </Button>
          {saved && !dirty ? (
            <span className="text-[12.5px] font-medium text-[#15803d]">
              {t("settings.saved")}
            </span>
          ) : null}
          {save.isError ? (
            <span className="text-[12.5px] font-medium text-[#dc2626]">
              {save.error instanceof ApiError
                ? save.error.message
                : t("settings.saveError")}
            </span>
          ) : null}
        </div>
      </Section>

      {/* Preferences */}
      <Section title={t("settings.preferences")}>
        <Label>{t("settings.language")}</Label>
        <div className="mt-1 inline-flex overflow-hidden rounded-md border border-line text-[13px] font-medium">
          {LANGS.map((l, i) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setLang(l.value)}
              className={cn(
                "px-4 py-2",
                i > 0 && "border-l border-line",
                lang === l.value
                  ? "bg-[#e4f2ea] font-semibold text-brand-hover"
                  : "text-muted hover:bg-app",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Integrations — external ticket sources (import-capable roles only) */}
      {CAN_INTEGRATE.has(user.role) ? <IntegrationsPanel /> : null}

      {/* Session */}
      <Section title={t("settings.session")}>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
        >
          <LogOut size={14} strokeWidth={2} />
          {t("settings.signOut")}
        </button>
      </Section>
    </div>
  );
}
