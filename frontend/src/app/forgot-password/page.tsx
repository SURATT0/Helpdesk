"use client";

import * as React from "react";
import { requestPasswordReset } from "@/features/auth/api";
import {
  AuthError,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
  AuthSubmit,
} from "@/features/auth/components/auth-shell";
import { useI18n } from "@/features/i18n/context";
import { ApiError } from "@/lib/api-client";

/**
 * Ask for a reset link.
 *
 * The success state is shown for EVERY address — one that has an account, one
 * that does not, one whose account has no password to reset. That is not
 * vagueness for its own sake: a page that said "no account with that address"
 * would let anyone type addresses into it until it told them who works here.
 *
 * So the only error this page can show is a transport or rate-limit failure.
 * There is deliberately no branch for "not found", because the server never
 * says it.
 */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      setDone(await requestPasswordReset(email));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("forgot.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthShell title={t("forgot.sentTitle")}>
        <div className="flex flex-col gap-4">
          <AuthNotice tone="success">{done}</AuthNotice>
          <AuthNotice>{t("forgot.checkSpam")}</AuthNotice>
          <div className="text-center">
            <AuthLink href="/login">{t("register.backToSignIn")}</AuthLink>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
      footer={<AuthLink href="/login">{t("register.backToSignIn")}</AuthLink>}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <AuthError>{error}</AuthError> : null}
        <AuthField
          id="email"
          icon="mail"
          type="email"
          label={t("login.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={254}
        />
        <AuthSubmit disabled={submitting}>
          {submitting ? t("forgot.submitting") : t("forgot.submit")}
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
