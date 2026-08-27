"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import {
  calendarDays,
  matchPreset,
  orderRange,
  presetRange,
  sameDay,
  startOfMonth,
  stepRange,
  PRESETS,
  type DateRange,
  type PresetKey,
} from "../date-range";

const locale = (lang: string) => (lang === "th" ? "th-TH" : "en-US");

/**
 * The chosen span, written the way the locale writes a range: "20 – 26 ก.ค. 2569"
 * in Thai, "Jul 20 – 26, 2026" in English. `formatRange` collapses whatever the
 * two ends share — the month, or the month and the year — so a range inside one
 * month does not repeat it, and one that crosses a year names both.
 *
 * The year follows the locale's own calendar, which in Thai is the Buddhist era.
 * The section headings below the list already do; two eras on one screen would be
 * two answers to the same question.
 */
export function formatRangeLabel(range: DateRange, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatRange(range.start, range.end);
}

/** Mon–Sun initials for the calendar header, from the locale itself. */
function weekdayInitials(lang: string): string[] {
  const format = new Intl.DateTimeFormat(locale(lang), { weekday: "narrow" });
  // 5 Jan 1970 was a Monday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(1970, 0, 5 + i)),
  );
}

function Calendar({
  month,
  onMonthChange,
  range,
  pendingStart,
  onPick,
  lang,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  range: DateRange | null;
  pendingStart: Date | null;
  onPick: (day: Date) => void;
  lang: string;
}) {
  const { t } = useI18n();
  const days = React.useMemo(() => calendarDays(month), [month]);
  const monthLabel = new Intl.DateTimeFormat(locale(lang), {
    month: "long",
    year: "numeric",
  }).format(month);
  const dayLabel = new Intl.DateTimeFormat(locale(lang), { dateStyle: "long" });

  return (
    <div className="w-[248px]">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label={t("range.prevMonth")}
          className="rounded-md p-1 text-muted hover:bg-app"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-body font-semibold text-ink">{monthLabel}</span>
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label={t("range.nextMonth")}
          className="rounded-md p-1 text-muted hover:bg-app"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-eyebrow font-semibold text-faint">
        {weekdayInitials(lang).map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const outside = day.getMonth() !== month.getMonth();
          const isStart = range ? sameDay(day, range.start) : false;
          const isEnd = range ? sameDay(day, range.end) : false;
          const within =
            range != null &&
            day.getTime() > range.start.getTime() &&
            day.getTime() < range.end.getTime();
          const pending = pendingStart ? sameDay(day, pendingStart) : false;
          return (
            <button
              key={day.getTime()}
              type="button"
              onClick={() => onPick(day)}
              aria-label={dayLabel.format(day)}
              aria-pressed={isStart || isEnd || within}
              className={cn(
                "h-8 text-dense tabular-nums",
                outside ? "text-faint" : "text-ink",
                within && "bg-accent-soft",
                (isStart || isEnd || pending) &&
                  "rounded-md bg-brand font-semibold text-white",
                !isStart && !isEnd && !pending && !within && "hover:bg-app",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pick a span of days to narrow the log to.
 *
 * Presets sit beside the calendar rather than inside it because they answer the
 * common questions outright ("the last week", "this year") — the calendar is for
 * the span nobody has a name for. Picking either one leaves the control in the
 * same state, so there is no mode to get stuck in: a preset click sets a range, a
 * calendar click sets a range, and the label reads the range.
 */
export function DateRangePicker({
  value,
  onChange,
  today,
}: {
  value: DateRange | null;
  onChange: (next: DateRange | null) => void;
  /** Injectable so "last 7 days" is testable and does not drift mid-session. */
  today: Date;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() =>
    startOfMonth(value?.end ?? today),
  );
  /** First click of a custom span, waiting for its second. */
  const [pendingStart, setPendingStart] = React.useState<Date | null>(null);

  const activePreset = value ? matchPreset(value, today) : null;

  // Reopening should show the span being edited, not wherever the calendar was
  // left last time.
  React.useEffect(() => {
    if (open) setMonth(startOfMonth(value?.end ?? today));
  }, [open, value, today]);

  const pickDay = (day: Date) => {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    onChange(orderRange(pendingStart, day));
    setPendingStart(null);
    setOpen(false);
  };

  const choosePreset = (preset: PresetKey) => {
    onChange(presetRange(preset, today));
    setPendingStart(null);
    setOpen(false);
  };

  return (
    <div className="flex flex-none items-center gap-1">
      {/* The stepper only exists once there is a span to step. */}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(stepRange(value, -1))}
          aria-label={t("range.earlier")}
          className="rounded-md border border-line bg-panel p-1.5 text-muted hover:bg-app"
        >
          <ChevronLeft size={14} />
        </button>
      ) : null}

      <div className="relative">
        <button
          type="button"
          // The accessible name is the value, which is right for a screen reader
          // but says nothing a test can hold onto — in Thai the label starts with
          // a digit, exactly like every button in the year jump bar.
          data-testid="date-range"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-body font-medium",
            value
              ? "border-brand bg-accent-soft text-brand-hover"
              : "border-line bg-panel text-muted hover:bg-app",
          )}
        >
          <CalendarDays size={13} />
          {value ? formatRangeLabel(value, lang) : t("range.any")}
        </button>

        {open ? (
          <>
            <div
              className="fixed inset-0 z-30 bg-ink/20 sm:bg-transparent"
              onClick={() => {
                setOpen(false);
                setPendingStart(null);
              }}
            />
            <div
              role="dialog"
              aria-label={t("range.title")}
              className="fixed inset-x-0 bottom-0 z-40 rounded-t-lg border border-line bg-panel p-3 shadow-modal sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-auto sm:rounded-lg sm:shadow-card"
            >
              <div className="mb-2 flex items-center justify-between sm:hidden">
                <span className="text-control font-semibold text-ink">
                  {t("range.title")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setPendingStart(null);
                  }}
                  aria-label={t("range.close")}
                  className="text-muted"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-row flex-wrap gap-1 sm:w-36 sm:flex-col sm:flex-nowrap">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={activePreset === preset}
                      onClick={() => choosePreset(preset)}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-left text-body",
                        activePreset === preset
                          ? "bg-accent-soft font-semibold text-brand-hover"
                          : "text-ink hover:bg-app",
                      )}
                    >
                      {t(`range.preset.${preset}`)}
                    </button>
                  ))}
                  {/* Always meaningful: it is the current state when nothing is
                      picked, and the way out when something is. */}
                  <button
                    type="button"
                    aria-pressed={value == null}
                    onClick={() => {
                      onChange(null);
                      setPendingStart(null);
                      setOpen(false);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-left text-body",
                      value == null
                        ? "bg-accent-soft font-semibold text-brand-hover"
                        : "text-ink hover:bg-app",
                    )}
                  >
                    {t("range.any")}
                  </button>
                </div>

                <div className="sm:border-l sm:border-line sm:pl-3">
                  {/* The calendar IS the custom option, so it is labelled rather
                      than hidden behind a "custom" button that would only be a
                      mode switch to somewhere already on screen. */}
                  <div
                    className={cn(
                      "mb-1 text-meta font-semibold tracking-columns",
                      value != null && activePreset === null
                        ? "text-brand-hover"
                        : "text-faint",
                    )}
                  >
                    {t("range.custom")}
                  </div>
                  <Calendar
                    month={month}
                    onMonthChange={setMonth}
                    range={value}
                    pendingStart={pendingStart}
                    onPick={pickDay}
                    lang={lang}
                  />
                  <p className="mt-1 text-center text-meta text-faint">
                    {pendingStart
                      ? t("range.pickEnd")
                      : t("range.pickStart")}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {value ? (
        <button
          type="button"
          onClick={() => onChange(stepRange(value, 1))}
          aria-label={t("range.later")}
          className="rounded-md border border-line bg-panel p-1.5 text-muted hover:bg-app"
        >
          <ChevronRight size={14} />
        </button>
      ) : null}
    </div>
  );
}
