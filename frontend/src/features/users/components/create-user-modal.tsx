"use client";

import * as React from "react";
import { Loader2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13, Input, Label } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useCustomers } from "@/features/customers/queries";
import { useI18n } from "@/features/i18n/context";
import { useCreateUser } from "../queries";
import type { UserRole } from "../schemas";

/**
 * Create an account for somebody who has not signed up.
 *
 * The other way into the desk, beside the sign-up form and its approval queue,
 * and the same decision made in a different order: the queue answers "which
 * tenant, which role" about a person who applied, and this asks it about a
 * person who has not. Both are platform-wide only, for the reason stated on
 * `mayApproveRegistration` — choosing somebody's tenant is the act being gated,
 * not the row being written.
 *
 * The password is typed here and handed over by whoever typed it. Nothing is
 * mailed: the password IS the credential, and a copy of it sitting in an inbox
 * is exactly what makes a "temporary" password permanent. The account is created
 * flagged, so the only thing it can do with this password is replace it.
 */
export function CreateUserModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data: customers = [] } = useCustomers();
  const create = useCreateUser();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [customerId, setCustomerId] = React.useState<number | null>(null);
  const [role, setRole] = React.useState<UserRole>("user");
  const [error, setError] = React.useState<string | null>(null);

  // Matches the server's rule, which is the one that counts — see `password` in
  // auth.validators.ts for why length and nothing else.
  const tooShort = password.length > 0 && password.length < 10;
  const ready =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 10 &&
    customerId != null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || customerId == null || create.isPending) return;
    setError(null);
    create.mutate(
      { name: name.trim(), email: email.trim(), password, role, customerId },
      {
        onSuccess: onClose,
        onError: (err) => setError(apiErrorMessage(err, t, "createUser.error")),
      },
    );
  }

  return (
    <Dialog open onClose={onClose} labelledBy="create-user-heading" align="start">
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2
            id="create-user-heading"
            className="text-h3 font-semibold text-ink"
          >
            {t("createUser.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("createUser.close")}
            className={cn(
              TOUCH_TARGET,
              "-m-2 grid place-items-center rounded-md text-faint hover:text-ink",
            )}
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-4 overflow-y-auto px-5 py-4"
          noValidate
        >
          <p className="text-body leading-relaxed text-muted">
            {t("createUser.blurb")}
          </p>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-danger-edge bg-danger-bg px-3 py-2.5 text-body font-medium text-danger-ink"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-name">{t("createUser.name")}</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-email">{t("createUser.email")}</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              maxLength={254}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-password">
              {t("createUser.tempPassword")}
            </Label>
            {/* Shown in the clear, not masked. Whoever types it has to read it
                back to the person it is for — masking would only mean typing it
                twice and hoping. It is about to be spoken aloud anyway; that is
                what the flag on the account exists to survive. */}
            <Input
              id="new-user-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              aria-invalid={tooShort}
              aria-describedby="new-user-password-hint"
            />
            <p id="new-user-password-hint" className="text-caption text-faint">
              {t("register.passwordHint")}
            </p>
            {tooShort ? (
              <p role="alert" className="text-dense font-medium text-danger-ink">
                {t("createUser.tooShort")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-customer">
              {t("approvals.customer")}
            </Label>
            {/* No pre-selected customer, exactly as in the approval queue: the
                click it would save is the decision itself. */}
            <select
              id="new-user-customer"
              value={customerId ?? ""}
              onChange={(e) =>
                setCustomerId(e.target.value ? Number(e.target.value) : null)
              }
              className={cn(
                "rounded-md border border-edge bg-white px-2.5 py-2 text-ink",
                FIELD_TEXT_13,
              )}
            >
              <option value="">{t("approvals.choose")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-role">{t("approvals.role")}</Label>
            <select
              id="new-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={cn(
                "rounded-md border border-edge bg-white px-2.5 py-2 text-ink",
                FIELD_TEXT_13,
              )}
            >
              <option value="user">{t("role.user")}</option>
              <option value="admin">{t("role.admin")}</option>
              <option value="super_admin">{t("role.super_admin")}</option>
            </select>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-soft/40 px-3 py-2.5 text-body leading-relaxed text-muted">
            <ShieldAlert size={15} className="mt-[2px] flex-none text-[#166534]" />
            {t("createUser.handoverNotice")}
          </div>

          <div className="flex justify-end gap-2 border-t border-hairline pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("createUser.submitting")}
                </>
              ) : (
                t("createUser.submit")
              )}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
