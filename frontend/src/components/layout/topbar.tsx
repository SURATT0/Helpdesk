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
    <header className="flex min-h-topbar flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-panel px-4 py-2.5 lg:h-topbar lg:flex-nowrap lg:px-6 lg:py-0">
      <button
        type="button"
        onClick={toggleNav}
        aria-label={t("nav.menu")}
        className={cn(
          "grid h-9 w-9 flex-none place-items-center rounded-md border border-line text-subtle hover:bg-app lg:hidden",
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
        <h1 className="min-w-0 truncate text-page font-bold text-ink">
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
          <span className="ml-auto hidden flex-none rounded border border-edge bg-white px-1.5 py-px font-mono text-eyebrow font-medium text-faint lg:inline">
            ⌘K
          </span>
        </div>
      ) : null}

      {showNewTicket ? (
        <>
          {/* The busiest page gets its two ACTIONS pinned to the first row.
              Measured before this split: at 375px the header wrapped to three
              rows and stood 145px tall — 2.5x the desktop 57px — with the bell
              and New Ticket landing on the third of them, around y=100. They
              are what a person came to the page to press, so they go where the
              thumb already is instead of below two rows of settings.

              One instance, moved by flex order — NOT a second copy hidden at
              the other breakpoint. `NotificationsBell` opens an SSE connection
              per mount ("Mount once in the app shell", says the hook), and a
              browser allows about six per origin; the comment stream already
              holds one. */}
          {/* `order` is what keeps the desktop byte-identical. Splitting the
              group puts the actions FIRST in the DOM, which at a width where
              everything fits on one line would reorder the controls on screen —
              so from md up the two groups are ordered back the way they were
              written, and the actions give up `ml-auto` to the group that now
              precedes them. */}
          <div className="ml-auto flex flex-none items-center gap-2 md:order-2 md:ml-0">
            <NotificationsBell />
            <button
              type="button"
              onClick={open}
              // Labelled even where the text is hidden, so the control keeps
              // its name for a screen reader and for the E2E suite.
              aria-label={t("topbar.newTicket")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-control font-semibold text-white hover:bg-brand-hover sm:px-3.5",
                // A MINIMUM, not the fixed square `TOUCH_TARGET` gives: with its
                // label showing this button is ~110px wide and must stay that
                // way, but stripped to an icon it collapsed to 38x30 — under the
                // 44px floor, which `touch-affordances.spec.ts` caught.
                "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
              )}
            >
              <Plus size={14} strokeWidth={2.4} />
              {/* Icon-only on the narrowest screens: the label is ~70px, which
                  is the difference between this row fitting and wrapping. */}
              <span className="hidden sm:inline">{t("topbar.newTicket")}</span>
            </button>
          </div>

          {/* Everything else takes a row of its own below, rather than
              competing with the actions for the first one — but only where the
              row was actually overflowing. At 768px the header already fitted on
              one line at 57px, and forcing a second row there would have made a
              size that was fine 43px taller. */}
          <div className="order-last flex w-full flex-wrap items-center justify-end gap-2.5 md:order-1 md:ml-auto md:w-auto">
            {right}
            <LanguageToggle />
          </div>
        </>
      ) : (
        /* Every other page keeps the original single group untouched: it wraps
           internally and stays shrinkable, so a page that hands in more controls
           than fit spills onto a second line instead of off the screen. Never
           `flex-none` here — that pins the group at its full width and pushes
           whatever does not fit past the right edge. */
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
          {right}
          <LanguageToggle />
          <NotificationsBell />
        </div>
      )}
    </header>
  );
}
