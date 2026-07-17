"use client";

import { useRouter } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { useCreateTicket } from "@/features/tickets/create-ticket-context";
import { useSearch } from "@/features/tickets/search-context";
import { useI18n } from "@/features/i18n/context";
import { useMobileNav } from "./mobile-nav-context";
import { LanguageToggle } from "./language-toggle";
import { NotificationsBell } from "./notifications-bell";

export function Topbar({
  title,
  titleKey,
  showSearch = true,
  right,
}: {
  title?: string;
  titleKey?: string;
  showSearch?: boolean;
  right?: React.ReactNode;
}) {
  const { open } = useCreateTicket();
  const { query, setQuery } = useSearch();
  const { t } = useI18n();
  const { toggle: toggleNav } = useMobileNav();
  const router = useRouter();
  const heading = title ?? (titleKey ? t(titleKey) : undefined);

  return (
    <header className="flex h-14 items-center gap-3.5 border-b border-line bg-panel px-4 lg:px-6">
      <button
        type="button"
        onClick={toggleNav}
        aria-label={t("nav.menu")}
        className="grid h-9 w-9 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app lg:hidden"
      >
        <Menu size={17} strokeWidth={2} />
      </button>

      {heading ? (
        <h1 className="truncate text-[17px] font-bold text-ink">{heading}</h1>
      ) : null}

      {showSearch ? (
        <div className="flex w-80 items-center gap-2 rounded-md border border-line bg-[#f4f6f9] px-3 py-[7px] text-[13px] focus-within:border-brand focus-within:bg-white">
          <Search size={14} strokeWidth={2} className="flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") router.push("/tickets");
            }}
            placeholder={t("topbar.search")}
            className="w-full bg-transparent text-ink placeholder:text-faint focus:outline-none"
          />
          <span className="ml-auto flex-none rounded border border-[#e2e8f0] bg-white px-1.5 py-px font-mono text-[10.5px] font-medium text-faint">
            ⌘K
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-2.5">
        {right}
        <LanguageToggle />
        <NotificationsBell />
        <button
          type="button"
          onClick={open}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-hover"
        >
          <Plus size={14} strokeWidth={2.4} />
          {t("topbar.newTicket")}
        </button>
      </div>
    </header>
  );
}
