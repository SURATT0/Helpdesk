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
const USERS: { name: string; role: Role; team?: string; customer?: string }[] = [
  { name: "Sam Rivera", role: "admin" }, // platform admin → all customers
  // --- Acme Corp ---
  { name: "Morgan Lee", role: "manager", team: "IT Support", customer: "Acme Corp" },
  { name: "Dana Reyes", role: "agent", team: "IT Support", customer: "Acme Corp" },
  { name: "Kai T.", role: "agent", team: "Field Services", customer: "Acme Corp" },
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
    const row = await prisma.user.upsert({
      where: { email },
      update: { name: u.name, role: u.role, teamId, customerId, passwordHash },
      create: { name: u.name, email, role: u.role, teamId, customerId, passwordHash },
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
  tickets: TICKETS.length,
  assets: ASSETS.length,
};
