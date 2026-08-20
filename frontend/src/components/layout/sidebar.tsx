"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  LayoutDashboard,
  Ticket,
  Users,
  FolderKanban,
  BarChart3,
  BookOpen,
  ScrollText,
  ShieldCheck,
  Settings,
  LogOut,
} from "lucide-react";
import type { Role } from "@/features/auth/schemas";
import { Logo } from "./logo";
import { Avatar } from "@/components/ui/avatar";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useMobileNav } from "./mobile-nav-context";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

/**
 * `roles` restricts who sees the entry. Omitted = everyone. This only hides
 * links that would be refused anyway — the API permission check is the real
 * gate, and the page itself also handles the forbidden case for a direct visit.
 */
const NAV: Array<{
  href: string;
  key: string;
  icon: typeof LayoutDashboard;
  roles?: readonly Role[];
}> = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/tickets", key: "nav.tickets", icon: Ticket },
  // No `roles`: the closed-ticket log is a ticket read, so repository row
  // scoping already narrows it — a requester sees their own closed tickets.
  { href: "/history", key: "nav.history", icon: Archive },
  { href: "/users", key: "nav.users", icon: Users },
  // Mirrors the server's project:read grant (manager + admin), like the audit
  // entry below. Routing projects are management structure, not desk work.
  {
    href: "/projects",
    key: "nav.projects",
    icon: FolderKanban,
    roles: ["super_admin"],
  },
  { href: "/reports", key: "nav.reports", icon: BarChart3 },
  { href: "/kb", key: "nav.kb", icon: BookOpen },
  // Mirrors the server's audit:read grant (manager + admin).
  { href: "/audit", key: "nav.audit", icon: ScrollText, roles: ["super_admin"] },
  { href: "/permissions", key: "nav.permissions", icon: ShieldCheck },
  { href: "/settings", key: "nav.settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { open, setOpen } = useMobileNav();

  return (
    <>
      {/* Backdrop — only present as the mobile drawer overlay */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-line bg-panel px-3 py-4 transition-transform lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
      <div className="px-2 pb-4 pt-1">
        <Logo />
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.filter(
          ({ roles }) => !roles || (user != null && roles.includes(user.role)),
        ).map(({ href, key, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-[#e4f2ea] font-semibold text-brand-hover"
                  : "text-[#475569] hover:bg-app",
              )}
            >
              <Icon size={15} strokeWidth={2} />
              {t(key)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-[9px] border border-line bg-[#fafbfc] p-2.5">
        <Avatar name={user?.name ?? "…"} size={30} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12.5px] font-semibold text-ink">
            {user?.name ?? "…"}
          </div>
          <div className="truncate text-[11px] text-faint">
            {user ? t(`role.${user.role}`) : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          aria-label={t("sidebar.signOut")}
          title={t("sidebar.signOut")}
          className={cn(
            "ml-auto grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app",
            TOUCH_TARGET,
          )}
        >
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
      </aside>
    </>
  );
}
