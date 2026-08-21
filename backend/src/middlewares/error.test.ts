import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./index";
import { Conflict, NotFound } from "../shared/errors";

/** The response shape the handler emits, as these assertions read it. */
type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

/** Just enough of req/res for the handler; the body is what we assert on. */
function run(err: unknown): { status: number; body: ErrorBody } {
  const json = vi.fn<(body: ErrorBody) => void>();
  const status = vi.fn<(code: number) => { json: typeof json }>(() => ({
    json,
  }));
  const req = { log: { warn: vi.fn(), error: vi.fn() } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorHandler(err, req as any, { status } as any, vi.fn() as any);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

/** What Prisma throws on a unique-constraint collision. */
const p2002 = (target: unknown, modelName?: string) => ({
  name: "PrismaClientKnownRequestError",
  code: "P2002",
  meta: { target, ...(modelName ? { modelName } : {}) },
});

describe("a unique-constraint collision answers 409, not 500", () => {
  it("names the model and the columns, camelCased", () => {
    // The exact case that returned "Something went wrong": two projects with one
    // name in one customer.
    const { status, body } = run(p2002(["customer_id", "name"], "Project"));
    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "CONFLICT",
        message: "A project with the same customerId and name already exists",
        details: { fields: ["customerId", "name"] },
      },
    });
  });

  it("handles a single-column constraint", () => {
    const { status, body } = run(p2002(["email"], "User"));
    expect(status).toBe(409);
    expect(body.error.message).toBe(
      "A user with the same email already exists",
    );
    expect(body.error.details).toEqual({ fields: ["email"] });
  });

  it("copes with a bare string target", () => {
    // Some connectors report the constraint name rather than a column list.
    const { status, body } = run(p2002("users_email_key", "User"));
    expect(status).toBe(409);
    expect(body.error.details).toEqual({ fields: ["usersEmailKey"] });
  });

  it("still answers 409 when Prisma names neither model nor columns", () => {
    const { status, body } = run({ code: "P2002", meta: {} });
    expect(status).toBe(409);
    expect(body.error).toEqual({
      code: "CONFLICT",
      message: "That record already exists",
    });
    // No empty `details` key when there is nothing to put in it.
    expect("details" in body.error).toBe(false);
  });

  it("leaves other Prisma codes to the 500 branch", () => {
    // Only uniqueness is a client's problem to fix. A foreign-key failure or a
    // dead connection is ours, and must not be dressed up as a 409.
    const { status, body } = run({ code: "P2003", meta: { modelName: "User" } });
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
  });

  it("is not fooled by a plain object carrying a code", () => {
    const { status } = run({ code: "SOMETHING_ELSE" });
    expect(status).toBe(500);
  });
});

describe("AppError details", () => {
  it("passes through the details a thrown Conflict carries", () => {
    const { status, body } = run(Conflict("Name is taken", ["name"]));
    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "CONFLICT",
        message: "Name is taken",
        details: { fields: ["name"] },
      },
    });
  });

  it("omits the key entirely when an error carries no details", () => {
    const { body } = run(NotFound("Ticket not found"));
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Ticket not found" },
    });
  });
});
