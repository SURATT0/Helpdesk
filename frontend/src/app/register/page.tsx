"use client";

import * as React from "react";
import { register } from "@/features/auth/api";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthPasswordField,
  AuthShell,
  AuthSubmit,
} from "@/features/auth/components/auth-shell";
import { useI18n } from "@/features/i18n/context";
import { ApiError } from "@/lib/api-client";

/**
 * Self sign-up.
 *
 * On success this page shows the server's sentence and STAYS — it does not
 * redirect to /login, and it does not sign anybody in. Both would misrepresent
 * what just happened: the account is `pending` and cannot sign in until an
 * administrator approves it, so dropping the person on a sign-in form would send
 * them straight into a refusal they have no way to act on.
 *
 * The reply is also identical whether or not the address was already taken, so
 * there is nothing here to branch on — see the note in features/auth/api.ts.
 */
export default function RegisterPage() {
  const { t, lang } = useI18n();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  // Checked here for the immediate feedback, and again on the server, which is
  // the one that counts — this endpoint is reachable without this page.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setSubmitting(true);
    try {
      // The language the form was filled in decides which language the
      // confirmation mail is written in — otherwise it arrives in the desk's
      // default, which for this deployment is Thai, for somebody who has just
      // used the app in English.
      setDone(await register({ email, name, password, confirmPassword, lang }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("register.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthShell title={t("register.sentTitle")}>
        <div className="flex flex-col gap-4">
          <AuthNotice tone="success">{done}</AuthNotice>
          <div className="text-center">
            <AuthLink href="/login">{t("register.backToSignIn")}</AuthLink>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("register.title")}
      subtitle={t("register.subtitle")}
      footer={
        <>
          {t("register.haveAccount")} <AuthLink href="/login">{t("register.signIn")}</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <AuthError>{error}</AuthError> : null}

        <AuthField
          id="name"
          icon="user"
          label={t("register.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={120}
        />

        <AuthField
          id="email"
          icon="mail"
          type="email"
          label={t("register.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={254}
        />

        <AuthPasswordField
          id="password"
          label={t("register.password")}
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

        <AuthNotice>{t("register.approvalNotice")}</AuthNotice>

        <AuthSubmit disabled={submitting || mismatch}>
          {submitting ? t("register.submitting") : t("register.submit")}
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
