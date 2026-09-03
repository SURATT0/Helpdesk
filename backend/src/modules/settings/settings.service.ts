import { isPlatformWide, type AuthUser } from "../../shared/auth";
import { BadRequest, Forbidden, NotFound } from "../../shared/errors";
import { prisma } from "../../shared/db";
import { EMAIL_EVENTS } from "../emails/email.events";
import { auditRepository } from "../audit/audit.repository";
import { settingsRepository } from "./settings.repository";
import { isKnownEvent, type SettingsDto, type StoredSettings } from "./settings.types";

/**
 * Who may read and write a customer's notification policy.
 *
 * The two axes stay apart here as everywhere else: the ROLE says whether you may
 * manage settings at all (the routes require `settings:write`, which only the
 * top tier holds), and `customerId` says WHOSE settings you may reach. A
 * customer's own super_admin manages their tenant and no other; a platform-wide
 * super_admin — top role AND no customer of their own, which is what
 * `isPlatformWide` means — reaches every tenant.
 *
 * Returns the customer id the caller is allowed to act on. Staff with no
 * customer who are not platform-wide have no tenant to manage and are refused,
 * rather than silently defaulting to somebody's.
 */
function resolveTarget(actor: AuthUser, requested?: number): number {
  if (isPlatformWide(actor)) {
    if (requested == null) {
      throw BadRequest(
        "Name the customer whose notification settings you mean — platform-wide " +
          "staff belong to no tenant, so there is no default one to edit",
      );
    }
    return requested;
  }
  if (actor.customerId == null) {
    throw Forbidden(
      "You belong to no customer, so there are no notification settings to manage",
    );
  }
  // A tenant's manager may name their own customer explicitly, but nothing else.
  if (requested != null && requested !== actor.customerId) {
    throw Forbidden("You may only manage your own customer's notification settings");
  }
  return actor.customerId;
}

export const settingsService = {
  async get(actor: AuthUser, requested?: number): Promise<SettingsDto> {
    const customerId = resolveTarget(actor, requested);
    await assertCustomerExists(customerId);
    return settingsRepository.findForScreen(customerId);
  },

  async update(
    actor: AuthUser,
    data: StoredSettings,
    requested?: number,
  ): Promise<SettingsDto> {
    const customerId = resolveTarget(actor, requested);
    await assertCustomerExists(customerId);

    // An unknown event type would sit in the deny list doing nothing, and would
    // read as "this is switched off" on a screen that never mails it anyway.
    const unknown = data.disabledEvents.filter((e) => !isKnownEvent(e, EMAIL_EVENTS));
    if (unknown.length > 0) {
      throw BadRequest(`Unknown notification event: ${unknown.join(", ")}`);
    }

    const saved = await settingsRepository.save(customerId, data, actor.id);
    await auditRepository.record({
      userId: actor.id,
      action: "settings.notifications_update",
      entity: "customer",
      entityId: customerId,
      meta: {
        disabledEvents: data.disabledEvents,
        ratePerTicket: data.ratePerTicket,
        rateWindowMs: data.rateWindowMs,
        slaWarnMs: data.slaWarnMs,
      },
    });
    return saved;
  },

  /** Drop the stored row so the customer follows the deployment defaults again. */
  async reset(actor: AuthUser, requested?: number): Promise<SettingsDto> {
    const customerId = resolveTarget(actor, requested);
    await assertCustomerExists(customerId);
    await settingsRepository.clear(customerId);
    await auditRepository.record({
      userId: actor.id,
      action: "settings.notifications_reset",
      entity: "customer",
      entityId: customerId,
      meta: {},
    });
    return settingsRepository.findForScreen(customerId);
  },
};

/**
 * A customer id from the caller is data, so it is checked before anything is
 * written against it — an upsert would otherwise happily create a policy row for
 * a tenant that does not exist, and the foreign key would report it as a 500.
 */
async function assertCustomerExists(customerId: number): Promise<void> {
  const found = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!found) throw NotFound(`Customer #${customerId} not found`);
}
