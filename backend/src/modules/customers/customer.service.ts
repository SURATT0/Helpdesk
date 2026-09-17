import { hasPermission, isPlatformWide, type AuthUser } from "../../shared/auth";
import {
  BadRequest,
  CustomerNotEmpty,
  NotFound,
  NotYoursToManage,
} from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import {
  customerRepository,
  type CustomerArchiveImpact,
  type CustomerDto,
} from "./customer.repository";

/**
 * The permission archiving a customer needs.
 *
 * The starting matrix gives it to `super_admin` and to nobody else — the same
 * arrangement `project:delete` and `ticket:delete` use. Creating a tenant is an
 * admin's job; ending one is not the same act, and the asymmetry is deliberate:
 * a mistaken create leaves an empty row nobody has to care about, while an
 * archive removes a company from every picker at once.
 *
 * Where it goes from there is the desk's to decide — `role_permissions` is
 * editable, and this gate reads the live grant, not the list it started from.
 */
export const CUSTOMER_ARCHIVE = "customer:archive";

/**
 * The permission creating or renaming a customer needs.
 *
 * It used to be a role comparison here — `admin` or above. Now that the grants
 * are editable it is a permission like any other, which is what lets somebody
 * change who may do it without a deploy. The starting grants give it to exactly
 * the roles the comparison did, so nothing moved on the day of the change.
 *
 * Note what it does NOT confer: an admin who creates a customer cannot see into
 * it (reach is a separate axis) and cannot grant themselves reach
 * (`mayGrantReach` is platform-wide only, and stays a predicate rather than a
 * permission for that reason). The worst a misuse produces is an empty tenant
 * somebody else has to tidy up, not a way into anyone's data.
 */
export const CUSTOMER_WRITE = "customer:write";

function mayManage(actor: AuthUser): boolean {
  return hasPermission(actor, CUSTOMER_WRITE);
}

function assertMayManage(actor: AuthUser): void {
  if (!mayManage(actor)) {
    throw NotYoursToManage("customers");
  }
}

/**
 * Bringing a tenant into existence, or ending one, is platform work — so it asks
 * for platform reach on top of the permission.
 *
 * Reach is not a nicety here, it is what makes the answer honest. A customer is
 * created outside everybody's reach by definition: nothing grants the creator
 * access to it, because `mayGrantReach` is platform-wide only and deliberately
 * stricter than the permission to create (otherwise anyone could make a tenant
 * and walk into it unreviewed). So a creator who is not platform-wide got a 201
 * for a row they could not then list, open or rename — and the screen, which
 * sends you to the new customer's page, landed them on a 404 one heartbeat after
 * being told it worked. Every retry left another orphan tenant behind.
 *
 * Refusing up front is the truthful version of the same rule: a caller who could
 * not see the result is told so instead of being handed one they cannot have.
 *
 * This narrows `customer:write` — an `admin` holds it and is never platform-wide,
 * so an admin no longer creates tenants. That is the same trade: what they got
 * before was an invisible row somebody else had to find and tidy up.
 */
function assertMayManagePlatform(actor: AuthUser): void {
  assertMayManage(actor);
  if (!isPlatformWide(actor)) {
    throw NotYoursToManage("customers");
  }
}

/**
 * Gate an archive, recording the refusal against the customer it named.
 *
 * Platform reach as well as the permission, for the same reason `create` asks
 * for it: ending a tenant is platform work. Row scope already stops a
 * tenant-scoped super admin reaching a customer that is not theirs — the impact
 * read is scoped and answers 404 — so what this adds is the one case scope would
 * have allowed, somebody archiving the company they themselves belong to.
 */
