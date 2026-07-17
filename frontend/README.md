# Deskly — Help Desk web app

Frontend implementation of the **Enterprise Help Desk & Ticket Management System** ("Deskly"),
built from the `Help Desk WebApp.dc.html` Claude Design handoff.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS 3 · lucide-react · Geist / Geist Mono.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000  (redirects to /dashboard)
```

Other scripts: `npm run build`, `npm run start`, `npm run typecheck`, `npm run lint`.

## Screens

| Route             | Screen                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `/login`          | Split-panel corporate sign-in                                     |
| `/dashboard`      | Agent dashboard — stat cards, status/priority charts, my tickets  |
| `/tickets`        | Ticket list — filters, saved views, bulk select, pagination       |
| `/tickets/[id]`   | Ticket detail — thread, internal notes, properties rail, SLA      |
| `/reports`        | SLA summary + resolution-time analytics                           |
| _New ticket_      | Modal (topbar button) with KB deflection                          |

`/users`, `/kb`, and `/settings` are navigable placeholders.

## Notes

- No backend yet: screens render from mock modules in `src/features/*/data.ts`. The folder
  structure mirrors the backend vertical-slice modules named in the architecture spec.
- Design tokens (colours, status/priority palettes, radii, shadows) live in `tailwind.config.ts`
  and `src/lib/domain.ts`, matching the handoff exactly.
