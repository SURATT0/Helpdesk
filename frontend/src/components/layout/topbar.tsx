"use client";

import { useRouter } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useCreateTicket } from "@/features/tickets/create-ticket-context";
import { useSearch } from "@/features/tickets/search-context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useMobileNav } from "./mobile-nav-context";
import { LanguageToggle } from "./language-toggle";
import { NotificationsBell } from "./notifications-bell";

export function Topbar({
  title,
  titleKey,
  showSearch = true,
  showNewTicket = false,
  right,
}: {
  title?: string;
  titleKey?: string;
  showSearch?: boolean;
  /**
   * Raising a ticket belongs on the tickets page, so this is opt-in — the
   * opposite default to `showSearch`, which pages opt out of. The button is the
   * only entry point to the create-ticket modal, so whichever page sets this is
   * the only place a ticket can be raised from.
   */
  showNewTicket?: boolean;
  right?: React.ReactNode;
}) {
  const { open } = useCreateTicket();
  const { query, setQuery } = useSearch();
  const { t } = useI18n();
  const { toggle: toggleNav } = useMobileNav();
  const router = useRouter();
  const heading = title ?? (titleKey ? t(titleKey) : undefined);

  return (
    // One row at lg+, exactly as designed. Below that the header WRAPS instead
    // of holding one row: the busiest page (Tickets) puts a title, an import
    // button, a view toggle, the language switch, the bell and New Ticket in
    // here, which is ~520px of controls — no phone fits that on a line, and
    // anything that refuses to wrap simply pushes the last controls off the
    // right edge where they cannot be reached or scrolled to.
    <header className="flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-panel px-4 py-2.5 lg:h-14 lg:flex-nowrap lg:px-6 lg:py-0">
      <button
        type="button"
        onClick={toggleNav}
        aria-label={t("nav.menu")}
        className={cn(
          "grid h-9 w-9 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app lg:hidden",
          TOUCH_TARGET,
        )}
      >
        <Menu size={17} strokeWidth={2} />
      </button>

      {heading ? (
        // `min-w-0` is what makes `truncate` actually bite: a nowrap flex item
        // defaults to `min-width: auto`, so without it the heading holds its
        // full width and pushes the controls on the right off the header
        // instead of clipping itself. Long Thai page names hit this first.
        <h1 className="min-w-0 truncate text-[17px] font-bold text-ink">
          {heading}
        </h1>
      ) : null}

      {showSearch ? (
        // Below lg the box takes a row of its own (`order-last w-full`) rather
        // than competing with the controls for the first row — squeezed into
        // what was left it rendered about 100px wide, which is under two words
        // of a query. At lg+ it is back inline at the design's 320px.
        <div className="order-last flex w-full min-w-0 items-center gap-2 rounded-md border border-line bg-[#f4f6f9] px-3 py-[7px] focus-within:border-brand focus-within:bg-white lg:order-none lg:w-80">
          <Search size={14} strokeWidth={2} className="flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") router.push("/tickets");
            }}
            placeholder={t("topbar.search")}
            className={cn(
              "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
              FIELD_TEXT_13,
            )}
          />
          {/* Hidden where there is no keyboard to press it with — on a phone the
              hint is both untrue and 30px of the search box's width. */}
          <span className="ml-auto hidden flex-none rounded border border-[#e2e8f0] bg-white px-1.5 py-px font-mono text-[10.5px] font-medium text-faint lg:inline">
            ⌘K
          </span>
        </div>
      ) : null}

      {/* Wraps internally and stays shrinkable, so a page that hands in more
          controls than fit spills onto a second line instead of off the screen.
          Never `flex-none` here: that pins the group at its full width and
          pushes whatever does not fit past the right edge. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
        {right}
        <LanguageToggle />
        <NotificationsBell />
        {showNewTicket ? (
          <button
            type="button"
            onClick={open}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-hover"
          >
            <Plus size={14} strokeWidth={2.4} />
            {t("topbar.newTicket")}
          </button>
        ) : null}
      </div>
    </header>
  );
}
