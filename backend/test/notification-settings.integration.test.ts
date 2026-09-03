import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { settingsRepository } from "../src/modules/settings/settings.repository";
import { prisma, resetDb } from "./db";

/**
 * Notification policy, per customer.
 *
 * The seed gives all three shapes this has to get right, which is why they are
 * named rather than generic:
 *
 *   Morgan Lee   super_admin OF customer 1  — a tenant's own manager
 *   Nadia Kofi   super_admin OF customer 2  — another tenant's manager
 *   Sam Rivera   super_admin, NO customer   — platform-wide
 *
 * Role and reach are separate axes. All three hold the permission; what differs
 * is whose policy they can touch, and that is the property most worth pinning.
 */

const app = createApp();
const API = "/api/v1";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const TENANT_ADMIN = "morgan.lee@acme.com"; // super_admin of customer 1
const OTHER_TENANT_ADMIN = "nadia.kofi@acme.com"; // super_admin of customer 2
const PLATFORM_ADMIN = "sam.rivera@acme.com"; // super_admin, no customer

async function customerOf(email: string): Promise<number> {
  const row = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { customerId: true },
  });
  return row.customerId as number;
}

const body = (over: Record<string, unknown> = {}) => ({
  disabledEvents: ["ticket.sla_warning"],
  ratePerTicket: 5,
  rateWindowMinutes: 10,
  slaWarnMinutes: 120,
  ...over,
});

beforeEach(async () => {
  await resetDb();
});

describe("an unconfigured customer", () => {
  it("reads back the deployment defaults, flagged as not configured", async () => {
    const morgan = await login(TENANT_ADMIN);
    const res = await request(app)
      .get(`${API}/settings/notifications`)
      .set(bearer(morgan));

    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.ratePerTicket).toBeGreaterThan(0);
    expect(res.body.data.slaWarnMs).toBeGreaterThan(0);
    expect(res.body.data.updatedAt).toBeNull();
  });

  // The screen renders its event list and its input bounds from this, rather
  // than keeping a second copy that would drift.
  it("is told the event catalogue and the input bounds", async () => {
    const morgan = await login(TENANT_ADMIN);
    const res = await request(app)
      .get(`${API}/settings/notifications`)
      .set(bearer(morgan));

    expect(res.body.meta.events).toContain("ticket.sla_warning");
    expect(res.body.meta.limits.ratePerTicket.min).toBeGreaterThan(0);
  });

  it("has no stored row — an absent row IS the unconfigured state", async () => {
    expect(await prisma.notificationSettings.count()).toBe(0);
  });
});

describe("saving a policy", () => {
  it("stores it and reads it back as configured", async () => {
    const morgan = await login(TENANT_ADMIN);
    const saved = await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body());

    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      configured: true,
      ratePerTicket: 5,
      rateWindowMs: 10 * 60_000,
      slaWarnMs: 120 * 60_000,
      disabledEvents: ["ticket.sla_warning"],
    });
  });

  it("is what the mail sweep then reads for that customer", async () => {
    const morgan = await login(TENANT_ADMIN);
    await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body())
      .expect(200);

    const effective = await settingsRepository.effectiveFor(
      await customerOf(TENANT_ADMIN),
    );
    expect(effective.configured).toBe(true);
    expect(effective.ratePerTicket).toBe(5);
    expect(effective.disabledEvents.has("ticket.sla_warning")).toBe(true);
  });

  // One tenant's policy is not another's. This is the whole reason the settings
  // are per customer rather than per deployment.
  it("leaves another customer on the defaults", async () => {
    const morgan = await login(TENANT_ADMIN);
    await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body())
      .expect(200);

    const theirs = await settingsRepository.effectiveFor(
      await customerOf(OTHER_TENANT_ADMIN),
    );
    expect(theirs.configured).toBe(false);
    expect(theirs.disabledEvents.has("ticket.sla_warning")).toBe(false);
  });

  it("refuses an event that is not in the catalogue", async () => {
    const morgan = await login(TENANT_ADMIN);
    const res = await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body({ disabledEvents: ["ticket.exploded"] }));
    expect(res.status).toBe(400);
  });

  it("refuses a rate limit of zero, which would silence the desk", async () => {
    const morgan = await login(TENANT_ADMIN);
    const res = await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body({ ratePerTicket: 0 }));
    expect(res.status).toBe(400);
  });

  it("records the change in the audit log", async () => {
    const morgan = await login(TENANT_ADMIN);
    await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body())
      .expect(200);
    const rows = await prisma.auditLog.findMany({
      where: { action: "settings.notifications_update" },
    });
    expect(rows).toHaveLength(1);
  });
});

