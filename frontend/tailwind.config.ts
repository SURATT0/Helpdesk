import type { Config } from "tailwindcss";

/**
 * Deskly design tokens. Theme: brown primary · cream background · green accent.
 * ink #0f172a · borders #e6e8ee.
 */
/**
 * The shell's two fixed measurements, written once.
 *
 * The sidebar's width was stated twice and in two notations — a `224px` grid
 * track in the app layout and a `w-56` on the aside — so the two could stop
 * agreeing without anything looking wrong at either site. Both now come from
 * here, and so does the topbar's height.
 */
const SIDEBAR_W = "224px";
const TOPBAR_H = "56px";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      spacing: {
        sidebar: SIDEBAR_W,
        topbar: TOPBAR_H,
      },
      gridTemplateColumns: {
        // The app shell: fixed sidebar, then everything else.
        shell: `${SIDEBAR_W} 1fr`,
      },
      /**
       * Text sizes, by the job they do.
       *
       * Eighteen values in half-pixel steps is not a scale, and the design fixes
       * them — the root CLAUDE.md asks for exact fidelity, so every number here
       * is the number that was already on screen. What was missing was a NAME:
       * `text-[12.5px]` appeared 126 times, so the app's default text size could
       * not be adjusted, audited, or even counted.
       */
      fontSize: {
        micro: "9px", // the logo's "OPS" mark
        counter: "10px", // the number inside a badge
        eyebrow: "10.5px", // uppercase section labels, the ⌘K hint
        meta: "11px", // timestamps, row meta, gap markers
        caption: "11.5px", // table headers, badge text, footnotes
        dense: "12px", // mono figures and secondary lines
        body: "12.5px", // the app's default text
        control: "13px", // buttons, nav links, fields
        lead: "13.5px", // card titles, message bodies
        section: "14px", // section headings
        dialog: "14.5px", // a dialog's title
        wordmark: "15px", // the logo, and the coming-soon title
        // A form field on a touch device. Below 16px, iOS Safari zooms the page
        // on focus and does not zoom back out — see components/ui/input.tsx.
        field: "16px",
        page: "17px", // the topbar's page title
        subject: "19px", // a ticket's subject on its own page
        greeting: "20px", // the dashboard's greeting
        hero: "22px", // a page's own headline
        figure: "26px", // a stat card's number
      },
      colors: {
        brand: {
          DEFAULT: "#7d5329",
          hover: "#5f3f1f",
        },
        /**
         * The green, and the four washes of it. `soft` is a filled chip, `tint`
         * an unread row, `wash` the palest highlight, `edge`/`line` its borders.
         */
        accent: {
          DEFAULT: "#3f8f5e",
          soft: "#e4f2ea",
          tint: "#eff7f2",
          wash: "#f4faf6",
          edge: "#d3ecdd",
          line: "#b4dcc3",
        },
        ink: "#0f172a",
        line: "#e6e8ee",
        app: "#f6efe1",
        panel: "#ffffff",
        muted: "#64748b",
        faint: "#94a3b8",
        /**
         * The neutrals the screens actually reach for, strongest to lightest.
         *
         * These were eight unnamed hex values spread over 190 places — `#475569`
         * alone appeared 68 times as the colour of secondary text, which made it
         * the most-used colour in the app and the only one with no name. Several
         * coincide with a status or SLA token by value; they are separate names
         * because they mean something else, and a contrast fix to body text must
         * not repaint every Closed badge.
         */
        strong: "#334155", // emphasised secondary text; the border on a dark bar
        subtle: "#475569", // secondary body text
        dim: "#cbd5e1", // a disabled icon, a track, the scrollbar
        edge: "#e2e8f0", // a field's border; text on the dark selection bar
        hairline: "#eef1f5", // a divider inside a card — lighter than `line`
        rule: "#f1f4f8", // the lightest divider: between table rows
        fill: "#f1f5f9", // a neutral chip, a progress track
        wash: "#fafbfc", // a table header's fill, a card's inset panel
        /** Something is wrong: the text, the fill it sits on, its border. */
        danger: {
          DEFAULT: "#dc2626",
          ink: "#b91c1c",
          bg: "#fef2f2",
          edge: "#fecaca",
        },
        /** Something worked. */
        success: {
          DEFAULT: "#15803d",
          bg: "#dcfce7",
        },
        /** Something needs attention but is not yet wrong. */
        warn: {
          DEFAULT: "#b45309",
          ink: "#c2410c",
          bg: "#fef3c7",
          edge: "#fde68a",
          tint: "#fffbeb",
          wash: "#fff7ed",
        },
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
        // SLA urgency. Semantic like the status palette: a breach is always the
        // same red wherever it appears, and `risk-line` is the row stripe, which
        // needs more weight than the badge fill to read at 3px.
        sla: {
          breach: "#dc2626",
          "breach-fg": "#b91c1c",
          "risk-fg": "#92400e",
          "risk-bg": "#fef3c7",
          "risk-line": "#f59e0b",
          soon: "#b45309",
          ok: "#475569",
          idle: "#94a3b8",
          met: "#16a34a",
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
