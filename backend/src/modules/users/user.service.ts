import {
  BadRequest,
  CannotActOnSelf,
  Forbidden,
  HasOpenQueue,
  LastAdmin,
  NotFound,
  PlatformStaffOnly,
} from "../../shared/errors";
import {
  customerReach,
  isPlatformWide,
  mayApproveRegistration,
  mayGrantReach,
  type AuthUser,
} from "../../shared/auth";
import { Prisma } from "@prisma/client";
import type { Role, UserStatus } from "../../shared/domain";
import type { Lang } from "../../shared/i18n";
import { authMail } from "../auth/auth.mail";
import { hashPassword } from "../auth/auth.password";
import { userRepository, type UserDto } from "./user.repository";

export const userService = {
  list(
    actor: AuthUser,
    filters: {
      q?: string;
      role?: Role;
      status?: UserStatus;
      customerId?: number;
    } = {},
  ): Promise<UserDto[]> {
    return userRepository.findMany(actor, filters);
  },

  /**
   * Create an account on somebody's behalf, with a password chosen here.
   *
   * The gates are `approve`'s, and deliberately the same ones: creating an
   * account and approving a registration are the same decision arrived at from
   * different directions — both end with a named person inside a chosen tenant
   * holding a chosen role. A create endpoint with a laxer gate would be a way
   * round the approval one, so the two must not drift; that is why this reads
   * `mayApproveRegistration` rather than a predicate of its own.
   *
   * What it does NOT do is mail anybody. There is nothing to send that is safe
   * to send: the password is the credential, and putting it in an email is how
   * a temporary password becomes a permanent one sitting in a mailbox. The
   * administrator hands it over themselves, by whatever means they trust, and
   * the account cannot do anything until the person replaces it.
   */
  async create(
    input: {
      name: string;
      email: string;
      password: string;
      role: Role;
      customerId: number;
    },
    actor: AuthUser,
  ): Promise<UserDto> {
    if (!mayApproveRegistration(actor)) {
      throw PlatformStaffOnly("create_user");
    }
    if (input.role === "super_admin" && !isPlatformWide(actor)) {
      throw PlatformStaffOnly("grant_super_admin");
    }
    const customer = await userRepository.findCustomerById(input.customerId);
    if (!customer) throw BadRequest(`Unknown customer #${input.customerId}`);

    // Normalised exactly as `register` and the email intake normalise it, or an
    // address created here with a capital letter could not be signed in with —
    // `login` looks up the lowercased form. See auth.service.login.
    const email = input.email.trim().toLowerCase();
    try {
      return await userRepository.createByAdmin(
        {
          name: input.name.trim(),
          email,
          passwordHash: await hashPassword(input.password),
          role: input.role,
          customerId: input.customerId,
        },
        actor,
      );
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      ) {
        // Named, unlike the sign-up form's uniform answer: this endpoint is
        // reachable only by platform-wide staff, who can already list every
        // account, so there is nothing here to leak — and an administrator who
        // is not told will simply try again.
        throw BadRequest(`${email} already has an account`);
      }
      throw cause;
    }
  },

  /**
   * Approve a registration into a customer, with a role.
   *
   * Three gates, in the order a caller meets them, each answering the most
   * specific thing wrong with the request:
   *
   *   not platform-wide     → 403 before anything is read. Approving CHOOSES the
   *                           tenant, which is the same shape of act as granting
   *                           reach (see `mayApproveRegistration`).
   *   granting super_admin  → 403 unless platform-wide. Redundant today, since
   *                           the gate above already requires it — stated anyway
   *                           so that loosening one does not silently loosen the
   *                           other, which is exactly how the top role leaks.
   *   unknown customer      → 400 naming it, rather than writing a person into a
   *                           tenant that does not exist.
   *
   * The account is mailed that it is through. Fire-and-forget for the same
   * reason the auth mail is: an approval must not fail because a mail server
   * did, and the person can be told again by any administrator.
   */
  async approve(
    id: number,
    data: { customerId: number; role: Role },
    actor: AuthUser,
  ): Promise<UserDto> {
    if (!mayApproveRegistration(actor)) {
      throw PlatformStaffOnly("approve_registration");
    }
    if (data.role === "super_admin" && !isPlatformWide(actor)) {
      throw PlatformStaffOnly("grant_super_admin");
    }
    const customer = await userRepository.findCustomerById(data.customerId);
    if (!customer) throw BadRequest(`Unknown customer #${data.customerId}`);

    const result = await userRepository.approveRegistration(id, data, actor);
    if (result === null) throw NotFound(`User #${id} not found`);
    if (result === "not_pending") {
      // Named rather than a bare 409: two administrators working the queue at
      // once is the ordinary case, and "somebody already dealt with it" is what
      // the second one needs to read.
      throw BadRequest(
        "That registration has already been decided — reload the queue",
      );
    }
    authMail.sendApproved(result.email, result.language ?? undefined);
    return result;
  },

  async reject(
    id: number,
    reason: string | undefined,
    actor: AuthUser,
  ): Promise<UserDto> {
    if (!mayApproveRegistration(actor)) {
      throw PlatformStaffOnly("decide_registration");
    }
    const result = await userRepository.rejectRegistration(id, reason, actor);
    if (result === null) throw NotFound(`User #${id} not found`);
    if (result === "not_pending") {
      throw BadRequest(
        "That registration has already been decided — reload the queue",
      );
    }
    // Deliberately NOT mailed. A rejection is a decision somebody may want to
    // deliver themselves, in their own words, and an automatic "you were turned
    // down" from a help desk is the wrong way for a person to find out.
    return result;
  },

  async get(id: number, actor: AuthUser): Promise<UserDto> {
    const user = await userRepository.findById(id, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  async update(
    id: number,
    data: {
      role?: Role;
      teamId?: number | null;
      projectId?: number | null;
      availableForAssignment?: boolean;
      isActive?: boolean;
    },
    actor: AuthUser,
  ): Promise<UserDto> {
    // Granting the top role stays with the platform, not with a single customer's
    // super_admin. This is the same rule as before under the old names — it was
    // "only an admin may grant admin", and the old admin was precisely the
    // platform-wide principal. Keying on reach rather than role name is what keeps
    // it that way now that a customer's own manager shares the super_admin role:
    // otherwise they could promote themselves past their own tenant.
    if (data.role === "super_admin" && !isPlatformWide(actor)) {
      throw PlatformStaffOnly("grant_super_admin");
    }
    // Closing your own account is never the intent — it is a locked-out
    // administrator and a support call. Answered first because it is the most
    // specific thing wrong with the request: true whoever you are, and actionable
    // without knowing anything about who else holds the role.
    if (data.isActive === false && id === actor.id) {
      throw CannotActOnSelf("deactivate");
    }

    /**
     * Don't let the last person who can administer something be taken away.
     *
     * Both a deactivation and a demotion do it, so the check keys on the effect
     * rather than on which field was sent. It runs before the queue check below
     * because it is the more expensive mistake: a queue can be handed over
     * afterwards, whereas the platform losing its only super admin cannot be
     * undone from inside the product — only a platform-wide super admin may grant
     * that role.
     */
    const losesTheRole =
      data.isActive === false ||
      (data.role !== undefined && data.role !== "super_admin");
    if (losesTheRole) {
      const standing = await userRepository.findAdminStanding(id);
      // A missing target is the repository's 404 to report, not this check's.
      if (standing?.role === "super_admin" && standing.others === 0) {
        throw LastAdmin(standing.customerId == null ? "platform" : "customer");
      }
    }

    if (data.isActive === false) {
      // Work still on their desk has to go somewhere first. The handover queue
      // exists for exactly this, and doing it silently here would either strand
      // the tickets on a closed account or move them without anyone choosing
      // where — so the API insists on the order instead of guessing.
      const open = await userRepository.countOpenAssigned(id, actor);
      if (open > 0) {
        throw HasOpenQueue(open);
      }
    }
    // Scope is enforced in the repository (customer-bound actors → their own
    // customer only); an out-of-scope target 404s.
    const user = await userRepository.update(id, data, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  /**
   * Self-service: the acting user edits their own profile — display name, and
   * whether they are currently accepting routed work ("I'm out"). Deliberately
   * cannot touch role, team, or project: those are management decisions.
   */
  async updateProfile(
    data: { name?: string; availableForAssignment?: boolean; language?: Lang },
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await userRepository.updateProfile(actor.id, data, actor.id);
    if (!user) throw NotFound(`User #${actor.id} not found`);
    return user;
  },

  /**
   * Set which customers a member of staff may work beyond their own.
   *
   * Platform-wide only — see `mayGrantReach`. This is the one endpoint that
   * moves someone across the tenant boundary, so anyone who could call it for
   * themselves would be their own approver, and an admin who may create a
   * customer must not also be able to walk into one.
   *
   * The rules, in the order a caller meets them:
   *   not platform-wide      → 403, before anything is read
   *   granting to yourself   → 403, even platform-wide; reach you award yourself
   *                            is not reviewed by anyone
   *   target is a requester  → 400; `ticketScopeWhere` gives role `user` their
   *                            own tickets whatever their reach, so a grant here
   *                            would be a setting that reads as effective and
   *                            does nothing
   *   unknown customer id    → 400 naming it, rather than storing a grant into a
   *                            tenant that does not exist
   *   unknown user           → 404
   */
  async setReach(
    id: number,
    customerIds: number[],
    actor: AuthUser,
  ): Promise<UserDto> {
    if (!mayGrantReach(actor)) {
      throw Forbidden(
        "Only a platform super admin can give someone access to another customer",
      );
    }
    if (id === actor.id) {
      throw CannotActOnSelf("customer_access");
    }

    const wanted = [...new Set(customerIds)];
    const role = await userRepository.findRole(id);
    if (role == null) throw NotFound(`User #${id} not found`);
    if (role === "user" && wanted.length > 0) {
      throw BadRequest(
        "Only staff can be given access to another customer — a requester always " +
          "sees just their own tickets",
      );
    }

    const known = new Set(await userRepository.existingCustomerIds(wanted));
    const missing = wanted.filter((c) => !known.has(c));
    if (missing.length > 0) {
      throw BadRequest(`Unknown customer #${missing[0]}`);
    }

    const user = await userRepository.setReach(id, wanted, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },
};
