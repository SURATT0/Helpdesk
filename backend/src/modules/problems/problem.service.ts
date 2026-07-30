import type { AuthUser } from "../../shared/auth";
import { NotFound } from "../../shared/errors";
import { problemRepository, type ProblemDto } from "./problem.repository";
import type { ProblemStatus } from "./problem.types";
import type { LinkOrConvertInput } from "./problem.validators";

export const problemService = {
  list(
    actor: AuthUser,
    opts: { search?: string; status?: ProblemStatus; limit?: number },
  ): Promise<ProblemDto[]> {
    return problemRepository.findMany(actor, opts);
  },

  async get(id: number, actor: AuthUser): Promise<ProblemDto> {
    const problem = await problemRepository.findById(id, actor);
    if (!problem) throw NotFound(`Problem ${id} not found`);
    return problem;
  },

  /**
   * Link a ticket to a problem, or convert it into a new one. The validator
   * guarantees exactly one of `problemId` / `title` is present.
   *
   * Both the ticket and (when linking) the problem must be inside the actor's
   * scope — otherwise this would be a way to attach a ticket to another
   * tenant's problem and leak its existence.
   */
  async linkOrConvert(
    ticketId: number,
    input: LinkOrConvertInput,
    actor: AuthUser,
  ): Promise<ProblemDto> {
    const ticket = await problemRepository.findTicketForLink(ticketId, actor);
    if (!ticket) throw NotFound(`Ticket ${ticketId} not found`);

    if (input.problemId != null) {
      const ok = await problemRepository.isInScope(input.problemId, actor);
      if (!ok) throw NotFound(`Problem ${input.problemId} not found`);
      await problemRepository.linkTicket(ticketId, input.problemId, actor);
      return this.get(input.problemId, actor);
    }

    // Convert: the new problem inherits the ticket's tenant.
    return problemRepository.createFromTicket(
      {
        title: input.title as string,
        description: input.description ?? null,
        ticketId,
        customerId: ticket.customerId,
      },
      actor,
    );
  },

  /** Detach a ticket from its problem. No-op if it wasn't linked. */
  async unlink(ticketId: number, actor: AuthUser): Promise<void> {
    const ticket = await problemRepository.findTicketForLink(ticketId, actor);
    if (!ticket) throw NotFound(`Ticket ${ticketId} not found`);
    await problemRepository.linkTicket(ticketId, null, actor);
  },
};
