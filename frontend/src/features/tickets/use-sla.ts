"use client";

import * as React from "react";
import { useI18n } from "@/features/i18n/context";
import { assessSla, type SlaAssessment, type SlaInput, type SlaLabels } from "./sla";

/** How often the countdown re-reads the clock. */
const TICK_MS = 60_000;

/**
 * A clock that advances once a minute. The SLA column counts down, so without
 * this a tab left open all afternoon would still claim "42m left" — the labels
 * are minute-granular, so re-reading any faster only costs renders.
 */
export function useSlaNow(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The dictionary words `assessSla` builds its labels from, in the active locale. */
export function useSlaLabels(): SlaLabels {
  const { t } = useI18n();
  return React.useMemo(
    () => ({
      // The duration units are shared with the closed log rather than duplicated:
      // "d"/"h"/"m" must not be able to differ between two tables.
      units: {
        d: t("closedLog.unit.d"),
        h: t("closedLog.unit.h"),
        m: t("closedLog.unit.m"),
      },
      over: t("sla.over"),
      left: t("sla.left"),
      missed: t("sla.missed"),
      met: t("sla.met"),
      none: t("sla.none"),
    }),
    [t],
  );
}

/**
 * One judging function for the whole page, so the badges, the row stripes, the
 * sort order and the summary counts can never disagree about a ticket — they all
 * read the same clock and the same thresholds.
 */
export function useAssessSla(): (ticket: SlaInput) => SlaAssessment {
  const labels = useSlaLabels();
  const now = useSlaNow();
  return React.useCallback(
    (ticket: SlaInput) => assessSla(ticket, labels, now),
    [labels, now],
  );
}
