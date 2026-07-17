"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { Input, Label } from "@/components/ui/input";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { ApiError } from "@/lib/api-client";

export default function LoginPage() {
  const { login, status } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showForgot, setShowForgot] = React.useState(false);
  const [email, setEmail] = React.useState("dana.reyes@acme.com");
  const [password, setPassword] = React.useState("");

  // Already signed in (or just signed in) → leave the login screen.
  React.useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function signIn(emailValue: string, passwordValue: string) {
    setError(null);
    setSubmitting(true);
    try {
      await login(emailValue, passwordValue);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void signIn(email, password);
  }

  // One-click demo: fill the seeded credentials and sign in immediately.
  function demoLogin() {
    setEmail("dana.reyes@acme.com");
    setPassword("password123");
    void signIn("dana.reyes@acme.com", "password123");
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-app p-6">
      {/* Soft brand glow behind the card */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px 420px at 50% -8%, rgba(63,143,94,.18), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand + language */}
        <div className="mb-6 flex items-center justify-between">
          <Logo size={34} />
          <LanguageToggle />
        </div>

        <div className="rounded-[14px] border border-line bg-panel p-8 shadow-card">
          <div className="mb-6">
            <h1 className="text-[22px] font-bold tracking-[-0.01em] text-ink">
              {t("login.welcome")}
            </h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              {t("login.useCorporate")}
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {error ? (
              <div
                role="alert"
                className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-[12.5px] font-medium text-[#b91c1c]"
              >
                {error}
              </div>
            ) : null}

            <div>
              <Label htmlFor="email">{t("login.email")}</Label>
              <div className="relative">
                <Mail
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">{t("login.password")}</Label>
                <button
                  type="button"
                  onClick={() => setShowForgot((v) => !v)}
                  aria-expanded={showForgot}
                  className="mb-1.5 text-[12px] font-medium text-brand hover:text-brand-hover hover:underline"
                >
                  {t("login.forgot")}
                </button>
              </div>
              {showForgot ? (
                <div className="mb-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-[#166534]">
                  {t("login.forgotHint")}
                </div>
              ) : null}
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? t("login.hidePassword") : t("login.showPassword")
                  }
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-faint hover:text-muted"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 rounded-md bg-brand py-2.5 text-center text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
            >
              {submitting ? t("login.submitting") : t("login.signIn")}
            </button>

            <button
              type="button"
              onClick={demoLogin}
              disabled={submitting}
              className="rounded-md border border-line bg-white py-2.5 text-center text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:text-ink disabled:opacity-60"
            >
              {t("login.demoLogin")}
            </button>
          </form>
        </div>

        <div className="mt-5 text-center text-[11.5px] leading-relaxed text-faint">
          {t("login.demo", { pw: "password123" })}
        </div>
      </div>
    </div>
  );
}
