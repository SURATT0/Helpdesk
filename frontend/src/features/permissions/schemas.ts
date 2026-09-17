import { z } from "zod";

/**
 * The role × permission matrix, as `GET /permissions/matrix` sends it.
 *
 * This is the live table — the one every gate on the API consults — and it is
 * what the Permissions page renders. It replaced a hard-coded copy of the grants
 * a fresh install starts with, which could only ever describe a desk that had
 * never edited its matrix.
 */
export const permissionMatrixSchema = z.object({
  /**
   * The catalogue: what each permission string MEANS. Code on the server, not a
   * row in the table, so a permission nobody has granted still has a definition
   * and a page can list it as ungranted rather than omit it.
   */
  permissions: z.array(
    z.object({
      key: z.string(),
      group: z.string(),
      description: z.string(),
    }),
  ),
  /**
   * Who holds what, right now. Keyed by role name rather than typed to the three
   * we know: a role added on the server should widen this page, not break its
   * parse.
   */
  grants: z.record(z.string(), z.array(z.string())),
  /** What `super_admin` may never give up — greyed out on the editing screen. */
  locked: z.array(z.string()),
});

export type PermissionMatrix = z.infer<typeof permissionMatrixSchema>;

export const permissionMatrixEnvelope = z.object({
  data: permissionMatrixSchema,
});
