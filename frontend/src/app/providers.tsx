"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/features/auth/context";
import { LanguageProvider } from "@/features/i18n/context";
import { QUERY_CLIENT_OPTIONS } from "./query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () => new QueryClient(QUERY_CLIENT_OPTIONS),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>{children}</AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
