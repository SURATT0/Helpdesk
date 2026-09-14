"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUsers } from "@/features/users/queries";
import { useCustomers } from "@/features/customers/queries";
import { PRIORITIES } from "@/lib/domain";
import { maySeeTeamWorkload } from "@/lib/permissions";
import { DISPLAY_STATUSES } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";
import { toneForName } from "../data";
import { useSearch, type AssigneeKey } from "../search-context";
import { SLA_STATES_AT_STAKE } from "../sla";
import { SlaStateLabel } from "./sla-badge";

const STATUSES = DISPLAY_STATUSES;

// `T` allows numbers as well as strings so the same control can list assignee
// ids alongside the `"none"` sentinel, not just string enums.
function FacetDropdown<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  renderOption,
}: {
  label: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  renderOption: (v: T) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const count = selected.size;
  const active = count > 0;

  /**
   * Which edge of the chip the menu hangs from, above `lg`.
   *
   * `left-0` alone cannot be right for every chip: the bar's chips march
   * rightwards, so the ones near the end open past the window no matter how
   * narrow the menu is — a 240px menu on a chip whose left edge sits at 818 of
   * 1024 overhangs by 34, and nothing on the page scrolls sideways to reach it.
   * Below `lg` the menu is a full-width sheet and none of this applies.
   *
   * Measured after the menu renders at its default edge, in a layout effect so
   * the correction lands before the browser paints rather than as a visible
   * jump. Reset on close, so the next open measures again from a known start
   * instead of inheriting the last chip's answer.
   */
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!open) {
      setAlignRight(false);
      return;
    }
    const el = panelRef.current;
    if (!el || !window.matchMedia("(min-width: 1024px)").matches) return;
    setAlignRight(
      el.getBoundingClientRect().right > document.documentElement.clientWidth,
    );
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-body",
          active
            ? "border-accent-line bg-accent-soft font-semibold text-brand-hover"
            : "border-dashed border-dim font-medium text-muted hover:border-faint",
        )}
      >
        {active ? null : <span className="leading-none">＋</span>}
        {label}
        {active ? (
          <span className="rounded-full bg-accent-edge px-1.5 text-meta font-semibold">
            {count}
          </span>
        ) : null}
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open ? (
        <>
          {/* A tap anywhere closes it. Dimmed below `lg`, where the panel covers
              the list as a sheet rather than sitting beside its chip. */}
          <div
            className="fixed inset-0 z-30 bg-ink/20 lg:z-10 lg:bg-transparent"
            onClick={() => setOpen(false)}
          />
          {/*
            A sheet from the bottom edge below `lg`, a menu beside the chip above it.

            It used to be `absolute left-0` at every width, anchored to the chip's
            left edge with no way to come back. The bar wraps on a narrow screen and
            the chips march rightwards on a wide one, so the panels at the right-hand
            end opened past the edge of the window — the SLA facet overhung by 43px
            at 375, Assignee by 16px at 768 — and since nothing on the page scrolls
            sideways, the clipped part could not be reached at all. Option labels
            like "Breached, still open" lost their ends.

            `lg` rather than the `sm` the closed log uses, because 768 is one of the
            widths that failed; it also lines the behaviour up with the sidebar,
            which is a drawer below exactly this breakpoint.

            `max-w` as well as `min-w`, because the menu is shrink-to-fit and the
            option labels are `truncate` — which is `white-space: nowrap`, so with
            nothing bounding the menu the label never truncates at all: it widens
            the menu instead, and `left-0` then pushes the far end off screen.
            Customer names are the ones long enough to do it, so the facet that
            failed depended on which tenants happened to exist. A bound is what
            makes `truncate` mean what it says.

            The bound alone is not enough — see `alignRight` above, which decides
            which edge of the chip this hangs from. Width and anchor are two
            separate halves of "stays on screen", and fixing only the width left
            the rightmost chips overhanging by less.
          */}
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className={cn(
              "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-lg border border-line bg-white p-2 shadow-modal lg:absolute lg:inset-x-auto lg:bottom-auto lg:top-full lg:z-20 lg:mt-1 lg:max-h-none lg:min-w-[190px] lg:max-w-[240px] lg:rounded-md lg:p-0 lg:py-1 lg:shadow-modal",
              // One or the other, never both in the class string: `cn` joins,
              // it does not merge, so emitting `lg:left-0` beside `lg:right-0`
              // would leave the winner to Tailwind's output order.
              alignRight ? "lg:right-0" : "lg:left-0",
            )}
          >
            <div className="mb-1 flex items-center justify-between px-1 lg:hidden">
              <span className="text-control font-semibold text-ink">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("filter.close")}
                className={cn("text-muted", TOUCH_TARGET)}
              >
                <X size={16} />
              </button>
            </div>
            {options.map((o) => {
              const checked = selected.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => onToggle(o)}
                  // Roomier rows on the sheet, where these are finger targets
                  // rather than something a cursor lands on precisely.
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left hover:bg-app lg:rounded-none lg:py-1.5"
                >
                  <span
                    className={cn(
                      "grid h-3.5 w-3.5 flex-none place-items-center rounded border",
                      checked
                        ? "border-brand bg-brand text-white"
                        : "border-dim",
                    )}
                  >
                    {checked ? <Check size={11} strokeWidth={3.5} /> : null}
                  </span>
                  {renderOption(o)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function FilterBar() {
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    query,
    setQuery,
    statuses,
    toggleStatus,
    priorities,
    togglePriority,
    assignees,
    toggleAssignee,
    customers: selectedCustomers,
    toggleCustomer,
    slaStates,
    toggleSla,
    clearFilters,
    activeCount,
  } = useSearch();

  // Only staff can read the user directory (user:read), and a requester only
  // ever sees their own tickets — an assignee facet would be meaningless there.
  const isStaff =
    user != null &&
    user.role !== "user";
  const { data: users = [] } = useUsers({ enabled: isStaff });
  /**
   * The tenant facet exists only for a viewer who reaches more than one.
   * With a single customer every ticket carries the same one, so the filter
   * could only ever show everything or nothing — a control with no useful
   * position is worse than no control.
   */
  const { data: customerOptions = [] } = useCustomers({ enabled: isStaff });
  const showCustomerFacet = isStaff && customerOptions.length > 1;
  const customerName = React.useMemo(
    () => new Map(customerOptions.map((c) => [c.id, c.name])),
    [customerOptions],
  );

  // Anyone who can hold a queue. Requesters raise tickets, they don't own them.
  const assignable = React.useMemo(
    () => users.filter((u) => u.role !== "user"),
    [users],
  );
  const nameById = React.useMemo(
    () => new Map(assignable.map((u) => [u.id, u.name])),
    [assignable],
  );

  /**
   * Who the facet may be pointed at.
   *
   * Narrowing the list to one colleague is how the ticket page answers "how big
   * is their queue" — every count on it follows the filter: the footer's "x of
   * y", the SLA tiles, the board's column headers. So the options are the same
   * set the API will accept (`ticketService.list` 403s the rest): the unassigned
   * queue, which belongs to nobody, yourself, and — for a super admin — anyone.
   *
   * Not a security measure. The server refuses either way; this keeps the menu
   * from offering a choice that would come back forbidden.
   */
  const assigneeOptions: AssigneeKey[] = React.useMemo(() => {
    const visible = maySeeTeamWorkload(user?.role)
      ? assignable
      : assignable.filter((u) => u.id === user?.id);
    return ["none", ...visible.map((u) => u.id)];
  }, [assignable, user]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
      <div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-line bg-white px-3 py-[7px] focus-within:border-brand sm:w-[260px]">
        <Search size={13} strokeWidth={2} className="flex-none text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filter.search")}
          className={cn(
            "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
            FIELD_TEXT_13,
          )}
        />
      </div>

      <FacetDropdown
        label={t("filter.status")}
        options={STATUSES}
        selected={statuses}
        onToggle={toggleStatus}
        renderOption={(s) => <StatusBadge status={s} />}
      />
      <FacetDropdown
        label={t("filter.priority")}
        options={PRIORITIES}
        selected={priorities}
        onToggle={togglePriority}
        renderOption={(p) => <PriorityIndicator priority={p} />}
      />
      <FacetDropdown
        label={t("filter.sla")}
        options={SLA_STATES_AT_STAKE}
        selected={slaStates}
        onToggle={toggleSla}
        renderOption={(s) => <SlaStateLabel state={s} />}
      />

      {showCustomerFacet ? (
        <FacetDropdown
          label={t("filter.customer")}
          options={customerOptions.map((c) => c.id)}
          selected={selectedCustomers}
          onToggle={toggleCustomer}
          renderOption={(id) => (
            // `min-w-0` beside the `truncate`, the way the assignee option below
            // already does it: a flex item's automatic minimum is its content,
            // so without this the name refuses to shrink and overflows the row
            // instead of ending in an ellipsis.
            <span className="min-w-0 truncate text-body text-ink">
              {customerName.get(id)}
            </span>
          )}
        />
      ) : null}

      {isStaff ? (
        <FacetDropdown
          label={t("filter.assignee")}
          options={assigneeOptions}
          selected={assignees}
          onToggle={toggleAssignee}
          renderOption={(a) =>
            a === "none" ? (
              <span className="text-body font-medium text-muted">
                {t("filter.unassigned")}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar
                  name={nameById.get(a) ?? "?"}
                  tone={toneForName(nameById.get(a) ?? "?")}
                  size={20}
                />
                <span className="truncate text-body text-ink">
                  {nameById.get(a)}
                  {user?.id === a ? (
                    <span className="text-faint"> · {t("filter.you")}</span>
                  ) : null}
                </span>
              </span>
            )
          }
        />
      ) : null}

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center gap-1 text-body font-medium text-muted hover:text-ink"
        >
          <X size={13} strokeWidth={2} />
          {t("filter.clear")}
        </button>
      ) : null}
    </div>
  );
}