function assertMayArchive(actor: AuthUser, customerId?: number): void {
  if (hasPermission(actor, CUSTOMER_ARCHIVE) && isPlatformWide(actor)) return;
  if (customerId != null) {
    // Fire-and-forget: the refusal is the answer, and failing to write the
    // trail must not turn a clean 403 into a 500. Same shape as the project
    // deletion guard.
    void auditRepository
      .record({
        userId: actor.id,
        action: "customer.archive_denied",
        entity: "customer",
        entityId: customerId,
        meta: {
          actorRole: actor.role,
          permission: CUSTOMER_ARCHIVE,
          platformWide: isPlatformWide(actor),
        },
      })
      .catch(() => {});
  }
  throw NotYoursToManage("customer_archive");
}

export const customerService = {
  /**
   * The tenants this principal reaches. Read by every picker, so it is
   * deliberately open to any authenticated caller — the list is only ever their
   * own reach, and seeing the name of a company you already work in tells you
   * nothing you did not have.
   */
  list(actor: AuthUser): Promise<CustomerDto[]> {
    return customerRepository.findMany(actor);
  },

  async get(id: number, actor: AuthUser): Promise<CustomerDto> {
    const customer = await customerRepository.findById(id, actor);
    if (!customer) throw NotFound(`Customer #${id} not found`);
    return customer;
  },

  async create(name: string, actor: AuthUser): Promise<CustomerDto> {
    assertMayManagePlatform(actor);
    const trimmed = name.trim();

    // Checked before the insert so the answer can say WHICH kind of collision it
    // is. An archived namesake is a different situation from a live one — the
    // right move there is to revive the old row, and a bare "name taken" would
    // send someone hunting through a list that does not contain it.
    const clash = await customerRepository.findByName(trimmed);
    if (clash) {
      throw BadRequest(
        clash.deletedAt
          ? `An archived customer is already called "${trimmed}" — restore it instead of creating a second one`
          : `A customer is already called "${trimmed}"`,
      );
    }
    return customerRepository.create(trimmed, actor);
  },

  async rename(id: number, name: string, actor: AuthUser): Promise<CustomerDto> {
    assertMayManage(actor);
    const trimmed = name.trim();
    const clash = await customerRepository.findByName(trimmed);
    if (clash && clash.id !== id) {
      throw BadRequest(
        clash.deletedAt
          ? `An archived customer is already called "${trimmed}"`
          : `A customer is already called "${trimmed}"`,
      );
    }
    const updated = await customerRepository.rename(id, trimmed, actor);
    if (!updated) throw NotFound(`Customer #${id} not found`);
    return updated;
  },

  /**
   * What archiving would be refused for — read by the confirmation dialog, so
   * the number a person is shown is the number the guard refuses on.
   *
   * Behind the same permission as the archive itself: telling someone who may
   * not archive how much a tenant is carrying is answering the question anyway.
   */
  async archiveImpact(
    id: number,
    actor: AuthUser,
  ): Promise<CustomerArchiveImpact> {
    assertMayArchive(actor);
    const impact = await customerRepository.findArchiveImpact(id, actor);
    if (!impact) throw NotFound(`Customer #${id} not found`);
    return impact;
  },

  /**
   * Archive a customer.
   *
   * The order matters and mirrors the project deletion: permission FIRST, before
   * any read, so a caller without it never causes a query and the refusal cannot
   * be told apart from one for a customer that does not exist. Then row scope
   * (404), then the emptiness guard (409).
   */
  async archive(id: number, actor: AuthUser): Promise<void> {
    assertMayArchive(actor, id);

    const impact = await customerRepository.findArchiveImpact(id, actor);
    if (!impact) throw NotFound(`Customer #${id} not found`);
    if (impact.projects > 0 || impact.tickets > 0 || impact.users > 0) {
      throw CustomerNotEmpty(impact);
    }

    // A refusal here means the guarded re-count inside the transaction found
    // something the read above did not — somebody raised a ticket, or added a
    // project, in between. Reported as the same 409 with the numbers THAT
    // transaction saw, not the ones from before it: the previous version passed
    // `max(impact.tickets, 1)` so the message would have something to name, and
    // on a tenant with no tickets at all it said there was one.
    const archived = await customerRepository.archive(id, actor);
    if (!archived.ok) {
      throw CustomerNotEmpty(archived.blocking);
    }
  },
};
