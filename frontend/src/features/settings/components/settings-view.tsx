"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useLanguagePreference } from "@/features/i18n/use-language-preference";
import { useUpdateMyProfile } from "@/features/users/queries";
import { IntegrationsPanel } from "@/features/integrations/components/integrations-panel";
import type { Lang } from "@/features/i18n/dictionary";

// Roles that may connect/sync external sources (mirrors backend `ticket:import`).
const CAN_INTEGRATE = new Set(["super_admin", "admin"]);

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
        <div className="text-section font-semibold text-ink">{title}</div>
        {note ? (
          <div className="mt-0.5 text-dense text-faint">{note}</div>
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
  const { t } = useI18n();
  // Writes the account too, not just this browser — the desk mails you in it.
  const { lang, setLanguage } = useLanguagePreference();
  const { user, patchUser, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = React.useState(user?.name ?? "");
  const [saved, setSaved] = React.useState(false);

  const save = useUpdateMyProfile((u) => {
    patchUser({ name: u.name });
    setSaved(true);
  });

  // Patch the session user so the toggle reflects the server's answer, not an
  // optimistic guess — this flag decides where real tickets go.
  const availability = useUpdateMyProfile((u) => {
    patchUser({ availableForAssignment: u.availableForAssignment });
  });

  if (!user) return null;

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== user.name;

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-4 sm:p-6">
      {/* Account */}
      <Section title={t("settings.account")} note={t("settings.accountNote")}>
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={user.name} size={44} />
          <div className="flex items-center gap-2 text-body">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-brand-hover">
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
            onClick={() => save.mutate({ name: trimmed })}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? t("settings.saving") : t("settings.save")}
          </Button>
          {saved && !dirty ? (
            <span className="text-body font-medium text-success">
              {t("settings.saved")}
            </span>
          ) : null}
          {save.isError ? (
            <span className="text-body font-medium text-danger">
              {save.error instanceof ApiError
                ? save.error.message
                : t("settings.saveError")}
            </span>
          ) : null}
        </div>
      </Section>

      {/* Availability — self-service, so it needs no manager and works for every
          role (a requester holds no user:write and cannot use the admin path). */}
      <Section
        title={t("settings.availability")}
        note={t("settings.availabilityNote")}
      >
        <label className="inline-flex cursor-pointer items-center gap-2 text-control">
          <input
            type="checkbox"
            checked={user.availableForAssignment}
            disabled={availability.isPending}
            onChange={(e) =>
              availability.mutate({ availableForAssignment: e.target.checked })
            }
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          <span className="font-medium text-ink">
            {t("settings.acceptingWork")}
          </span>
        </label>
        {!user.availableForAssignment ? (
          <p className="mt-2 text-body text-status-pending-fg">
            {t("settings.awayHint")}
          </p>
        ) : null}
        {availability.isError ? (
          <p className="mt-2 text-body font-medium text-danger">
            {availability.error instanceof ApiError
              ? availability.error.message
              : t("settings.saveError")}
          </p>
        ) : null}
      </Section>

      {/* Preferences */}
      <Section title={t("settings.preferences")}>
        <Label>{t("settings.language")}</Label>
        <div className="mt-1 inline-flex overflow-hidden rounded-md border border-line text-control font-medium">
          {LANGS.map((l, i) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setLanguage(l.value)}
              className={cn(
                "px-4 py-2",
                i > 0 && "border-l border-line",
                lang === l.value
                  ? "bg-accent-soft font-semibold text-brand-hover"
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
          className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3.5 py-2 text-control font-semibold text-danger hover:bg-danger-bg"
        >
          <LogOut size={14} strokeWidth={2} />
          {t("settings.signOut")}
        </button>
      </Section>
    </div>
  );
}
