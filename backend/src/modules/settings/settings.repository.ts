import { prisma } from "../../shared/db";
import {
  deploymentDefaults,
  type EffectiveSettings,
  type SettingsDto,
  type StoredSettings,
} from "./settings.types";

type Row = {
  customerId: number;
  disabledEvents: string[];
  ratePerTicket: number;
  rateWindowMs: number;
  slaWarnMs: number;
  updatedAt: Date;
};

function toEffective(row: Row): EffectiveSettings {
  return {
    disabledEvents: new Set(row.disabledEvents),
    ratePerTicket: row.ratePerTicket,
    rateWindowMs: row.rateWindowMs,
    slaWarnMs: row.slaWarnMs,
    configured: true,
  };
}

export const settingsRepository = {
  /**
   * One customer's policy, resolved. Falls back to the deployment defaults when
   * nothing is stored — an absent row means "unconfigured", not "everything off".
   */
  async effectiveFor(customerId: number): Promise<EffectiveSettings> {
    const row = await prisma.notificationSettings.findUnique({
      where: { customerId },
    });
    return row ? toEffective(row) : deploymentDefaults();
  },

  /**
   * Resolve several customers at once — one query for a whole sweep batch
   * rather than one per mail. Customers with no row get the defaults, so the
   * returned map always answers for every id asked about.
   */
  async effectiveForMany(
    customerIds: readonly number[],
  ): Promise<Map<number, EffectiveSettings>> {
    const out = new Map<number, EffectiveSettings>();
    const ids = [...new Set(customerIds)];
    if (ids.length === 0) return out;
    const rows = await prisma.notificationSettings.findMany({
      where: { customerId: { in: ids } },
    });
    for (const row of rows) out.set(row.customerId, toEffective(row));
    for (const id of ids) if (!out.has(id)) out.set(id, deploymentDefaults());
    return out;
  },

  /**
   * The largest SLA warning window in force anywhere, deployment default
   * included.
   *
   * The alert sweep uses it to size its candidate query: it must fetch every
   * ticket that ANY customer might consider at risk, then judge each against its
   * own tenant's window. Querying on one customer's window would silently skip
   * tickets belonging to a customer who watches further ahead.
   */
  async widestSlaWarnMs(): Promise<number> {
    const max = await prisma.notificationSettings.aggregate({
      _max: { slaWarnMs: true },
    });
    return Math.max(deploymentDefaults().slaWarnMs, max._max.slaWarnMs ?? 0);
  },

  /** The settings screen's read: what is stored, or the defaults it would start from. */
  async findForScreen(customerId: number): Promise<SettingsDto> {
    const row = await prisma.notificationSettings.findUnique({
      where: { customerId },
    });
    if (!row) {
      const d = deploymentDefaults();
      return {
        customerId,
        disabledEvents: [...d.disabledEvents],
        ratePerTicket: d.ratePerTicket,
        rateWindowMs: d.rateWindowMs,
        slaWarnMs: d.slaWarnMs,
        configured: false,
        updatedAt: null,
      };
    }
    return {
      customerId,
      disabledEvents: row.disabledEvents,
      ratePerTicket: row.ratePerTicket,
      rateWindowMs: row.rateWindowMs,
      slaWarnMs: row.slaWarnMs,
      configured: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  /**
   * Write a customer's policy, creating the row on first save.
   *
   * An upsert rather than create-or-update: two managers saving at once would
   * otherwise race on the check, and the loser would fail on the unique index
   * for no reason a person could act on.
   */
  async save(
    customerId: number,
    data: StoredSettings,
    updatedById: number,
  ): Promise<SettingsDto> {
    const row = await prisma.notificationSettings.upsert({
      where: { customerId },
      create: { customerId, ...data, updatedById },
      update: { ...data, updatedById },
    });
    return {
      customerId,
      disabledEvents: row.disabledEvents,
      ratePerTicket: row.ratePerTicket,
      rateWindowMs: row.rateWindowMs,
      slaWarnMs: row.slaWarnMs,
      configured: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  /**
   * Back to unconfigured — the row is removed rather than rewritten with today's
   * defaults, so the customer follows the deployment's defaults as they change
   * instead of freezing a copy of them.
   */
  async clear(customerId: number): Promise<void> {
    await prisma.notificationSettings.deleteMany({ where: { customerId } });
  },
};
