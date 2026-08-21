"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoadingRow } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "./context";
import { canSeeReporting, landingFor } from "./landing";

/**
 * Keep the aggregate pages — the dashboard and the reports — to the roles the
 * API grants them to.
 *
 * The sidebar already hides both links, but a link is not a gate: a bookmark, a
 * shared URL or a typed path all arrive here directly. Without this they would
 * render the page chrome and then sit on a 403 from every query underneath,
 * which reads as the app being broken rather than as somewhere they should not
 * be. Sending them to their own landing page says the same thing without the
 * wreckage.
 *
 * The real enforcement is `requirePermission` on the server; this is the
 * courtesy in front of it.
 */
export function ReportingOnly({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const allowed = canSeeReporting(user?.role);

  React.useEffect(() => {
    if (status === "authenticated" && !allowed) {
      router.replace(landingFor(user?.role));
    }
  }, [status, allowed, user, router]);

  // Hold the loading state rather than flashing the page to someone about to be
  // sent away — and while the session bootstraps, when the role is not known yet.
  if (status !== "authenticated" || !allowed) {
    return (
      <div className="grid flex-1 place-items-center">
        <LoadingRow label={t("common.loading")} />
      </div>
    );
  }

  return <>{children}</>;
}
