import bcrypt from "bcryptjs";
import type { PrismaClient, Role } from "@prisma/client";
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
}

export const SEED_COUNTS = {
  customers: CUSTOMERS.length,
  teams: TEAMS.length,
  users: USERS.length,
  categories: CATEGORIES.length,
  tickets: TICKETS.length,
};
