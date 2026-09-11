"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "@/features/auth/api";
import {
  AuthError,
  AuthLink,
  AuthNotice,
  AuthPasswordField,
  AuthShell,
  AuthSubmit,
} from "@/features/auth/components/auth-shell";
import { useI18n } from "@/features/i18n/context";
import { ApiError } from "@/lib/api-client";

/**
 * Set a new password from a mailed link.
 *
 * The token arrives in the query string and is POSTed from here rather than
 * being acted on by the GET that loaded the page. That is what stops a mail
 * scanner, a link previewer or a corporate proxy from burning a single-use
 * token before its owner has clicked anything.
 *
 * On success this does NOT sign the person in. The reset just revoked every
 * session the account had — including whoever's access prompted it — and issuing
 * a fresh one here would undo that. They sign in with the new password, which
 * also proves it is the one they meant to set.
 */
function ResetPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const token = useSearchParams().get("token");

  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || mismatch) return;
    setError(null);
    setSubmitting(true);
    try {
      setDone(await resetPassword({ token, password, confirmPassword }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("reset.error"));
    } finally {
      setSubmitting(false);
    }
  }

  // No token in the URL at all — a hand-typed address, or a link a mail client
  // truncated. Say so plainly rather than showing a form that cannot succeed.
  if (!token) {
    return (
      <AuthShell title={t("reset.invalidTitle")}>
        <div className="flex flex-col gap-4">
          <AuthError>{t("reset.noToken")}</AuthError>
          <div className="text-center">
            <AuthLink href="/forgot-password">{t("reset.requestNew")}</AuthLink>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t("reset.doneTitle")}>
        <div className="flex flex-col gap-4">
          <AuthNotice tone="success">{done}</AuthNotice>
          <button
            type="button"
            onClick={() => router.replace("/login")}
            className="rounded-md bg-brand py-2.5 text-center text-lead font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            {t("register.signIn")}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("reset.title")} subtitle={t("reset.subtitle")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? (
          <div className="flex flex-col gap-2">
            <AuthError>{error}</AuthError>
            <AuthLink href="/forgot-password">{t("reset.requestNew")}</AuthLink>
          </div>
        ) : null}

        <AuthPasswordField
          id="password"
          label={t("reset.newPassword")}
          hint={t("register.passwordHint")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          showLabel={t("login.showPassword")}
          hideLabel={t("login.hidePassword")}
        />

        <AuthPasswordField
          id="confirmPassword"
          label={t("register.confirmPassword")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch}
          showLabel={t("login.showPassword")}
          hideLabel={t("login.hidePassword")}
        />
        {mismatch ? (
          <p role="alert" className="-mt-2 text-dense font-medium text-danger-ink">
            {t("register.mismatch")}
          </p>
        ) : null}

        <AuthNotice>{t("reset.signOutNotice")}</AuthNotice>

        <AuthSubmit disabled={submitting || mismatch}>
          {submitting ? t("reset.submitting") : t("reset.submit")}
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}

/**
 * `useSearchParams` opts a route into client-side rendering, and Next requires
 * the boundary to be explicit. The fallback is the same card with no form, so
 * the page does not flash a different layout while it resolves.
 */
export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<AuthShell title="…" />}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}
