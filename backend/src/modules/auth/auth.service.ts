import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { BadRequest, Unauthorized } from "../../shared/errors";
import { maySignIn, type Role, type UserStatus } from "../../shared/domain";
import { DEFAULT_LANG, type Lang } from "../../shared/i18n";
import { customerReach, isPlatformWide } from "../../shared/auth";
import { authMail } from "./auth.mail";
import { hashPassword, verifyPassword } from "./auth.password";
import { authRepository } from "./auth.repository";
import {
  generateRefreshToken,
  generateUserToken,
  hashRefreshToken,
  hashUserToken,
  signAccessToken,
} from "./auth.tokens";

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  teamId: number | null;
  /**
   * Whether routed work is currently sent to this person. Part of the session
   * payload because every user may toggle their own away state, including
   * requesters, who hold no `user:read` permission and so cannot find themselves
   * in the user directory.
   */
  availableForAssignment: boolean;
  /**
   * The language this person has CHOSEN, or null if they never have.
   *
   * In the session payload so the web app can open in their language on the
   * first paint rather than in whatever this browser's localStorage remembers —
   * on a shared machine that is the previous person's choice, not this one's.
   * Null is passed through rather than defaulted here: the client's fallback
   * (English) is not the mailer's (Thai), so the decision belongs to each of
   * them and not to this DTO.
   */
  language: Lang | null;
  /**
   * Whether this principal reaches every customer, including ones created
   * later. The ANSWER, not the inputs it is computed from.
   *
   * The client needs it to decide whether to offer cross-tenant controls at
   * all, and shipping `customerId` for the client to test itself would be a
   * second copy of `isPlatformWide` — in a language where nobody would notice
   * it drifting from the server's. The server decides; the client is told.
   */
  platformWide: boolean;
};

export type Session = {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  /** Raw refresh token — the controller puts this in an httpOnly cookie. */
  refreshToken: string;
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** Null = the address has never been proven. See User.emailVerifiedAt. */
  emailVerifiedAt: Date | null;
  teamId: number | null;
  customerId: number | null;
  passwordHash: string | null;
  availableForAssignment: boolean;
  isActive: boolean;
  language: Lang | null;
  team: { department: string } | null;
  /** Customers this person may reach beyond their own. See UserCustomer. */
  reachGrants: { customerId: number }[];
};

/**
 * A deactivated account cannot start or continue a session.
 *
 * Named apart from the credential failure on purpose. It is only ever reached
 * *after* the password has already been verified (or a valid refresh cookie
 * presented), so saying what is actually wrong tells an attacker nothing they did
 * not already have — and telling a real person "invalid email or password" when
 * their password is fine sends them to reset it, twice, before they call anyone.
 */
const Deactivated = () =>
  Unauthorized("This account has been deactivated — contact your administrator");

/**
 * Why an account that got its password right still may not come in.
 *
 * Reached only AFTER the password has been verified, exactly like `Deactivated`
 * above, and named for the same reason: at that point the caller has already
 * proved they own the account, so telling them what is actually wrong reveals
 * nothing they did not have — and a person told "invalid email or password" when
 * their password is correct will reset it twice before they ask anyone.
 *
 * One message per state, because each needs a different thing done about it and
 * only one of them is the person's own to do.
 */
function signInRefusal(user: {
  status: UserStatus;
  emailVerifiedAt: Date | null;
}) {
  // The two terminal states come first. Somebody who was turned down or shut off
  // has nothing to gain from being sent to their inbox to confirm an address.
  if (user.status === "rejected") {
    return Unauthorized("This registration was not approved — contact your administrator");
  }
  if (user.status === "suspended") {
    return Unauthorized("This account has been suspended — contact your administrator");
  }
  // Then the step that IS theirs to take.
  if (user.emailVerifiedAt == null) {
    return Unauthorized(
      "Confirm your email address first — check your inbox for the confirmation link",
    );
  }
  if (user.status === "pending") {
    return Unauthorized(
      "Your account is waiting for an administrator to approve it. You will be emailed when it is.",
    );
  }
  return null;
}

