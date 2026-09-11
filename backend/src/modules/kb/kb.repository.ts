import { Prisma, type KbStatus } from "@prisma/client";
import { prisma } from "../../shared/db";
import { BadRequest } from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { categoryLabel } from "../categories/category.code";

/**
 * An article as the API returns it.
 *
 * `category` stays a plain display string, as it always was on the wire. What
 * changed underneath is where it comes from: an article used to point at a
 * category ROW and print that row's name, and rows now belong to tenants — so an
 * article would have printed one customer's name for a subject to every other
 * customer, and would have been owned by that customer besides.
 *
 * It carries the code instead, and `category` is the neutral label derived from
 * it. `categoryCode` rides alongside for the editor and the browse filter, which
 * need the stable value rather than the printable one.
 */
export type KbArticleDto = {
  id: string;
  category: string;
  categoryCode: string;
  title: string;
  tags: string[];
  readMin: number;
  /** Full ISO timestamp — the client formats it in the reader's locale. */
  updatedAt: string;
  excerpt: string;
  status: KbStatus;
  author: { id: number; name: string } | null;
  body: string;
};

/** Everything but the body — the browse list never needs the full text. */
export type KbSummary = Omit<KbArticleDto, "body">;

const articleInclude = {
  author: { select: { id: true, name: true } },
} satisfies Prisma.KbArticleInclude;

type ArticleRow = Prisma.KbArticleGetPayload<{ include: typeof articleInclude }>;

function toDto(row: ArticleRow): KbArticleDto {
  return {
    id: row.id,
    title: row.title,
    category: categoryLabel(row.categoryCode),
    categoryCode: row.categoryCode,
    tags: row.tags,
    readMin: row.readMin,
    updatedAt: row.updatedAt.toISOString(),
    excerpt: row.excerpt,
    status: row.status,
    author: row.author,
    body: row.body,
  };
}

const toSummary = ({ body: _body, ...rest }: KbArticleDto): KbSummary => rest;

/**
 * Which articles a reader may see. Articles carry no customer — one article on
 * resetting a password serves every tenant — so status is the only filter there
 * is: a draft is unfinished writing and only shows to whoever may edit it.
 */
function visibilityWhere(includeDrafts: boolean): Prisma.KbArticleWhereInput {
  return includeDrafts ? {} : { status: "published" };
}

/**
 * Free-text search across the article.
 *
 * Now that the text lives in Postgres this also searches the BODY, which the
 * in-process version could not afford to and which is what someone hunting a
 * half-remembered error message actually wants. Tags match whole: an array
 * column has no substring operator, and searching the body covers the cases the
 * old `tag.includes(q)` was really serving, since a tag worth having appears in
 * the prose too.
 *
 * The spec asks for a `tsvector` column with a GIN index. ILIKE is the honest
 * interim: correct answers, a sequential scan. Worth revisiting when the library
 * outgrows a few hundred articles — it is an index and a generated column, not a
 * change to any of this.
 */
function searchWhere(q: string): Prisma.KbArticleWhereInput {
  const insensitive = Prisma.QueryMode.insensitive;
  return {
    OR: [
      { title: { contains: q, mode: insensitive } },
      { excerpt: { contains: q, mode: insensitive } },
      { body: { contains: q, mode: insensitive } },
      { tags: { has: q.toLowerCase() } },
    ],
  };
}

export type WriteArticleInput = {
  title: string;
  excerpt: string;
  body: string;
  /** The subject, as a cross-tenant code. See KbArticle.categoryCode. */
  categoryCode: string;
  tags: string[];
  readMin: number;
  status: KbStatus;
};

