"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/features/auth/context";
import { LanguageProvider } from "@/features/i18n/context";
import { LanguageSync } from "@/features/i18n/use-language-preference";
import { QUERY_CLIENT_OPTIONS } from "./query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () => new QueryClient(QUERY_CLIENT_OPTIONS),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Language sits ABOVE auth: the login screen has a language toggle and
          nobody to attribute it to yet. `LanguageSync` inside the auth provider
          is what lets the signed-in person's stored choice take over from this
          browser's once we know who they are. */}
      <LanguageProvider>
        <AuthProvider>
          <LanguageSync />
          {children}
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
