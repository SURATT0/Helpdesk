import { describe, it, expect } from "vitest";
import * as errors from "./errors";
import { AppError, ERROR_CODES } from "./errors";

/**
 * The error `code` is a contract with the web app, not an implementation
 * detail.
 *
 * Nothing in this process knows what language the person on the other end
 * reads, so the `message` is for a log and the CODE is what becomes a sentence
 * on a screen — looked up in the client's own dictionary. Two things therefore
 * have to hold, and neither is visible from reading one file: every code a
 * constructor can emit is listed in `ERROR_CODES` (which is what the client
 * mirrors), and anything whose sentence needs a number or a name carries it in
 * `details` rather than only inside English prose the client cannot parse.
 */

/** Every exported factory, called with something plausible. */
const SAMPLES: Array<[string, AppError]> = [
  ["InvalidCredentials", errors.InvalidCredentials()],
  ["AccountDeactivated", errors.AccountDeactivated()],
  ["AccountRejected", errors.AccountRejected()],
  ["AccountSuspended", errors.AccountSuspended()],
  ["EmailNotVerified", errors.EmailNotVerified()],
  ["AccountPendingApproval", errors.AccountPendingApproval()],
  ["AccountNotActive", errors.AccountNotActive()],
  ["SessionExpired", errors.SessionExpired()],
  ["SessionReused", errors.SessionReused()],
  ["VerificationLinkInvalid", errors.VerificationLinkInvalid()],
  ["ResetLinkInvalid", errors.ResetLinkInvalid()],
  ["MissingPermission", errors.MissingPermission("ticket:import")],
  ["NotYourTicketToAnswer", errors.NotYourTicketToAnswer()],
  ["TicketNotAwaitingAnswer", errors.TicketNotAwaitingAnswer("closed")],
  ["SameAssignee", errors.SameAssignee()],
  ["NotAssignable", errors.NotAssignable(7)],
  ["CannotActOnSelf/deactivate", errors.CannotActOnSelf("deactivate")],
  ["CannotActOnSelf/access", errors.CannotActOnSelf("customer_access")],
  ["PlatformStaffOnly", errors.PlatformStaffOnly("grant_super_admin")],
  ["CannotOwnProject", errors.CannotOwnProject(7)],
  ["NotYoursToManage", errors.NotYoursToManage("customers")],
  ["NoFileUploaded", errors.NoFileUploaded()],
  ["UnsupportedFileType", errors.UnsupportedFileType("application/x-msdownload")],
  ["NotAnImage", errors.NotAnImage()],
  ["AttachmentGone", errors.AttachmentGone()],
  ["InternalNotesAreForAgents", errors.InternalNotesAreForAgents()],
  ["CannotDeleteComment", errors.CannotDeleteComment()],
  ["NotYoursToRead", errors.NotYoursToRead("queue")],
  ["WorkloadIsStaffOnly", errors.WorkloadIsStaffOnly()],
  ["SourceNotConfigured", errors.SourceNotConfigured("Jira")],
  ["IllegalTransition", errors.IllegalTransition("closed", "pending")],
  ["ConcurrentStatusChange", errors.ConcurrentStatusChange("new", "closed", "pending")],
  ["ReopenWindowExpired", errors.ReopenWindowExpired()],
  ["LastAdmin", errors.LastAdmin("platform")],
  ["HasOpenQueue", errors.HasOpenQueue(4)],
  ["ProjectHasMembers", errors.ProjectHasMembers(3)],
  [
    "CustomerNotEmpty",
    errors.CustomerNotEmpty({ projects: 1, tickets: 2, users: 3, categories: 4 }),
  ],
  ["NotFound", errors.NotFound()],
  ["BadRequest", errors.BadRequest()],
  ["Unauthorized", errors.Unauthorized()],
  ["Forbidden", errors.Forbidden()],
  ["Conflict", errors.Conflict()],
  ["NotImplemented", errors.NotImplemented()],
  ["ServiceUnavailable", errors.ServiceUnavailable()],
];

describe("every error carries a code the client can translate", () => {
  it.each(SAMPLES)("%s is listed in ERROR_CODES", (_name, err) => {
    expect(ERROR_CODES).toContain(err.code);
  });

  it("uses a 4xx or 5xx status throughout", () => {
    for (const [name, err] of SAMPLES) {
      expect(err.status, name).toBeGreaterThanOrEqual(400);
      expect(err.status, name).toBeLessThan(600);
    }
  });

  it("lists no code twice", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe("anything interpolated is machine-readable too", () => {
  /**
   * The client writes its own sentence in its own language, so it has to be
   * handed the VALUES — it cannot pick "4" back out of "still has 4 unfinished
   * tickets". Every error whose English message varies by a number or a name is
   * listed here with the keys its translation needs.
   */
  const NEEDS: Array<[AppError, string[]]> = [
    [errors.MissingPermission("ticket:import"), ["permission"]],
    [errors.TicketNotAwaitingAnswer("closed"), ["actual"]],
    [errors.NotAssignable(7), ["userId"]],
    [errors.CannotOwnProject(7), ["userId"]],
    [errors.UnsupportedFileType("image/heic"), ["mimetype"]],
    [errors.SourceNotConfigured("Jira"), ["label"]],
    [errors.PlatformStaffOnly("grant_super_admin"), ["act"]],
    [errors.NotYoursToManage("projects"), ["subject"]],
    [errors.NotYoursToRead("audit"), ["scope"]],
    [errors.IllegalTransition("closed", "pending"), ["from", "to"]],
    [
      errors.ConcurrentStatusChange("new", "closed", "pending"),
      ["attemptedFrom", "to", "actual"],
    ],
    [errors.LastAdmin("customer"), ["scope"]],
    [errors.HasOpenQueue(4), ["count"]],
    [errors.ProjectHasMembers(3), ["count"]],
    [
      errors.CustomerNotEmpty({ projects: 1, tickets: 2, users: 3, categories: 4 }),
      ["projects", "tickets", "users", "categories"],
    ],
    [errors.Conflict("Name is taken", ["name"]), ["fields"]],
  ];

  it.each(NEEDS)("$code carries its values in details", (err, keys) => {
    expect(err.details, err.code).toBeDefined();
    for (const key of keys) {
      expect(Object.keys(err.details!), `${err.code}.${key}`).toContain(key);
    }
  });

  it("counts a count, rather than a rendered phrase", () => {
    // The trap this guards: "2 open tickets, 1 project" reads fine in English
    // and is unusable to anyone writing the same list in Thai.
    const err = errors.CustomerNotEmpty({ projects: 1, tickets: 2, users: 3, categories: 4 });
    expect(err.details).toEqual({ projects: 1, tickets: 2, users: 3, categories: 4 });
  });
});

describe("signing in says different things for different reasons", () => {
  /**
   * These four are reached only AFTER the password has been verified, so naming
   * the state reveals nothing — and a person told "invalid email or password"
   * when their password is right resets it twice before asking anyone. They must
   * therefore stay DISTINCT from each other and from the uniform one.
   */
  it("keeps the post-password refusals apart from the uniform one", () => {
    const codes = [
      errors.InvalidCredentials().code,
      errors.AccountDeactivated().code,
      errors.AccountRejected().code,
      errors.AccountSuspended().code,
      errors.EmailNotVerified().code,
      errors.AccountPendingApproval().code,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