describe("resetting", () => {
  // The row is removed rather than rewritten with today's defaults, so the desk
  // follows the defaults as they change instead of freezing a copy.
  it("drops the stored row and goes back to the defaults", async () => {
    const morgan = await login(TENANT_ADMIN);
    await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body())
      .expect(200);
    expect(await prisma.notificationSettings.count()).toBe(1);

    const res = await request(app)
      .delete(`${API}/settings/notifications`)
      .set(bearer(morgan));

    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(await prisma.notificationSettings.count()).toBe(0);
  });
});

describe("role says what, customerId says whose", () => {
  it("refuses an admin — this is the desk's configuration, not case work", async () => {
    const dana = await login("dana.reyes@acme.com");
    expect(
      (await request(app).get(`${API}/settings/notifications`).set(bearer(dana)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put(`${API}/settings/notifications`)
          .set(bearer(dana))
          .send(body())
      ).status,
    ).toBe(403);
  });

  it("refuses a requester outright", async () => {
    const marcus = await login("marcus.chen@acme.com");
    expect(
      (
        await request(app)
          .get(`${API}/settings/notifications`)
          .set(bearer(marcus))
      ).status,
    ).toBe(403);
  });

  it("refuses a tenant's manager who names another customer", async () => {
    const morgan = await login(TENANT_ADMIN);
    const other = await customerOf(OTHER_TENANT_ADMIN);
    const res = await request(app)
      .get(`${API}/settings/notifications?customerId=${other}`)
      .set(bearer(morgan));
    expect(res.status).toBe(403);
  });

  it("lets a tenant's manager name their own customer explicitly", async () => {
    const morgan = await login(TENANT_ADMIN);
    const mine = await customerOf(TENANT_ADMIN);
    const res = await request(app)
      .get(`${API}/settings/notifications?customerId=${mine}`)
      .set(bearer(morgan));
    expect(res.status).toBe(200);
    expect(res.body.data.customerId).toBe(mine);
  });

  // Platform-wide staff belong to no tenant, so there is no default one to edit.
  // Refusing is the point: silently picking one would be picking somebody's.
  it("makes platform-wide staff name the customer they mean", async () => {
    const sam = await login(PLATFORM_ADMIN);
    const res = await request(app)
      .get(`${API}/settings/notifications`)
      .set(bearer(sam));
    expect(res.status).toBe(400);
  });

  it("lets platform-wide staff reach any customer they name", async () => {
    const sam = await login(PLATFORM_ADMIN);
    for (const email of [TENANT_ADMIN, OTHER_TENANT_ADMIN]) {
      const id = await customerOf(email);
      const res = await request(app)
        .get(`${API}/settings/notifications?customerId=${id}`)
        .set(bearer(sam));
      expect(res.status).toBe(200);
      expect(res.body.data.customerId).toBe(id);
    }
  });

  it("404s a customer that does not exist rather than creating a policy for it", async () => {
    const sam = await login(PLATFORM_ADMIN);
    const res = await request(app)
      .put(`${API}/settings/notifications?customerId=999999`)
      .set(bearer(sam))
      .send(body());
    expect(res.status).toBe(404);
    expect(await prisma.notificationSettings.count()).toBe(0);
  });
});

describe("the SLA window is one value for two surfaces", () => {
  // The agreed behaviour: changing it moves the badge on the ticket list as well
  // as the alerts, because the list judges from the number the ticket carries.
  it("rides out on every ticket so the list can judge with it", async () => {
    const morgan = await login(TENANT_ADMIN);
    await request(app)
      .put(`${API}/settings/notifications`)
      .set(bearer(morgan))
      .send(body({ slaWarnMinutes: 90 }))
      .expect(200);

    const list = await request(app).get(`${API}/tickets`).set(bearer(morgan));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const ticket of list.body.data) {
      expect(ticket.slaWarnMs).toBe(90 * 60_000);
    }
  });

  it("falls back to the deployment value while unconfigured", async () => {
    const morgan = await login(TENANT_ADMIN);
    const list = await request(app).get(`${API}/tickets`).set(bearer(morgan));
    expect(list.body.data[0].slaWarnMs).toBe(4 * 60 * 60_000);
  });
});