function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    teamId: u.teamId,
    availableForAssignment: u.availableForAssignment,
    language: u.language,
    platformWide: isPlatformWide(u),
  };
}

/** Sign an access token and mint + persist a fresh refresh token in a family. */
async function mintSession(user: UserRow, familyId: string): Promise<Session> {
  const refreshToken = generateRefreshToken();
  await authRepository.createRefreshToken({
    userId: user.id,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + env.refreshTtlSec * 1000),
  });
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      teamId: user.teamId,
      department: user.team?.department ?? null,
      customerId: user.customerId,
      // Resolved at sign time, so reach is fixed for the life of the token.
      // Revoking a grant therefore bites at the next refresh rather than the
      // next request — the same 15-minute lag the role and the tenant have
      // always had, and the reason the access token is short-lived.
      customerIds: customerReach({
        customerId: user.customerId,
        customerIds: user.reachGrants.map((g) => g.customerId),
      }),
    }),
    expiresIn: env.accessTtlSec,
    refreshToken,
  };
}

export const authService = {
  async login(email: string, password: string): Promise<Session> {
    const user = await authRepository.findUserByEmail(email);
    // Uniform error + always-compare guards against user enumeration / timing.
    // `verifyPassword` spends bcrypt's time even when there is no stored hash,
    // so an address with no account and an address whose account has no password
    // (email intake creates those) answer in the same time as a real one.
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !user.passwordHash || !ok) {
      throw Unauthorized("Invalid email or password");
    }
    // Everything below is checked AFTER the compare, so a wrong password still
    // answers uniformly and none of these states is something you can probe for.
    if (!user.isActive) throw Deactivated();
    const refusal = signInRefusal(user);
    if (refusal) throw refusal;
    await authRepository.deleteExpired(user.id); // opportunistic cleanup
    return mintSession(user, randomUUID());
  },

  /**
   * Self-registration. Answers IDENTICALLY whether or not the address is already
   * taken.
   *
   * That uniformity is the whole design of this method, and it is why it returns
   * nothing. A reply that differed — "email already in use" — would turn the
   * public sign-up form into a membership oracle for the desk: submit an address,
   * learn whether that person works here. The owner of the address is still told
   * what happened, by mail (`sendAlreadyRegistered`), because they are the party
   * entitled to know.
   *
   * Uniform in TIME as well as in words, which is why the password is hashed
   * BEFORE the lookup rather than only on the create path. bcrypt at cost 12 is
   * the most expensive thing either branch does, and skipping it when the
   * address exists would make "taken" measurably faster than "free" — the same
   * oracle, read off a stopwatch instead of the response body.
   */
  async register(input: {
    email: string;
    name: string;
    password: string;
    lang?: Lang;
  }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const lang = input.lang ?? DEFAULT_LANG;
    const passwordHash = await hashPassword(input.password);

    const existing = await authRepository.findUserByEmailInsensitive(email);
    if (existing) {
      // Their stored spelling, not the one just submitted — the mail goes to the
      // address as it is held on the account.
      authMail.sendAlreadyRegistered(existing.email, lang);
      return;
    }

    let user;
    try {
      user = await authRepository.createSelfRegistered({
        name: input.name.trim(),
        email,
        passwordHash,
      });
    } catch (cause) {
      // Lost the race to another registration of the same address, between the
      // lookup above and this insert.
      //
      // Answering uniformly here is not tidiness — without it the check above is
      // defeated by simply submitting twice at once. A taken address makes both
      // requests take the `existing` branch and answer 202; a free one lets the
      // first through and gives the second a 409 from the unique index. So the
      // pair of replies would say which case it was, which is exactly the
      // question the uniform reply exists to refuse.
      //
      // Nothing is mailed: the request that won a moment ago has already sent
      // the confirmation, and a second copy would be noise.
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      ) {
        return;
      }
      throw cause;
    }
    const token = generateUserToken();
    await authRepository.issueUserToken({
      userId: user.id,
      purpose: "email_verification",
      tokenHash: hashUserToken(token),
      expiresAt: new Date(Date.now() + env.emailVerificationTtlSec * 1000),
    });
    authMail.sendEmailVerification(user.email, user.name, token, lang);
  },

  /**
   * Redeem an email-confirmation link.
   *
   * Says what to do next rather than just succeeding, because confirming is not
   * the last step: the account is still `pending` and still sees nothing. A page
   * that said "you're all set" would be lying, and the person would go straight
   * to the sign-in form and be refused.
   */
  async verifyEmail(rawToken: string): Promise<{ status: UserStatus }> {
    const row = await authRepository.findUserToken(hashUserToken(rawToken));
    if (
      !row ||
      row.purpose !== "email_verification" ||
      row.usedAt != null ||
      row.expiresAt.getTime() < Date.now()
    ) {
      // One message for all four causes. Which one it was is not useful to a
      // person holding a dead link — they need a new one either way — and
      // distinguishing "already used" from "never existed" tells anyone probing
      // tokens which guesses were close.
      throw BadRequest("This confirmation link is no longer valid — request a new one");
    }
    const redeemed = await authRepository.redeemEmailVerification({
      tokenId: row.id,
      userId: row.userId,
    });
    if (!redeemed) {
      // Lost a race with a second click on the same link. The address is
      // confirmed either way, so this is not worth an error the person can act
      // on — but the row is gone, so it cannot be reported as this call's work.
      throw BadRequest("This confirmation link is no longer valid — request a new one");
    }
    return { status: row.user.status };
  },

  /**
   * Begin a password reset. Returns nothing, always, and the controller answers
   * the same sentence either way.
   *
   * The uniform answer is the requirement; these are the conditions under which
   * a link is actually sent, none of which the caller can observe:
   *
   *   - the address has an account, and
   *   - that account HAS a password. Email intake creates rows with none for
   *     anyone who writes in, and those people never registered. Without this
   *     condition, mailing the desk would be enough to have an account created
   *     and then "reset" your way into that customer's tenant — which is the
   *     escalation path the passwordless row would otherwise open.
   *   - and it was not rejected. `pending` and `suspended` MAY reset: they still
   *     cannot sign in (that is the login gate's job, and it is a separate
   *     decision), and refusing here would leave someone who forgot their
   *     password unable to fix it before their approval lands.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await authRepository.findUserByEmailInsensitive(
      email.trim().toLowerCase(),
    );
    if (!user || user.passwordHash == null || user.status === "rejected") return;

    const token = generateUserToken();
    await authRepository.issueUserToken({
      userId: user.id,
      purpose: "password_reset",
      tokenHash: hashUserToken(token),
      expiresAt: new Date(Date.now() + env.passwordResetTtlSec * 1000),
    });
    authMail.sendPasswordReset(user.email, token);
  },

  /**
   * Redeem a reset link and set the new password.
   *
   * Single-use is enforced twice, and the second one is the one that counts: the
   * check below rejects a token already marked used, and the UPDATE inside
   * `redeemPasswordReset` matches only on `usedAt: null`, so two requests
   * carrying the same token in the same instant cannot both set a password.
   *
   * Every session ends here too, in the same transaction. Whoever prompted the
   * reset is the reason it was requested; leaving their refresh cookie working
   * for another seven days would make the reset theatre.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const row = await authRepository.findUserToken(hashUserToken(rawToken));
    if (
      !row ||
      row.purpose !== "password_reset" ||
      row.usedAt != null ||
      row.expiresAt.getTime() < Date.now()
    ) {
      throw BadRequest("This reset link is no longer valid — request a new one");
    }
    const redeemed = await authRepository.redeemPasswordReset({
      tokenId: row.id,
      userId: row.userId,
      passwordHash: await hashPassword(newPassword),
    });
    if (!redeemed) {
      throw BadRequest("This reset link is no longer valid — request a new one");
    }
  },

  async refresh(rawToken: string): Promise<Session> {
    const row = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (!row) throw Unauthorized("Invalid session");

    /**
     * Deactivation has to bite here, not only at the next login. The refresh
     * cookie lives seven days and is what keeps a tab signed in indefinitely, so
     * a check only on the password path would leave a departed employee working
     * until their browser happened to close.
     *
     * The whole family goes with it. Leaving the cookie merely refused would let
     * the client retry it every fifteen minutes forever; revoking makes the
     * session end once, and stays correct if the account is ever switched back on.
     */
    if (!row.user.isActive) {
      await authRepository.revokeFamily(row.familyId);
      throw Deactivated();
    }

    /**
     * And the same for a status that no longer permits a session — a suspension,
     * or an approval withdrawn.
     *
     * This is the moment such a change actually bites. `requireAuth` refuses the
     * access token as soon as it sees a non-active status, but the token it is
     * reading was signed up to fifteen minutes ago and still says `active`; this
     * is where the row is re-read and the session ended for good. Revoking the
     * family rather than merely refusing, for the same reason as above: a client
     * would otherwise retry the cookie every fifteen minutes indefinitely.
     */
    if (!maySignIn(row.user.status)) {
      await authRepository.revokeFamily(row.familyId);
      throw signInRefusal(row.user) ?? Deactivated();
    }

    if (row.revokedAt) {
      // An already-revoked token came back. Usually that IS theft — but not always:
      // two page loads (or two tabs) whose access tokens expired together both
      // refresh with the same cookie, and the second arrives milliseconds after the
      // first rotated it. Treating that as compromise logs an innocent user out and
      // kills the family, which is what made the E2E suite flaky under load.
      //
      // So a replay is served ONLY when both hold:
      //   - it lands inside the leeway after the rotation, and
      //   - the family still has a live token, i.e. a successor was minted.
      // The second condition is what keeps logout final: logout revokes every token
      // in the family, leaving none live, so a replay after it is still refused.
      const revokedMsAgo = Date.now() - row.revokedAt.getTime();
      const withinLeeway =
        env.refreshReuseLeewaySec > 0 &&
        revokedMsAgo <= env.refreshReuseLeewaySec * 1000;

      if (withinLeeway && (await authRepository.hasLiveToken(row.familyId))) {
        // A racing retry, not a replay attack: mint into the same family and leave
        // reuse detection armed for anything outside the window.
        return mintSession(row.user, row.familyId);
      }

      await authRepository.revokeFamily(row.familyId);
      throw Unauthorized("Session reuse detected");
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw Unauthorized("Session expired");
    }

    await authRepository.revokeRefreshToken(row.id); // rotate
    return mintSession(row.user, row.familyId);
  },

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const row = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (row) await authRepository.revokeFamily(row.familyId);
  },

  async me(userId: number): Promise<PublicUser> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw Unauthorized("Session expired");
    // A still-valid access token outlives deactivation by up to its 15 minutes.
    // This is what stops the app rendering for someone already shut out.
    if (!user.isActive) throw Deactivated();
    // Same for a status change. `requireAuth` has already refused anything whose
    // TOKEN says non-active; this catches the window where the token still says
    // active because it was signed before the change.
    const refusal = signInRefusal(user);
    if (refusal) throw refusal;
    return toPublicUser(user);
  },

  /**
   * Delete every past-expiry refresh token, table-wide. Returns the number removed.
   *
   * The login-time cleanup above cannot bound this table on its own: it only ever
   * touches the user doing the logging in, so rows belonging to accounts that stop
   * signing in — a departed employee, a test fixture, a service account used once —
   * stay forever. Expired rows grant nothing (refresh checks `expiresAt`), so this
   * is housekeeping rather than a security fix; what it protects is the table.
   */
  async sweepExpiredSessions(): Promise<number> {
    const { count } = await authRepository.deleteExpiredEverywhere();
    return count;
  },
};
