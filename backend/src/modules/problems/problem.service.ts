import type { AuthUser } from "../../shared/auth";
import { BadRequest, NotFound } from "../../shared/errors";
import { kbService } from "../kb/kb.service";
import { problemRepository, type ProblemDto } from "./problem.repository";
import {
  announcesWorkaround,
  nextProblemState,
  validateProblemState,
} from "./problem.rules";
import type { ProblemStatus } from "./problem.types";
import type {
  LinkOrConvertInput,
  UpdateProblemInput,
} from "./problem.validators";

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
   * Edit the investigation: title, description, root cause, workaround, status.
   *
   * Until this existed the columns were write-once at creation — `rootCause`,
   * `workaround` and `status` had no API that could set them, so a "known error"
   * could never actually acquire the workaround the status implies.
   *
   * The rules judge the RESULTING state, not the patch, so setting
   * `status: known_error` on a problem that already stored a workaround is
   * allowed while setting it on an empty one is a 400.
   */
  async update(
    id: number,
    input: UpdateProblemInput,
    actor: AuthUser,
  ): Promise<ProblemDto> {
    const current = await problemRepository.findStateForUpdate(id, actor);
    // Out of scope reads as "not found" rather than leaking existence.
    if (!current) throw NotFound(`Problem ${id} not found`);

    // The KB reference is soft — no FK can reject a bad id, so check it here.
    // Rejecting on write is what keeps a dangling link from ever being stored.
    if (input.kbArticleId != null && !kbService.exists(input.kbArticleId)) {
      throw BadRequest(`No knowledge-base article with id "${input.kbArticleId}"`);
    }

    const next = nextProblemState(current, input);
    const problem = validateProblemState(next);
    if (problem) throw BadRequest(problem);

    return problemRepository.update(
      id,
      input,
      actor,
      announcesWorkaround(current, next),
    );
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
