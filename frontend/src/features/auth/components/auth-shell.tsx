"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { Input, Label } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { cn } from "@/lib/utils";

/**
 * The card every signed-out screen sits in: sign in, register, forgot password,
 * reset password, confirm address.
 *
 * Extracted rather than copied five times because these pages are the first
 * thing anyone sees and the ONE place a visual inconsistency is unmissable — a
 * card 8px wider on /register than on /login, or a logo that shifts when the
 * form changes. Keeping the frame in one file means the pages differ only where
 * they are meant to: in what they ask for.
 *
 * `p-6` on the outer grid rather than a fixed width is what makes 375px work:
 * the card is `max-w-[400px]`, so below 412px it simply becomes the viewport
 * minus the padding, with no horizontal scroll and nothing clipped. Everything
 * inside is a single column for the same reason — there is no two-column form
 * here to collapse.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** Optional: the loading and "working…" states are a heading and nothing else. */
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
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
        <div className="mb-6 flex items-center justify-between">
          <Logo size={34} />
          <LanguageToggle />
        </div>

        <div className="rounded-panel border border-line bg-panel p-8 shadow-card">
          <div className="mb-6">
            <h1 className="text-hero font-bold tracking-heading text-ink">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-lead leading-relaxed text-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? (
          <div className="mt-5 text-center text-caption leading-relaxed text-faint">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A message the person has to read before doing anything else — "check your
 * inbox", "your account is waiting for approval".
 *
 * `role="status"` rather than `role="alert"`: these are outcomes, not problems,
 * and alert interrupts a screen reader mid-sentence. The error banner below is
 * the one that interrupts.
 */
export function AuthNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === "success"
          ? "rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 text-body leading-relaxed text-[#166534]"
          : "rounded-md border border-line bg-app px-3 py-2.5 text-body leading-relaxed text-muted"
      }
    >
      {children}
    </div>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-edge bg-danger-bg px-3 py-2.5 text-body font-medium text-danger-ink"
    >
      {children}
    </div>
  );
}

/** The primary action on an auth form. Full width, 44px tall on touch. */
export function AuthSubmit({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-1 rounded-md bg-brand py-2.5 text-center text-lead font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * A labelled text field with a leading icon — the shape every field on these
 * screens takes.
 */
export function AuthField({
  id,
  label,
  icon,
  ...props
}: {
  id: string;
  label: string;
  icon: "mail" | "user";
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const Icon = icon === "mail" ? Mail : User;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <Input id={id} name={id} className="pl-9" required {...props} />
      </div>
    </div>
  );
}

/**
 * A password field with its own reveal toggle.
 *
 * Each instance keeps its own visibility state, deliberately: on a form with
 * "password" and "confirm password", one shared toggle showing both at once
 * defeats the point of asking twice — you would be comparing two strings you can
 * read, which is proof-reading, not confirmation.
 *
 * `autoComplete="new-password"` on both, so a password manager offers to
 * GENERATE one rather than filling the account's current password into a field
 * that is about to replace it.
 */
export function AuthPasswordField({
  id,
  label,
  hint,
  showLabel,
  hideLabel,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
  showLabel: string;
  hideLabel: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Lock
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          // The right padding clears the reveal button, which is wider on a
          // touch screen — otherwise the value runs underneath it.
          className="pl-9 pr-10 [@media(pointer:coarse)]:pr-14"
          required
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          className={cn(
            "absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-faint hover:text-muted",
            TOUCH_TARGET,
          )}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint ? (
        <p className="mt-1.5 text-caption leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/** "Back to sign in" and friends — the way out of a dead end. */
export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-dense font-medium text-brand hover:text-brand-hover hover:underline"
    >
      {children}
    </Link>
  );
}
