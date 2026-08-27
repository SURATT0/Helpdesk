import type { Config } from "tailwindcss";
import { BADGE, PRIORITY_DOT } from "./src/lib/palette";

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
        /**
         * Status foreground / background pairs, read from `src/lib/palette` —
         * the same object `STATUS_META` builds the badges from.
         *
         * They used to be twelve hex values written out here as well, so the
         * class `bg-status-pending-bg` and the value behind a Pending badge were
         * two independent statements of one colour. `status` keeps the token
         * NAMES (`pending-bg`, not `violet-bg`) because that is what a class
         * needs to say — the mapping from a status to a tone lives in
         * lib/ticket-status, and this mirrors it.
         */
        status: {
          "new-fg": BADGE.blue.fg,
          "new-bg": BADGE.blue.bg,
          "open-fg": BADGE.sky.fg,
          "open-bg": BADGE.sky.bg,
          "progress-fg": BADGE.amber.fg,
          "progress-bg": BADGE.amber.bg,
          "pending-fg": BADGE.violet.fg,
          "pending-bg": BADGE.violet.bg,
          "resolved-fg": BADGE.green.fg,
          "resolved-bg": BADGE.green.bg,
          "closed-fg": BADGE.slate.fg,
          "closed-bg": BADGE.slate.bg,
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
        /** The dots, from the same place `PRIORITY_META` reads them. */
        priority: PRIORITY_DOT,
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "ui-monospace", "monospace"],
      },
      /**
       * Corners. `sm`/`md`/`lg` override Tailwind's; the rest of its scale is
       * still there, and `rounded` (its 4px DEFAULT) is used directly — eleven
       * places had written `rounded-[4px]` for the same 4px.
       *
       * The five below are the values the design uses that the scale has no
       * step for. Named for the one thing each is: the design picked them per
       * element rather than from a ramp, so a size name would be a lie about a
       * ladder that does not exist.
       */
      borderRadius: {
        lg: "10px",
        md: "8px",
        sm: "6px",
        swatch: "3px", // a chart legend's colour chip
        bar: "5px", // the cap on a chart bar
        nav: "7px", // a sidebar row, and the logo mark
        tile: "9px", // an inset box inside a card
        panel: "14px", // a modal's own corner, and the login card
      },
      /**
       * Letter spacing, by the job it does.
       *
       * Tailwind's own steps do not land on any of these (`wide` is 0.025em,
       * `wider` 0.05em), so folding onto them would move type. Its scale is
       * still available — `tracking-wide` is used once, deliberately.
       */
      letterSpacing: {
        heading: "-0.01em", // display text, tightened optically
        columns: "0.02em", // a table's column headers
        eyebrow: "0.06em", // an uppercase micro label
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
