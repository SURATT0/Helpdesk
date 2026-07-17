import type { ReactElement } from "react";
import { render as rtlRender } from "@testing-library/react";
import { LanguageProvider } from "@/features/i18n/context";

// Render wrapped in the i18n provider (defaults to English in jsdom), so
// components that call useI18n work and English labels stay assertable.
export function render(ui: ReactElement) {
  // `wrapper` (not inline) so rerender() keeps the provider too.
  return rtlRender(ui, { wrapper: LanguageProvider });
}

export * from "@testing-library/react";
