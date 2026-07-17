import type { Config } from "tailwindcss";

/**
 * Deskly design tokens. Theme: brown primary · cream background · green accent.
 * ink #0f172a · borders #e6e8ee.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#7d5329",
          hover: "#5f3f1f",
        },
        accent: {
          DEFAULT: "#3f8f5e",
          soft: "#e4f2ea",
        },
        ink: "#0f172a",
        line: "#e6e8ee",
        app: "#f6efe1",
        panel: "#ffffff",
        muted: "#64748b",
        faint: "#94a3b8",
        // Status foreground / background pairs
        status: {
          "new-fg": "#1d4ed8",
          "new-bg": "#dbeafe",
          "open-fg": "#0369a1",
          "open-bg": "#e0f2fe",
          "progress-fg": "#b45309",
          "progress-bg": "#fef3c7",
          "pending-fg": "#6d28d9",
          "pending-bg": "#ede9fe",
          "resolved-fg": "#15803d",
          "resolved-bg": "#dcfce7",
          "closed-fg": "#475569",
          "closed-bg": "#f1f5f9",
        },
        priority: {
          critical: "#dc2626",
          high: "#f59e0b",
          medium: "#3b82f6",
          low: "#94a3b8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "10px",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        card: "0 2px 12px rgba(15,23,42,.08)",
        modal: "0 24px 60px rgba(15,23,42,.35)",
      },
    },
  },
  plugins: [],
};

export default config;
