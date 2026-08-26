import { hasPermission, type AuthUser } from "../../shared/auth";
import { NotFound } from "../../shared/errors";
import {
  kbRepository,
  type KbArticleDto,
  type KbSummary,
  type WriteArticleInput,
} from "./kb.repository";

export type { KbArticleDto, KbSummary };

/**
 * Whether this principal sees unpublished writing. Drafts are for the people who
 * may edit them: to everyone else an article that has not been published does not
 * exist yet.
 */
const seesDrafts = (actor: AuthUser) => hasPermission(actor, "kb:write");

export const kbService = {
  list(
    opts: { q?: string; category?: string },
    actor: AuthUser,
  ): Promise<KbSummary[]> {
    return kbRepository.findMany({ ...opts, includeDrafts: seesDrafts(actor) });
  },

  categories(actor: AuthUser): Promise<string[]> {
    return kbRepository.categories(seesDrafts(actor));
  },

  async get(id: string, actor: AuthUser): Promise<KbArticleDto> {
    const found = await kbRepository.findById(id, seesDrafts(actor));
    // A draft 404s for a reader rather than 403-ing: telling them the id is taken
    // by something they may not read is more than they need to know.
    if (!found) throw NotFound("Article not found");
    return found;
  },

  create(data: WriteArticleInput, actor: AuthUser): Promise<KbArticleDto> {
    return kbRepository.create(data, actor.id);
  },

  async update(
    id: string,
    data: Partial<WriteArticleInput>,
    actor: AuthUser,
  ): Promise<KbArticleDto> {
    const updated = await kbRepository.update(id, data, actor.id);
    if (!updated) throw NotFound("Article not found");
    return updated;
  },

  async remove(id: string, actor: AuthUser): Promise<void> {
    const removed = await kbRepository.remove(id, actor.id);
    if (!removed) throw NotFound("Article not found");
  },

  /**
   * Whether an article id exists. Used to validate the soft reference stored on
   * a problem (`problems.kb_article_id`) before it is written, since the column
   * deliberately carries no foreign key — see `Problem.kbArticleId`.
   */
  exists(id: string): Promise<boolean> {
    return kbRepository.exists(id);
  },

  /**
   * Resolve article ids to the bare facts needed to render links. Batched, and
   * non-throwing on purpose: a problem holding a stale id must still load,
   * showing the link as unavailable rather than 404-ing the whole problem.
   */
  referencesFor(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; title: string; category: string }>> {
    return kbRepository.referencesFor(ids);
  },

  /**
   * Deflection suggestions for the create-ticket form (top 3 by relevance).
   *
   * Matches the words of what the requester typed against article tags, plus the
   * title as a substring. Reading the tags as query WORDS is what a database can
   * express, and it is the direction that matters: someone types "vpn keeps
   * dropping" and the article tagged `vpn` is the one to offer.
   */
  suggest(q: string, actor: AuthUser) {
    return kbRepository.suggest(q, seesDrafts(actor));
  },
};
