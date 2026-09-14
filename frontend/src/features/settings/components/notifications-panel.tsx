"use client";

import * as React from "react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useCustomers } from "@/features/customers/queries";
import { toMinutes } from "../api";
import {
  useNotificationSettings,
  useResetNotificationSettings,
  useSaveNotificationSettings,
} from "../queries";

/**
 * The desk's notification policy.
 *
 * Rendered only for whoever may change it — this is configuration, not case
 * work, and a read-only copy of it would just be a second thing to explain.
 *
 * The event list and the input bounds both come from the server (`meta`) rather
 * than a copy kept here: an event added to the catalogue should appear on this
 * screen without a frontend change, and a bound should be enforced in one place.
 */
export function NotificationsPanel({
  canManage,
  /**
   * True when the reader belongs to no customer of their own.
   *
   * A policy is one tenant's, and the API reads the tenant off the caller —
   * except for platform staff, who have none, so it asks them which and answers
   * 400 if nobody says. Every super admin is platform staff now, which made this
   * panel unusable for everybody: it sent no customer, and there was no longer
   * anyone whose own tenant could be assumed. So they choose, here.
   *
   * Deliberately a choice and not a default. Quietly picking the first customer
   * would be one company's settings being edited from a screen that never said
   * whose they were.
   */
  needsCustomer,
}: {
  canManage: boolean;
  needsCustomer: boolean;
}) {
  const { t } = useI18n();
  const customers = useCustomers({ enabled: canManage && needsCustomer });
  const [customerId, setCustomerId] = React.useState<number | null>(null);

  // With exactly one tenant there is nothing to choose, so the picker answers
  // itself rather than making somebody confirm the only option.
  const options = customers.data ?? [];
  React.useEffect(() => {
    if (customerId == null && options.length === 1) setCustomerId(options[0].id);
  }, [options, customerId]);

  const chosen = needsCustomer ? (customerId ?? undefined) : undefined;
  const ready = !needsCustomer || chosen != null;

  const { data, isLoading, isError } = useNotificationSettings(
    canManage && ready,
    chosen,
  );
  const save = useSaveNotificationSettings(chosen);
  const reset = useResetNotificationSettings(chosen);

  // Draft state, seeded from the server once it arrives. Held apart from the
  // query so typing does not fight a refetch.
  const [disabled, setDisabled] = React.useState<Set<string>>(new Set());
  const [rate, setRate] = React.useState("");
  const [windowMin, setWindowMin] = React.useState("");
  const [slaMin, setSlaMin] = React.useState("");
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    // Re-seed only when the server's own values change, so a save that returns
    // the same numbers does not wipe an edit in progress.
    const stamp = JSON.stringify(data.settings);
    if (stamp === loadedFor) return;
    setLoadedFor(stamp);
    setDisabled(new Set(data.settings.disabledEvents));
    setRate(String(data.settings.ratePerTicket));
    setWindowMin(String(toMinutes(data.settings.rateWindowMs)));
    setSlaMin(String(toMinutes(data.settings.slaWarnMs)));
  }, [data, loadedFor]);

  if (!canManage) return null;

  /** The picker, above whatever state the panel is in — it is what chooses that state. */
  const picker = needsCustomer ? (
    <div className="mb-4">
      <Label htmlFor="notify-customer">{t("notifySettings.customer")}</Label>
      <select
        id="notify-customer"
        value={customerId ?? ""}
        onChange={(e) =>
          setCustomerId(e.target.value ? Number(e.target.value) : null)
        }
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-control text-ink"
      >
        <option value="">{t("notifySettings.customerPlaceholder")}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-caption text-faint">
        {t("notifySettings.customerHint")}
      </p>
    </div>
  ) : null;

  // Nothing to show until a tenant is named — the policy belongs to one.
  if (!ready) {
    return (
      <Card className="p-5">
        <div className="mb-3.5 text-section font-semibold text-ink">
          {t("notifySettings.title")}
        </div>
        {picker}
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="text-dense text-faint">{t("notifySettings.loading")}</div>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="p-5">
        <div className="text-dense text-danger">{t("notifySettings.error")}</div>
      </Card>
    );
  }

  const { limits, events, settings } = data;
  const num = (v: string) => Number(v.trim());
  const inRange = (v: string, b: { min: number; max: number }) =>
    Number.isInteger(num(v)) && num(v) >= b.min && num(v) <= b.max;

  const valid =
    inRange(rate, limits.ratePerTicket) &&
    inRange(windowMin, limits.rateWindowMinutes) &&
    inRange(slaMin, limits.slaWarnMinutes);

  function toggle(event: string) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  function submit() {
    if (!valid) return;
    save.mutate({
      disabledEvents: [...disabled],
      ratePerTicket: num(rate),
      rateWindowMinutes: num(windowMin),
      slaWarnMinutes: num(slaMin),
    });
  }

  return (
    // The hook exists because this card's Save button reads identically to the
    // account section's a few cards up. Tests need to say WHICH one they mean,
    // and a data attribute says it without pinning any wording.
    <Card className="p-5" data-notification-settings>
      <div className="mb-3.5">
        <div className="text-section font-semibold text-ink">
          {t("notifySettings.title")}
        </div>
        <div className="mt-0.5 text-dense text-faint">
          {settings.configured
            ? t("notifySettings.noteConfigured")
            : t("notifySettings.noteDefaults")}
        </div>
      </div>

      {picker}

      {/* Per-event switches. A checked box means the event IS mailed; the stored
          shape is the inverse (a deny list), which is the right thing to store
          and the wrong thing to show. */}
      <Label>{t("notifySettings.events")}</Label>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {events.map((event) => {
          const on = !disabled.has(event);
          return (
            <label
              key={event}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-body [@media(pointer:coarse)]:min-h-11"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(event)}
                className="size-4 accent-[--color-brand]"
              />
              <span className={cn(on ? "text-ink" : "text-faint")}>
                {t(`notifyEvent.${event}`)}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="ns-rate">{t("notifySettings.rate")}</Label>
          <Input
            id="ns-rate"
            inputMode="numeric"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={!inRange(rate, limits.ratePerTicket)}
          />
          <p className="mt-1 text-caption text-faint">
            {t("notifySettings.rateHint", {
              min: limits.ratePerTicket.min,
              max: limits.ratePerTicket.max,
            })}
          </p>
        </div>
        <div>
          <Label htmlFor="ns-window">{t("notifySettings.window")}</Label>
          <Input
            id="ns-window"
            inputMode="numeric"
            value={windowMin}
            onChange={(e) => setWindowMin(e.target.value)}
            aria-invalid={!inRange(windowMin, limits.rateWindowMinutes)}
          />
          <p className="mt-1 text-caption text-faint">
            {t("notifySettings.windowHint", {
              min: limits.rateWindowMinutes.min,
              max: limits.rateWindowMinutes.max,
            })}
          </p>
        </div>
        <div>
          <Label htmlFor="ns-sla">{t("notifySettings.sla")}</Label>
          <Input
            id="ns-sla"
            inputMode="numeric"
            value={slaMin}
            onChange={(e) => setSlaMin(e.target.value)}
            aria-invalid={!inRange(slaMin, limits.slaWarnMinutes)}
          />
          {/* Says out loud that this moves the colours on the ticket list, not
              just the emails — one value drives both, deliberately. */}
          <p className="mt-1 text-caption text-faint">
            {t("notifySettings.slaHint", {
              min: limits.slaWarnMinutes.min,
              max: limits.slaWarnMinutes.max,
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={submit} disabled={!valid || save.isPending}>
          {save.isPending ? t("settings.saving") : t("settings.save")}
        </Button>
        {settings.configured ? (
          <Button
            variant="secondary"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
          >
            {t("notifySettings.reset")}
          </Button>
        ) : null}
        {save.isSuccess && !save.isPending ? (
          <span className="text-caption font-medium text-success">
            {t("settings.saved")}
          </span>
        ) : null}
        {save.isError ? (
          <span className="text-caption font-medium text-danger">
            {apiErrorMessage(save.error, t, "settings.saveError")}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
