# CLAUDE.md — `frontend/`

Guidance for the Deskly web app. Loads only when working with files under `frontend/`.
Project-wide rules (domain invariants, RBAC scoping, design source of truth) live in the root
`CLAUDE.md`.

## Screens defined (WebApp doc)

Login · Dashboard (agent view) · Ticket list (filters, saved views, bulk select) · Ticket detail
(thread + internal notes + properties rail) · Create ticket (modal with KB deflection) · Reports
(SLA summary + resolution time). A dark "ops-console" re-skin of the dashboard exists as a
comparison option only.

## Design system tokens (from the WebApp doc)

Match these exactly for visual fidelity.

- **Type:** `Geist` (UI) + `Geist Mono` (IDs, numbers, SLA timers). **Theme (rebranded):** primary
  **brown** `#7d5329` (hover `#5f3f1f`); **cream** app background `#f6efe1`; **green** accent
  `#3f8f5e` / soft `#e4f2ea` used for active & selected highlights (nav, rows, chips) and the login
  hero. Ink `#0f172a`; borders `#e6e8ee`; panels `#fff`.
  (Status & priority palettes below are semantic and were **not** rebranded.)
  Radii ~8–10px; subtle shadow `0 2px 12px rgba(15,23,42,.08)`; comfortable density.
- **Status colors** (fg / bg): New `#1d4ed8` / `#dbeafe` · Open `#0369a1` / `#e0f2fe` ·
  In&nbsp;Progress `#b45309` / `#fef3c7` · Pending `#6d28d9` / `#ede9fe` · Resolved `#15803d` /
  `#dcfce7` · Closed `#475569` / `#f1f5f9`.
- **Priority dots:** Critical `#dc2626` · High `#f59e0b` · Medium `#3b82f6` · Low `#94a3b8`.
- **Shell:** fixed 224px left sidebar (Dashboard, Tickets, Users, Reports, Knowledge Base,
  Settings) + 56px topbar (⌘K search, notification bell, New ticket, avatar). Demo persona is agent
  "Dana Reyes"; brand name is "Deskly".
