"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { FIELD_TEXT_13, Input } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { cn } from "@/lib/utils";
import { useCustomers } from "@/features/customers/queries";
import { useI18n } from "@/features/i18n/context";
import type { UserFilters, UserRole, UserStatus } from "../schemas";

/**
 * Narrow the directory: search, role, status, customer.
 *
 * Every control is a plain `<select>` rather than a custom dropdown, because
 * this is a filter bar and not a product surface — the native control is
 * keyboard-accessible, works on a phone, and needs no code to close itself.
 *
 * The customer filter appears only for viewers who reach more than one tenant.
 * For everyone else the column holds the same name on every row, so the filter
 * would offer a choice with one answer.
 */
export function UserFiltersBar({
  filters,
  onChange,
  showCustomer,
}: {
  filters: UserFilters;
  onChange: (next: UserFilters) => void;
  showCustomer: boolean;
}) {
  const { t } = useI18n();
  const { data: customers = [] } = useCustomers({ enabled: showCustomer });

  const set = <K extends keyof UserFilters>(key: K, value: UserFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const active =
    Boolean(filters.q) ||
    filters.role != null ||
    filters.status != null ||
    filters.customerId != null;

  const selectClass = cn(
    "rounded-md border border-edge bg-white px-2.5 py-2 text-ink",
    FIELD_TEXT_13,
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex min-w-[200px] flex-1 flex-col gap-1 sm:max-w-[320px]">
        <span className="text-caption font-medium text-faint">
          {t("users.search")}
        </span>
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            type="search"
            value={filters.q ?? ""}
            onChange={(e) => set("q", e.target.value || undefined)}
            placeholder={t("users.searchPlaceholder")}
            className="pl-9"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-medium text-faint">
          {t("users.role")}
        </span>
        <select
          aria-label={t("users.role")}
          value={filters.role ?? ""}
          onChange={(e) =>
            set("role", (e.target.value || undefined) as UserRole | undefined)
          }
          className={selectClass}
        >
          <option value="">{t("users.anyRole")}</option>
          <option value="super_admin">{t("role.super_admin")}</option>
          <option value="admin">{t("role.admin")}</option>
          <option value="user">{t("role.user")}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-medium text-faint">
          {t("users.status")}
        </span>
        <select
          aria-label={t("users.status")}
          value={filters.status ?? ""}
          onChange={(e) =>
            set(
              "status",
              (e.target.value || undefined) as UserStatus | undefined,
            )
          }
          className={selectClass}
        >
          <option value="">{t("users.anyStatus")}</option>
          <option value="active">{t("accountStatus.active")}</option>
          <option value="pending">{t("accountStatus.pending")}</option>
          <option value="suspended">{t("accountStatus.suspended")}</option>
          <option value="rejected">{t("accountStatus.rejected")}</option>
        </select>
      </label>

      {showCustomer ? (
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-faint">
            {t("users.customer")}
          </span>
          <select
            aria-label={t("users.customer")}
            value={filters.customerId ?? ""}
            onChange={(e) =>
              set(
                "customerId",
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
            className={selectClass}
          >
            <option value="">{t("users.anyCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {active ? (
        <button
          type="button"
          onClick={() => onChange({})}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-body font-medium text-muted hover:bg-app hover:text-ink",
            TOUCH_TARGET,
          )}
        >
          <X size={14} />
          {t("users.clearFilters")}
        </button>
      ) : null}
    </div>
  );
}
