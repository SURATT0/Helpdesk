"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Ticket,
  Users,
  BarChart3,
  BookOpen,
  Settings,
  LogOut,
} from "lucide-react";
import { Logo } from "./logo";
import { Avatar } from "@/components/ui/avatar";
import { useMobileNav } from "./mobile-nav-context";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/tickets", key: "nav.tickets", icon: Ticket },
  { href: "/users", key: "nav.users", icon: Users },
  { href: "/reports", key: "nav.reports", icon: BarChart3 },
  { href: "/kb", key: "nav.kb", icon: BookOpen },
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
        {NAV.map(({ href, key, icon: Icon }) => {
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
          className="ml-auto grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app"
        >
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
      </aside>
    </>
  );
}
