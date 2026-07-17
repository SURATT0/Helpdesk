"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoadingRow } from "@/components/ui/states";
import { useAuth } from "./context";

/**
 * Gate the authenticated shell. Redirects to /login when there is no session,
 * and holds a loading state while the initial refresh-cookie bootstrap runs —
 * so protected data queries never fire without a token.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="grid h-screen place-items-center bg-app">
        <LoadingRow label="Loading…" />
      </div>
    );
  }

  return <>{children}</>;
}
