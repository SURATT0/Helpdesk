"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/features/auth/api";
import { useAuth } from "@/features/auth/context";
import {
  AuthError,
  AuthNotice,
  AuthPasswordField,
  AuthShell,
  AuthSubmit,
} from "@/features/auth/components/auth-shell";
import { useI18n } from "@/features/i18n/context";
import { apiErrorMessage } from "@/lib/api-error";

/**
 * Choose your own password.
 *
 * Serves two arrivals, and tells them apart by `mustChangePassword` rather than
 * by the route they came from. Somebody whose account was created for them is
 * SENT here by `RequireAuth` and cannot leave — the API refuses them every other
 * route until this form succeeds — so the page says why, and offers no way back.
 * Somebody who came from Settings of their own accord gets the same form with a
 * cancel beside it.
 *
 * Outside the `(app)` group on purpose. The forced case has no session the shell
 * would tolerate: every query the sidebar and topbar fire would come back
 * `PASSWORD_CHANGE_REQUIRED`, so the page must not be inside the thing that
 * fires them.
 *
 * On success this signs them straight back in — see `changePassword` in api.ts —
 * unlike the reset form, which deliberately does not.
 */
export default function ChangePasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, user, patchUser } = useAuth();

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const forced = user?.mustChangePassword === true;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  // Caught here as well as on the server, because the server's refusal costs a
  // round trip and arrives as a sentence about a rule this form could have
  // stated up front. The server still checks — see `changePassword`.
  const unchanged = password.length > 0 && password === currentPassword;

  // No session at all: the person signed out in another tab, or opened the URL
  // cold. Nothing on this page can work without a token.
  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mismatch || unchanged) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await changePassword({
        currentPassword,
        password,
        confirmPassword,
      });
      // The flag is gone on the session just returned, which is what releases
      // the guard in RequireAuth. Pushing it into the context BEFORE navigating
      // matters: leave the stale user in place and the shell bounces straight
      // back here.
      patchUser(updated);
      router.replace("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, t, "changePassword.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== "authenticated") {
    return <AuthShell title="…" />;
  }

  return (
    <AuthShell
      title={t("changePassword.title")}
      subtitle={
        forced ? t("changePassword.forcedSubtitle") : t("changePassword.subtitle")
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {forced ? (
          <AuthNotice>{t("changePassword.forcedNotice")}</AuthNotice>
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthPasswordField
          id="currentPassword"
          label={t("changePassword.current")}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          showLabel={t("login.showPassword")}
          hideLabel={t("login.hidePassword")}
        />

        <AuthPasswordField
          id="password"
          label={t("changePassword.new")}
          hint={t("register.passwordHint")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          aria-invalid={unchanged}
          showLabel={t("login.showPassword")}
          hideLabel={t("login.hidePassword")}
        />
        {unchanged ? (
          <p role="alert" className="-mt-2 text-dense font-medium text-danger-ink">
            {t("changePassword.sameAsCurrent")}
          </p>
        ) : null}

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

        {/* Said before they submit, not after they are logged out of the other
            three. Replacing a password somebody else chose is precisely when a
            session opened with it elsewhere has to end. */}
        <AuthNotice>{t("changePassword.signOutNotice")}</AuthNotice>

        <AuthSubmit disabled={submitting || mismatch || unchanged}>
          {submitting
            ? t("changePassword.submitting")
            : t("changePassword.submit")}
        </AuthSubmit>

        {/* Only for somebody who chose to be here. The forced case has nowhere
            to cancel TO — every other route is refused. */}
        {forced ? null : (
          <button
            type="button"
            onClick={() => router.back()}
            className="text-center text-control font-semibold text-subtle hover:text-ink"
          >
            {t("common.cancel")}
          </button>
        )}
      </form>
    </AuthShell>
  );
}
