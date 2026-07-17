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

const TEAMS = [
  { name: "IT Support", department: "IT" },
  { name: "Network Operations", department: "IT" },
  { name: "Field Services", department: "IT" },
];

const USERS: { name: string; role: Role; team?: string }[] = [
  { name: "Dana Reyes", role: "agent", team: "IT Support" },
  { name: "Kai T.", role: "agent", team: "Field Services" },
  { name: "Ana M.", role: "agent", team: "IT Support" },
  { name: "Marcus Chen", role: "requester" },
  { name: "T. Alvarez", role: "requester" },
  { name: "S. Okafor", role: "requester" },
  { name: "J. Petrov", role: "requester" },
  { name: "A. Lindqvist", role: "requester" },
  { name: "R. Danforth", role: "requester" },
  { name: "HR Ops", role: "requester" },
  { name: "L. Osei", role: "requester" },
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
}[] = [
  { id: 1042, subject: "VPN drops every 10 minutes after 4.2 update", status: "in_progress", priority: "high", requester: "Marcus Chen", assignee: "Dana Reyes", category: "Network" },
  { id: 1044, subject: "Email quarantine releasing spam to whole sales team", status: "new", priority: "critical", requester: "T. Alvarez", assignee: null, category: "Email" },
  { id: 1039, subject: "Laptop replacement request — battery swelling", status: "pending", priority: "critical", requester: "S. Okafor", assignee: "Dana Reyes", category: "Hardware" },
  { id: 1035, subject: "Cannot access shared drive after department move", status: "open", priority: "medium", requester: "J. Petrov", assignee: "Dana Reyes", category: "Access" },
  { id: 1031, subject: "Monitor flickering on dock — Ops floor 3", status: "resolved", priority: "low", requester: "A. Lindqvist", assignee: "Dana Reyes", category: "Hardware" },
  { id: 1029, subject: "Printer queue stuck — Finance, floor 2", status: "open", priority: "low", requester: "R. Danforth", assignee: "Kai T.", category: "Hardware" },
  { id: 1027, subject: "Onboarding: 6 new hires need accounts by Monday", status: "in_progress", priority: "high", requester: "HR Ops", assignee: "Ana M.", category: "Accounts" },
  { id: 1025, subject: "Software license request — Figma seats for Design", status: "pending", priority: "medium", requester: "L. Osei", assignee: "Dana Reyes", category: "Software" },
];

/**
 * Populate teams/users/categories/tickets from the original demo data.
 * Idempotent (upsert); used by the CLI seed and by integration tests.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const teamIds = new Map<string, number>();
  for (const t of TEAMS) {
    const row = await prisma.team.upsert({
      where: { name: t.name },
      update: { department: t.department },
      create: t,
    });
    teamIds.set(t.name, row.id);
  }

  const userIds = new Map<string, number>();
  for (const u of USERS) {
    const email = emailFor(u.name);
    const teamId = u.team ? teamIds.get(u.team) : undefined;
    const row = await prisma.user.upsert({
      where: { email },
      update: { name: u.name, role: u.role, teamId, passwordHash },
      create: { name: u.name, email, role: u.role, teamId, passwordHash },
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
    const data = {
      subject: t.subject,
      description: `${t.subject} (seeded demo ticket).`,
      status: t.status,
      priority: t.priority,
      requesterId,
      assigneeId,
      categoryId,
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
  teams: TEAMS.length,
  users: USERS.length,
  categories: CATEGORIES.length,
  tickets: TICKETS.length,
};
