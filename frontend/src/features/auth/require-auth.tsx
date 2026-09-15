"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoadingRow } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "./context";

/**
 * Gate the authenticated shell. Redirects to /login when there is no session,
 * and holds a loading state while the initial refresh-cookie bootstrap runs —
 * so protected data queries never fire without a token.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  /**
   * An account still holding the password an administrator chose for it goes to
   * the form that replaces it, and nowhere else.
   *
   * Here rather than on each page for the same reason the sign-in redirect is
   * here: this component wraps the entire authenticated shell, so one condition
   * covers every route inside it and the next page added is covered without its
   * author doing anything. The API refuses those routes anyway — this is what
   * stops the person watching a dashboard fill with error states to find out.
   */
  const mustChangePassword = status === "authenticated" && user?.mustChangePassword === true;

  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [status, mustChangePassword, router]);

  // Held on the loader rather than rendered: the redirect above happens after
  // paint, and a frame of the real shell would fire every query on the page —
  // each of which the API answers with PASSWORD_CHANGE_REQUIRED.
  if (status !== "authenticated" || mustChangePassword) {
    return (
      <div className="grid h-dvh place-items-center bg-app">
        <LoadingRow label={t("common.loading")} />
      </div>
    );
  }

  return <>{children}</>;
}
