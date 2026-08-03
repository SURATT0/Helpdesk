import bcrypt from "bcryptjs";
import type {
  AssetKind,
  AssetStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import type { Priority, TicketStatus } from "../src/shared/domain";
import { computeDueAt } from "../src/modules/tickets/sla";

// Every seeded user shares this demo password. Log in as e.g. dana.reyes@acme.com.
export const DEMO_PASSWORD = "password123";

const emailFor = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "")}@acme.com`;

// Tenant organizations — the top-level isolation boundary.
const CUSTOMERS = ["Acme Corp", "Globex Inc"];

const TEAMS: { name: string; department: string; customer: string }[] = [
  { name: "IT Support", department: "IT", customer: "Acme Corp" },
  { name: "Network Operations", department: "IT", customer: "Acme Corp" },
  { name: "Field Services", department: "IT", customer: "Acme Corp" },
  { name: "Facilities Desk", department: "Facilities", customer: "Acme Corp" },
  { name: "Globex Support", department: "Support", customer: "Globex Inc" },
];

// `customer` is the tenant a user belongs to. A platform admin has none (sees
// all customers). Staff see everything within their customer, across departments.
// `available: false` = not accepting routed work (the "away" switch). It does not
// restrict what they can see or do; it only makes project routing skip them.
const USERS: {
  name: string;
  role: Role;
  team?: string;
  customer?: string;
  available?: boolean;
}[] = [
  { name: "Sam Rivera", role: "admin" }, // platform admin → all customers
  // --- Acme Corp ---
  { name: "Morgan Lee", role: "manager", team: "IT Support", customer: "Acme Corp" },
  { name: "Dana Reyes", role: "agent", team: "IT Support", customer: "Acme Corp" },
  // Away — demonstrates project routing falling through to the backup owner.
  { name: "Kai T.", role: "agent", team: "Field Services", customer: "Acme Corp", available: false },
  { name: "Ana M.", role: "agent", team: "IT Support", customer: "Acme Corp" },
  { name: "Marcus Chen", role: "requester", customer: "Acme Corp" },
  { name: "T. Alvarez", role: "requester", customer: "Acme Corp" },
  { name: "S. Okafor", role: "requester", customer: "Acme Corp" },
  { name: "J. Petrov", role: "requester", customer: "Acme Corp" },
  { name: "A. Lindqvist", role: "requester", customer: "Acme Corp" },
  { name: "R. Danforth", role: "requester", customer: "Acme Corp" },
  { name: "HR Ops", role: "requester", customer: "Acme Corp" },
  { name: "L. Osei", role: "requester", customer: "Acme Corp" },
  // --- Globex Inc ---
  { name: "Nadia Kofi", role: "manager", team: "Globex Support", customer: "Globex Inc" },
  { name: "Owen Park", role: "agent", team: "Globex Support", customer: "Globex Inc" },
  { name: "Priya Shah", role: "requester", customer: "Globex Inc" },
];

// Asset registry demo rows. `owner` is a seeded user name; `customer` is the
// tenant that owns the asset — asset tags are unique per customer, so both
// tenants can run their own "IT-0001".
const ASSETS: {
  assetTag: string;
  name: string;
  kind: AssetKind;
  status?: AssetStatus;
  serial?: string;
  location?: string;
  owner?: string;
  customer: string;
}[] = [
  // --- Acme Corp ---
  { assetTag: "IT-0001", name: "MacBook Pro 14\"", kind: "laptop", serial: "C02X1234ABCD", location: "HQ / 3rd floor", owner: "Marcus Chen", customer: "Acme Corp" },
  { assetTag: "IT-0002", name: "ThinkPad X1 Carbon", kind: "laptop", serial: "PF0ABCDE", location: "HQ / 2nd floor", owner: "T. Alvarez", customer: "Acme Corp" },
  { assetTag: "IT-0003", name: "iPhone 15", kind: "phone", serial: "F2LX90ABCD", owner: "S. Okafor", customer: "Acme Corp" },
  { assetTag: "IT-0004", name: "Dell OptiPlex 7010", kind: "desktop", location: "Reception", owner: "HR Ops", customer: "Acme Corp" },
  { assetTag: "PR-0001", name: "HP LaserJet M507 (3F)", kind: "printer", status: "in_repair", location: "HQ / 3rd floor", customer: "Acme Corp" },
  { assetTag: "SRV-0001", name: "mail-01 (Exchange)", kind: "server", location: "DC / rack B2", customer: "Acme Corp" },
  { assetTag: "NET-0001", name: "Core switch — HQ", kind: "network", location: "DC / rack A1", customer: "Acme Corp" },
  { assetTag: "NET-0002", name: "WiFi AP — 3rd floor east", kind: "network", location: "HQ / 3rd floor", customer: "Acme Corp" },
  { assetTag: "SW-0001", name: "Adobe Creative Cloud (seat)", kind: "software", owner: "L. Osei", customer: "Acme Corp" },
  { assetTag: "IT-0099", name: "MacBook Air 2015 (decommissioned)", kind: "laptop", status: "retired", customer: "Acme Corp" },
  // --- Globex Inc ---
  { assetTag: "IT-0001", name: "Surface Laptop 5", kind: "laptop", serial: "GLX-77120", owner: "Priya Shah", customer: "Globex Inc" },
  { assetTag: "NET-0001", name: "Branch router — Lagos", kind: "network", location: "Lagos office", customer: "Globex Inc" },
];

/**
 * Projects are a ROUTING dimension below the customer, never a visibility one:
 * members' new tickets land on the project's owner (or the backup when the owner
 * is unavailable), but every agent of that customer still sees them.
 *
 * "Acme Migration" seeds the interesting case — its owner Kai T. is marked
 * unavailable in USERS, so new tickets from its members route to the backup,
 * Ana M., rather than to nobody.
 */
const PROJECTS: {
  name: string;
  customer: string;
  owner?: string;
  backupOwner?: string;
  members: string[];
}[] = [
  {
    name: "Acme Migration",
    customer: "Acme Corp",
    owner: "Kai T.",
    backupOwner: "Ana M.",
    members: ["Marcus Chen", "T. Alvarez"],
  },
  {
    name: "Acme Facilities",
    customer: "Acme Corp",
    owner: "Dana Reyes",
    members: ["S. Okafor", "HR Ops"],
  },
  {
    name: "Globex Rollout",
    customer: "Globex Inc",
    owner: "Owen Park",
    members: ["Priya Shah"],
  },
];

const CATEGORIES: { name: string; team: string }[] = [
  { name: "Network", team: "Network Operations" },
  { name: "Email", team: "IT Support" },
  { name: "Hardware", team: "Field Services" },
  { name: "Access", team: "IT Support" },
  { name: "Accounts", team: "IT Support" },
  { name: "Software", team: "IT Support" },
];

const TICKETS: {
  id: number;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  requester: string;
  assignee: string | null;
  category: string;
  customer: string;
}[] = [
  // --- Acme Corp ---
  { id: 1042, subject: "VPN drops every 10 minutes after 4.2 update", status: "in_progress", priority: "high", requester: "Marcus Chen", assignee: "Dana Reyes", category: "Network", customer: "Acme Corp" },
  { id: 1044, subject: "Email quarantine releasing spam to whole sales team", status: "new", priority: "critical", requester: "T. Alvarez", assignee: null, category: "Email", customer: "Acme Corp" },
  { id: 1039, subject: "Laptop replacement request — battery swelling", status: "pending", priority: "critical", requester: "S. Okafor", assignee: "Dana Reyes", category: "Hardware", customer: "Acme Corp" },
  { id: 1035, subject: "Cannot access shared drive after department move", status: "open", priority: "medium", requester: "J. Petrov", assignee: "Dana Reyes", category: "Access", customer: "Acme Corp" },
  { id: 1031, subject: "Monitor flickering on dock — Ops floor 3", status: "resolved", priority: "low", requester: "A. Lindqvist", assignee: "Dana Reyes", category: "Hardware", customer: "Acme Corp" },
  { id: 1029, subject: "Printer queue stuck — Finance, floor 2", status: "open", priority: "low", requester: "R. Danforth", assignee: "Kai T.", category: "Hardware", customer: "Acme Corp" },
  { id: 1027, subject: "Onboarding: 6 new hires need accounts by Monday", status: "in_progress", priority: "high", requester: "HR Ops", assignee: "Ana M.", category: "Accounts", customer: "Acme Corp" },
  { id: 1025, subject: "Software license request — Figma seats for Design", status: "pending", priority: "medium", requester: "L. Osei", assignee: "Dana Reyes", category: "Software", customer: "Acme Corp" },
  // --- Globex Inc ---
  { id: 2001, subject: "Door access badge stopped working at HQ", status: "new", priority: "high", requester: "Priya Shah", assignee: "Owen Park", category: "Access", customer: "Globex Inc" },
  { id: 2002, subject: "Mailbox over quota — cannot receive mail", status: "open", priority: "medium", requester: "Priya Shah", assignee: null, category: "Email", customer: "Globex Inc" },
];

const HOUR_MS = 3_600_000;

/**
 * When a historical ticket was closed. Either a fixed number of hours back (for
 * the very recent ones, which must land in the *current* week whatever day the
 * seed runs) or a calendar position — `monthsAgo: 1, day: 14` means the 14th of
 * last month, local time, because that is how the history log slices periods.
 */
type Closure =
  | { hoursAgo: number }
  | { monthsAgo: number; day: number }
  /**
   * A fixed month/day in the PREVIOUS calendar year (month is 1-12). Needed
   * because `monthsAgo` cannot express that: seeded in January, `monthsAgo: 13`
   * lands in December two years back, not last year. The history log's year view
   * — and the E2E spec that steps back one year — need last year to be populated
   * whatever month the seed runs in.
   */
  | { prevYear: { month: number; day: number } };

/**
 * Closed tickets stretching back over a year, so the history log has something
 * to show in every period a viewer can pick — including last year.
 *
 * Ids sit in 1001–1020, BELOW the live demo tickets, so `MAX(id)` is unchanged
 * and a freshly created ticket still gets the next id after 2002.
 *
 * Two casting constraints, both load-bearing for the integration suite: Marcus
 * Chen never appears as a requester (a test asserts his ticket list is exactly
 * `[1042]`), and no *Acme* ticket is assigned to Owen Park (a test asserts an
 * Acme agent sees nothing when filtering on him). Globex tickets may use him
 * freely — row scope hides them from Acme regardless.
 */
const CLOSED_HISTORY: {
  id: number;
  subject: string;
  priority: Priority;
  requester: string;
  assignee: string;
  category: string;
  customer: string;
  closure: Closure;
  /** How long it stayed open, in hours — drives the "Open for" column. */
  openHours: number;
}[] = [
  // --- This week (hour offsets, so they never drift out of the current week) ---
  { id: 1001, subject: "Password reset — locked out after phone swap", priority: "medium", requester: "L. Osei", assignee: "Dana Reyes", category: "Accounts", customer: "Acme Corp", closure: { hoursAgo: 2 }, openHours: 0.4 },
  { id: 1002, subject: "Zoom audio cutting out in Ops standup", priority: "low", requester: "J. Petrov", assignee: "Ana M.", category: "Software", customer: "Acme Corp", closure: { hoursAgo: 6 }, openHours: 3 },
  { id: 1003, subject: "Guest wifi voucher for auditors", priority: "low", requester: "HR Ops", assignee: "Dana Reyes", category: "Network", customer: "Acme Corp", closure: { hoursAgo: 10 }, openHours: 1.5 },
  { id: 1004, subject: "Second monitor not detected on new dock", priority: "medium", requester: "R. Danforth", assignee: "Kai T.", category: "Hardware", customer: "Acme Corp", closure: { hoursAgo: 30 }, openHours: 26 },
  { id: 1005, subject: "Shared mailbox permissions for Finance", priority: "medium", requester: "T. Alvarez", assignee: "Ana M.", category: "Email", customer: "Acme Corp", closure: { hoursAgo: 54 }, openHours: 8 },

  // --- Earlier this month ---
  { id: 1006, subject: "VPN certificate expired on field laptops", priority: "high", requester: "S. Okafor", assignee: "Dana Reyes", category: "Network", customer: "Acme Corp", closure: { monthsAgo: 0, day: 3 }, openHours: 5 },
  { id: 1007, subject: "Badge reader offline — loading dock", priority: "high", requester: "A. Lindqvist", assignee: "Kai T.", category: "Access", customer: "Acme Corp", closure: { monthsAgo: 0, day: 11 }, openHours: 30 },
  { id: 1008, subject: "Adobe licence reassignment after two leavers", priority: "low", requester: "HR Ops", assignee: "Ana M.", category: "Software", customer: "Acme Corp", closure: { monthsAgo: 0, day: 18 }, openHours: 74 },

  // --- Last month ---
  { id: 1009, subject: "Outlook rebuilding index every login", priority: "medium", requester: "L. Osei", assignee: "Dana Reyes", category: "Email", customer: "Acme Corp", closure: { monthsAgo: 1, day: 6 }, openHours: 12 },
  { id: 1010, subject: "Switch port flapping in comms room B", priority: "critical", requester: "R. Danforth", assignee: "Dana Reyes", category: "Network", customer: "Acme Corp", closure: { monthsAgo: 1, day: 14 }, openHours: 2 },
  { id: 1011, subject: "Docking station firmware recall — 9 units", priority: "medium", requester: "S. Okafor", assignee: "Kai T.", category: "Hardware", customer: "Acme Corp", closure: { monthsAgo: 1, day: 22 }, openHours: 120 },
  { id: 1012, subject: "New starter accounts — Design, 3 people", priority: "high", requester: "HR Ops", assignee: "Ana M.", category: "Accounts", customer: "Acme Corp", closure: { monthsAgo: 1, day: 27 }, openHours: 20 },

  // --- Two to five months back ---
  { id: 1013, subject: "Mail relay blacklisted after newsletter blast", priority: "critical", requester: "T. Alvarez", assignee: "Dana Reyes", category: "Email", customer: "Acme Corp", closure: { monthsAgo: 2, day: 9 }, openHours: 6 },
  { id: 1014, subject: "Meeting room display stuck on setup screen", priority: "low", requester: "J. Petrov", assignee: "Kai T.", category: "Hardware", customer: "Acme Corp", closure: { monthsAgo: 2, day: 20 }, openHours: 48 },
  { id: 1015, subject: "SSO loop on the expenses portal", priority: "high", requester: "A. Lindqvist", assignee: "Ana M.", category: "Access", customer: "Acme Corp", closure: { monthsAgo: 3, day: 12 }, openHours: 4 },
  { id: 1016, subject: "Laptop refresh cycle — Finance batch", priority: "medium", requester: "L. Osei", assignee: "Kai T.", category: "Hardware", customer: "Acme Corp", closure: { monthsAgo: 3, day: 25 }, openHours: 200 },
  { id: 1017, subject: "Contractor access revoked late — audit finding", priority: "high", requester: "HR Ops", assignee: "Dana Reyes", category: "Access", customer: "Acme Corp", closure: { monthsAgo: 4, day: 16 }, openHours: 16 },
  { id: 1018, subject: "Printer driver rollout broke Finance queue", priority: "medium", requester: "R. Danforth", assignee: "Ana M.", category: "Hardware", customer: "Acme Corp", closure: { monthsAgo: 5, day: 8 }, openHours: 52 },

  // --- Last year (pinned to the previous calendar year, not a month offset) ---
  { id: 1019, subject: "Annual access review — dormant accounts", priority: "medium", requester: "HR Ops", assignee: "Dana Reyes", category: "Accounts", customer: "Acme Corp", closure: { prevYear: { month: 6, day: 15 } }, openHours: 96 },
  { id: 1020, subject: "Mailbox migration wave 2 — Globex HQ", priority: "high", requester: "Priya Shah", assignee: "Owen Park", category: "Email", customer: "Globex Inc", closure: { prevYear: { month: 5, day: 21 } }, openHours: 36 },
];

/**
 * Resolve a `Closure` to a local instant.
 *
 * `day` is clamped to the month's length, so `day: 31` is the 28th in February
 * rather than rolling into March. A calendar position that has not happened yet
 * (the 18th of this month, seeded on the 5th) is pulled back to a couple of
 * hours ago — a demo must never show a ticket closed in the future, which would
 * also land it outside the "current period" the log opens on.
 */
function closureAt(now: Date, closure: Closure): Date {
  if ("hoursAgo" in closure) {
    return new Date(now.getTime() - closure.hoursAgo * HOUR_MS);
  }
  if ("prevYear" in closure) {
    // Always in the past, so no future clamp is needed.
    return new Date(
      now.getFullYear() - 1,
      closure.prevYear.month - 1,
      closure.prevYear.day,
      14,
      30,
    );
  }
  const month = now.getMonth() - closure.monthsAgo;
  const lastDay = new Date(now.getFullYear(), month + 1, 0).getDate();
  const at = new Date(
    now.getFullYear(),
    month,
    Math.min(closure.day, lastDay),
    // Spread across the working day so the "Closed" column isn't a column of
    // identical times.
    9 + (closure.day % 8),
    (closure.day * 7) % 60,
  );
  return at > now ? new Date(now.getTime() - 2 * HOUR_MS) : at;
}

/**
 * Populate customers/teams/users/categories/tickets from the demo data.
 * Idempotent (upsert); used by the CLI seed and by integration tests.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const customerIds = new Map<string, number>();
  for (const name of CUSTOMERS) {
    const row = await prisma.customer.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    customerIds.set(name, row.id);
  }

  const teamIds = new Map<string, number>();
  for (const t of TEAMS) {
    const customerId = customerIds.get(t.customer) ?? null;
    const row = await prisma.team.upsert({
      where: { name: t.name },
      update: { department: t.department, customerId },
      create: { name: t.name, department: t.department, customerId },
    });
    teamIds.set(t.name, row.id);
  }

  const userIds = new Map<string, number>();
  for (const u of USERS) {
    const email = emailFor(u.name);
    const teamId = u.team ? teamIds.get(u.team) : null;
    const customerId = u.customer ? (customerIds.get(u.customer) ?? null) : null;
    const availableForAssignment = u.available ?? true;
    const row = await prisma.user.upsert({
      where: { email },
      update: {
        name: u.name,
        role: u.role,
        teamId,
        customerId,
        passwordHash,
        availableForAssignment,
      },
      create: {
        name: u.name,
        email,
        role: u.role,
        teamId,
        customerId,
        passwordHash,
        availableForAssignment,
      },
    });
    userIds.set(u.name, row.id);
  }

  // Assets are keyed by (customer, assetTag) — the same tag in another tenant is
  // a different asset, which is exactly what the compound unique enforces.
  const assetIds = new Map<string, number>();
  for (const a of ASSETS) {
    const customerId = customerIds.get(a.customer) ?? null;
    const ownerId = a.owner ? (userIds.get(a.owner) ?? null) : null;
    const row = await prisma.asset.upsert({
      where: { customerId_assetTag: { customerId: customerId!, assetTag: a.assetTag } },
      update: {
        name: a.name,
        kind: a.kind,
        status: a.status ?? "active",
        serial: a.serial ?? null,
        location: a.location ?? null,
        ownerId,
      },
      create: {
        assetTag: a.assetTag,
        name: a.name,
        kind: a.kind,
        status: a.status ?? "active",
        serial: a.serial ?? null,
        location: a.location ?? null,
        ownerId,
        customerId,
      },
    });
    assetIds.set(`${a.customer}:${a.assetTag}`, row.id);
  }

  // Projects, after users so owners resolve. Membership is written back onto the
  // user (users.project_id) — a routing pointer, not a scope.
  for (const p of PROJECTS) {
    const customerId = customerIds.get(p.customer);
    if (customerId == null) continue;
    const ownerId = p.owner ? (userIds.get(p.owner) ?? null) : null;
    const backupOwnerId = p.backupOwner
      ? (userIds.get(p.backupOwner) ?? null)
      : null;
    const row = await prisma.project.upsert({
      where: { customerId_name: { customerId, name: p.name } },
      update: { ownerId, backupOwnerId },
      create: { name: p.name, customerId, ownerId, backupOwnerId },
    });
    for (const member of p.members) {
      const memberId = userIds.get(member);
      if (memberId == null) continue;
      await prisma.user.update({
        where: { id: memberId },
        data: { projectId: row.id },
      });
    }
  }

  const categoryIds = new Map<string, number>();
  for (const c of CATEGORIES) {
    const defaultTeamId = teamIds.get(c.team);
    const row = await prisma.category.upsert({
      where: { name: c.name },
      update: { defaultTeamId },
      create: { name: c.name, defaultTeamId },
    });
    categoryIds.set(c.name, row.id);
  }

  for (const t of TICKETS) {
    const requesterId = userIds.get(t.requester)!;
    const assigneeId = t.assignee ? userIds.get(t.assignee)! : null;
    const categoryId = categoryIds.get(t.category)!;
    const customerId = customerIds.get(t.customer) ?? null;
    const data = {
      subject: t.subject,
      description: `${t.subject} (seeded demo ticket).`,
      status: t.status,
      priority: t.priority,
      requesterId,
      assigneeId,
      categoryId,
      customerId,
      dueAt: computeDueAt(t.priority, now),
      createdAt: now,
      // Demo resolved/closed tickets were resolved on time (met).
      resolvedAt:
        t.status === "resolved" || t.status === "closed" ? now : null,
    };
    await prisma.ticket.upsert({
      where: { id: t.id },
      update: data,
      create: { id: t.id, ...data },
    });

    await prisma.ticketStatusHistory.deleteMany({ where: { ticketId: t.id } });
    await prisma.ticketStatusHistory.create({
      data: {
        ticketId: t.id,
        fromStatus: null,
        toStatus: t.status,
        changedById: assigneeId,
      },
    });
  }

  // Closed tickets going back over a year, so the history log is not empty in
  // whichever period the viewer lands on. These carry real createdAt/closedAt
  // pairs — the log's "Open for" column is the gap between them, and the period
  // filter reads closedAt, so both have to be genuine rather than `now`.
  for (const t of CLOSED_HISTORY) {
    const requesterId = userIds.get(t.requester)!;
    const assigneeId = userIds.get(t.assignee)!;
    const categoryId = categoryIds.get(t.category)!;
    const customerId = customerIds.get(t.customer) ?? null;
    const closedAt = closureAt(now, t.closure);
    const createdAt = new Date(closedAt.getTime() - t.openHours * HOUR_MS);
    const data = {
      subject: t.subject,
      description: `${t.subject} (seeded demo ticket, closed).`,
      status: "closed" as TicketStatus,
      priority: t.priority,
      requesterId,
      assigneeId,
      categoryId,
      customerId,
      dueAt: computeDueAt(t.priority, createdAt),
      createdAt,
      // Closed straight off the back of resolution, which is the ordinary path
      // (requester confirms, or the 72h auto-close fires).
      resolvedAt: closedAt,
      closedAt,
    };
    await prisma.ticket.upsert({
      where: { id: t.id },
      update: data,
      create: { id: t.id, ...data },
    });

    // A two-step trail rather than one row, so the ticket's history panel reads
    // as a real lifecycle and the timestamps line up with the log.
    await prisma.ticketStatusHistory.deleteMany({ where: { ticketId: t.id } });
    await prisma.ticketStatusHistory.createMany({
      data: [
        { ticketId: t.id, fromStatus: null, toStatus: "new", changedById: requesterId, createdAt },
        { ticketId: t.id, fromStatus: "resolved", toStatus: "closed", changedById: assigneeId, createdAt: closedAt },
      ],
    });
  }

  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('tickets', 'id'), (SELECT MAX(id) FROM tickets))`,
  );

  // Affected parties on a few demo tickets, chosen to show the cases the fields
  // exist for: a requester reporting on someone else's behalf (1027 — HR Ops
  // raises accounts for two new hires), shared infrastructure with no single
  // affected person (1044 — the mail server), and a straightforward
  // one-person-one-device incident (1039).
  const affectedUsers: { ticketId: number; users: string[] }[] = [
    { ticketId: 1027, users: ["J. Petrov", "A. Lindqvist"] },
    { ticketId: 1042, users: ["Marcus Chen"] },
    { ticketId: 1039, users: ["S. Okafor"] },
  ];
  for (const link of affectedUsers) {
    for (const name of link.users) {
      const userId = userIds.get(name);
      if (userId == null) continue;
      await prisma.ticketAffectedUser.upsert({
        where: { ticketId_userId: { ticketId: link.ticketId, userId } },
        update: {},
        create: { ticketId: link.ticketId, userId },
      });
    }
  }

  const affectedAssets: { ticketId: number; assets: string[] }[] = [
    { ticketId: 1042, assets: ["Acme Corp:IT-0001", "Acme Corp:NET-0001"] },
    { ticketId: 1044, assets: ["Acme Corp:SRV-0001"] },
    { ticketId: 1039, assets: ["Acme Corp:IT-0003"] },
    { ticketId: 1029, assets: ["Acme Corp:PR-0001"] },
    { ticketId: 2002, assets: ["Globex Inc:IT-0001"] },
  ];
  for (const link of affectedAssets) {
    for (const key of link.assets) {
      const assetId = assetIds.get(key);
      if (assetId == null) continue;
      await prisma.ticketAffectedAsset.upsert({
        where: { ticketId_assetId: { ticketId: link.ticketId, assetId } },
        update: {},
        create: { ticketId: link.ticketId, assetId },
      });
    }
  }
}

export const SEED_COUNTS = {
  customers: CUSTOMERS.length,
  teams: TEAMS.length,
  users: USERS.length,
  categories: CATEGORIES.length,
  // Live demo tickets plus the closed back-catalogue — both are real rows, so
  // reporting only the former would under-report what the seed just wrote.
  tickets: TICKETS.length + CLOSED_HISTORY.length,
  closedHistory: CLOSED_HISTORY.length,
  assets: ASSETS.length,
};
