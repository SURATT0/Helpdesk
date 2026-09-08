import { hasPermission, type AuthUser } from "../../shared/auth";
import {
  BadRequest,
  CustomerNotEmpty,
  Forbidden,
  NotFound,
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
 * Held by no role explicitly, so only `super_admin`'s `*` satisfies it — the
 * same arrangement `project:delete` and `ticket:delete` use. Creating a tenant
 * is an admin's job; ending one is not the same act, and the asymmetry is
 * deliberate: a mistaken create leaves an empty row nobody has to care about,
 * while an archive removes a company from every picker at once.
 */
export const CUSTOMER_ARCHIVE = "customer:archive";

/**
 * May this principal create or rename a customer?
 *
 * `admin` and above, as agreed. Note what it does NOT confer: an admin who
 * creates a customer cannot see into it (reach is a separate axis) and cannot
 * grant themselves reach (`mayGrantReach` is platform-wide only). So the worst
 * a misuse produces is an empty tenant somebody else has to tidy up, not a way
 * into anyone's data.
 */
function mayManage(actor: AuthUser): boolean {
  return actor.role === "admin" || actor.role === "super_admin";
}

function assertMayManage(actor: AuthUser): void {
  if (!mayManage(actor)) {
    throw Forbidden("You don't have permission to manage customers");
  }
}

/** Gate an archive, recording the refusal against the customer it named. */
function assertMayArchive(actor: AuthUser, customerId?: number): void {
  if (hasPermission(actor, CUSTOMER_ARCHIVE)) return;
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
        meta: { actorRole: actor.role, permission: CUSTOMER_ARCHIVE },
      })
      .catch(() => {});
  }
  throw Forbidden("You don't have permission to archive customers");
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
    assertMayManage(actor);
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

    // False means the guarded write found something live after all — someone
    // raised a ticket between the count and the update. Reported as the same
    // 409, because it is the same situation and the caller's next step is the same.
    const archived = await customerRepository.archive(id, actor);
    if (!archived) {
      throw CustomerNotEmpty({
        projects: impact.projects,
        tickets: Math.max(impact.tickets, 1),
        users: impact.users,
      });
    }
  },
};
