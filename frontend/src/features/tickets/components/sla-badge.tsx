"use client";

import * as React from "react";
import { AlertTriangle, Check, Clock, Minus } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { SLA_STATES_AT_STAKE } from "../sla";
import type { SlaAssessment, SlaState } from "../sla";

type Look = {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Colour and fill. Weight tracks urgency: filled → tinted → text only. */
  className: string;
};

/**
 * Every state carries an icon AND words. Colour is the third channel, never the
 * only one: the label already says "2h 14m over" vs "42m left", so the column
 * still reads correctly in greyscale or with a colour-vision deficiency.
 */
const LOOK: Record<SlaState, Look> = {
  breached_open: {
    icon: AlertTriangle,
    className: "rounded-full bg-sla-breach px-2 py-[3px] font-semibold text-white",
  },
  at_risk: {
    icon: Clock,
    className:
      "rounded-full bg-sla-risk-bg px-2 py-[3px] font-semibold text-sla-risk-fg",
  },
  due_soon: { icon: Clock, className: "font-medium text-sla-soon" },
  on_track: { icon: Clock, className: "text-sla-ok" },
  breached_closed: {
    icon: AlertTriangle,
    className:
      "rounded-full border border-sla-breach px-2 py-[2px] font-medium text-sla-breach-fg",
  },
  met: { icon: Check, className: "text-sla-idle" },
  no_sla: { icon: Minus, className: "text-sla-idle" },
};

/**
 * States whose label carries a duration worth repeating to a screen reader —
 * which is the same set as "something is still at stake", so it reads that list
 * rather than keeping a second copy of it.
 */
const HAS_DETAIL = new Set<SlaState>(SLA_STATES_AT_STAKE);

/**
 * The state on its own, without a countdown — for places that name a state
 * rather than report one ticket's clock, like the filter menu.
 */
export function SlaStateLabel({ state }: { state: SlaState }) {
  const { t } = useI18n();
  const Icon = LOOK[state].icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-body text-ink">
      <span className={cn("inline-flex", TEXT_TONE[state])}>
        <Icon size={12} strokeWidth={2.5} />
      </span>
      {t(`sla.state.${state}`)}
    </span>
  );
}

/** Just the colour of each state, for uses that don't want the badge chrome. */
const TEXT_TONE: Record<SlaState, string> = {
  breached_open: "text-sla-breach",
  at_risk: "text-sla-risk-line",
  due_soon: "text-sla-soon",
  on_track: "text-sla-ok",
  breached_closed: "text-sla-breach-fg",
  met: "text-sla-met",
  no_sla: "text-sla-idle",
};

export function SlaBadge({
  sla,
  className,
}: {
  sla: SlaAssessment;
  className?: string;
}) {
  const { t } = useI18n();
  const look = LOOK[sla.state];
  const Icon = look.icon;
  const name = t(`sla.state.${sla.state}`);
  // "SLA: breached, still open, 2h 14m over" — the state in words, not just the
  // countdown, since the colour that would otherwise supply it is unavailable.
  const spoken = HAS_DETAIL.has(sla.state)
    ? t("sla.aria.detailed", { state: name, detail: sla.label })
    : t("sla.aria.plain", { state: name });

  return (
    <span
      role="img"
      aria-label={spoken}
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap text-caption",
        look.className,
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        <Icon size={11} strokeWidth={2.5} />
      </span>
      <span aria-hidden="true">{sla.label}</span>
    </span>
  );
}