export const kbRepository = {
  async findMany(opts: {
    q?: string;
    category?: string;
    includeDrafts: boolean;
  }): Promise<KbSummary[]> {
    const q = (opts.q ?? "").trim();
    const rows = await prisma.kbArticle.findMany({
      where: {
        AND: [
          visibilityWhere(opts.includeDrafts),
          // Filtered on the CODE, not on a printed name. The client sends back
          // one of the values `categories()` below handed it, so the two cannot
          // disagree — where matching on a name would break the moment a tenant
          // renamed their copy of a category the library also writes about.
          opts.category ? { categoryCode: opts.category } : {},
          q ? searchWhere(q) : {},
        ],
      },
      include: articleInclude,
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => toSummary(toDto(r)));
  },

  /**
   * The subjects that actually have articles — an empty filter is no filter.
   *
   * Read off the ARTICLES now, not off the category table. It used to ask which
   * categories had articles attached, which no longer means anything: every
   * tenant has its own row per code, so that question would return the same
   * subject once per customer and the browse bar would show six "Network" chips
   * on a platform with six customers.
   *
   * Both halves are returned because the client needs both and must not derive
   * one from the other: `code` is what it sends back to filter, `label` is what
   * it prints.
   */
  async categories(
    includeDrafts: boolean,
  ): Promise<{ code: string; label: string }[]> {
    const rows = await prisma.kbArticle.findMany({
      where: visibilityWhere(includeDrafts),
      distinct: ["categoryCode"],
      select: { categoryCode: true },
      orderBy: { categoryCode: "asc" },
    });
    return rows.map((r) => ({
      code: r.categoryCode,
      label: categoryLabel(r.categoryCode),
    }));
  },

  async findById(
    id: string,
    includeDrafts: boolean,
  ): Promise<KbArticleDto | null> {
    const row = await prisma.kbArticle.findFirst({
      where: { AND: [{ id }, visibilityWhere(includeDrafts)] },
      include: articleInclude,
    });
    return row ? toDto(row) : null;
  },

  /**
   * Resolve ids to the bare facts needed to render a link, for every id at once.
   *
   * Batched rather than one-at-a-time because the callers are DTO mappers over a
   * list: resolving inside the map would put a query per row on a page of
   * problems. Ids that no longer exist are simply absent from the map — a stale
   * soft reference is a link the UI marks unavailable, not an error.
   *
   * Drafts resolve too. A problem pointing at an article still being written is a
   * real link, and hiding it would read as a broken one.
   */
  async referencesFor(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; title: string; category: string }>> {
    const wanted = [...new Set(ids.filter((id): id is string => id != null))];
    if (wanted.length === 0) return new Map();
    const rows = await prisma.kbArticle.findMany({
      where: { id: { in: wanted } },
      select: { id: true, title: true, categoryCode: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { id: r.id, title: r.title, category: categoryLabel(r.categoryCode) },
      ]),
    );
  },

  /**
   * Top 3 deflection candidates for what a requester is typing.
   *
   * Splits the text into words and matches them against tags, plus the whole
   * text against the title. Empty text falls back to the three most recently
   * revised articles, so the panel is never blank on an untouched form.
   */
  async suggest(
    q: string,
    includeDrafts: boolean,
  ): Promise<
    { id: string; title: string; readMin: number; tags: string[] }[]
  > {
    const text = q.trim();
    const words = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1);
    const rows = await prisma.kbArticle.findMany({
      where: {
        AND: [
          visibilityWhere(includeDrafts),
          text
            ? {
                OR: [
                  ...(words.length ? [{ tags: { hasSome: words } }] : []),
                  {
                    title: { contains: text, mode: Prisma.QueryMode.insensitive },
                  },
                ],
              }
            : {},
        ],
      },
      select: { id: true, title: true, readMin: true, tags: true },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return rows;
  },

  /** Whether an article id exists — validates a problem's soft reference. */
  async exists(id: string): Promise<boolean> {
    if (!id) return false;
    const row = await prisma.kbArticle.findUnique({
      where: { id },
      select: { id: true },
    });
    return row != null;
  },

  /**
   * The highest numeric suffix in use, so a new article can take the next one.
   * Read inside the caller's transaction to keep two concurrent authors from
   * picking the same code.
   */
  async highestIdNumber(tx: Prisma.TransactionClient): Promise<number> {
    const rows = await tx.kbArticle.findMany({ select: { id: true } });
    return rows.reduce((max, { id }) => {
      const n = Number(/^KB-(\d+)$/.exec(id)?.[1] ?? NaN);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
  },

  async create(
    data: WriteArticleInput,
    authorId: number,
  ): Promise<KbArticleDto> {
    return prisma.$transaction(async (tx) => {
      await assertCategoryCodeExists(tx, data.categoryCode);
      // Ids are the human-readable codes support staff quote at each other
      // ("see KB-042"), so a new one continues the series rather than being a
      // surrogate key. Zero-padded to keep them the same width.
      const next = (await kbRepository.highestIdNumber(tx)) + 1;
      const id = `KB-${String(next).padStart(3, "0")}`;
      const created = await tx.kbArticle.create({
        data: { id, ...data, authorId },
        include: articleInclude,
      });
      await auditRepository.record(
        {
          userId: authorId,
          action: "kb.create",
          entity: "kb_article",
          // `audit_logs.entity_id` is an integer and an article's id is a code,
          // so it cannot go there — it goes in `meta.articleId` instead. Every
          // kb.* entry does the same, so the trail is consistent even though it
          // cannot be joined on entity_id the way ticket entries can.
          entityId: null,
          meta: { articleId: id, title: data.title, status: data.status },
        },
        tx,
      );
      return toDto(created);
    });
  },

  async update(
    id: string,
    data: Partial<WriteArticleInput>,
    actorId: number,
  ): Promise<KbArticleDto | null> {
    return prisma.$transaction(async (tx) => {
      const before = await tx.kbArticle.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!before) return null;
      if (data.categoryCode != null) {
        await assertCategoryCodeExists(tx, data.categoryCode);
      }
      const updated = await tx.kbArticle.update({
        where: { id },
        data,
        include: articleInclude,
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "kb.update",
          entity: "kb_article",
          entityId: null,
          meta: {
            articleId: id,
            // The fields that were actually sent, so the trail says what changed
            // rather than restating the whole article.
            changed: Object.keys(data),
            // Publishing is the change worth being able to point at later, so
            // both sides of it are recorded even though `changed` names the field.
            ...(data.status && data.status !== before.status
              ? { statusFrom: before.status, statusTo: data.status }
              : {}),
          },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  /**
   * Remove an article outright.
   *
   * The KB is reference material, not a record of what happened — an article
   * that documents a fix for a system nobody runs any more is noise, and unlike a
   * ticket there is nothing to preserve by keeping it. Problems pointing at it
   * keep their id and show the link as unavailable, which is exactly the case the
   * soft reference was left soft for.
   */
  async remove(id: string, actorId: number): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.kbArticle.findUnique({
        where: { id },
        select: { title: true },
      });
      if (!existing) return false;
      await tx.kbArticle.delete({ where: { id } });
      const orphaned = await tx.problem.count({ where: { kbArticleId: id } });
      await auditRepository.record(
        {
          userId: actorId,
          action: "kb.delete",
          entity: "kb_article",
          entityId: null,
          meta: {
            articleId: id,
            title: existing.title,
            // How many problems now hold a dangling link. Recorded because it is
            // the consequence of the delete and nothing else will notice it.
            orphanedProblems: orphaned,
          },
        },
        tx,
      );
      return true;
    });
  },
};

/**
 * Refuse a code no category anywhere carries.
 *
 * Deliberately NOT scoped to the author's reach, unlike every other lookup in
 * this codebase, and the exception is the point: an article belongs to no tenant,
 * so its subject cannot be validated against one. A code is a shared vocabulary
 * word, and what this checks is that the word is in use somewhere — which catches
 * the typo the editor is actually at risk of, without asserting an ownership the
 * article does not have.
 *
 * Reading which codes EXIST is not a tenant leak: it says a category with that
 * code is in use on the platform, and never which customer has one.
 */
async function assertCategoryCodeExists(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<void> {
  const category = await tx.category.findFirst({
    where: { code },
    select: { id: true },
  });
  if (!category) throw BadRequest(`Unknown category code "${code}"`);
}
