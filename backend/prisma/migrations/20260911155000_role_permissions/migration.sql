-- What each role may do becomes a table.
--
-- It was a constant in shared/auth.ts, baked into every access token at sign-in.
-- A super admin now edits it from the app, which means two things have to change
-- together: the grants move here, and the gate stops reading the token (see
-- requireAuth, which replaces the principal's permissions with the live set on
-- every request).
--
-- Additive. Nothing is dropped and no existing row is touched — the constant
-- stays in the source as INITIAL_ROLE_PERMISSIONS, and a test compares the two
-- so this migration is provably a transcription rather than a redesign.
CREATE TABLE "role_permissions" (
  "role" "Role" NOT NULL,
  "permission" TEXT NOT NULL,
  "granted_by_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role", "permission")
);

CREATE INDEX "role_permissions_role_idx" ON "role_permissions"("role");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id")
  -- The grant outlives the person who made it. SET NULL rather than CASCADE:
  -- deleting an administrator must not silently revoke what they granted.
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The starting grants, exactly as the constant held them, with one deliberate
-- difference: super_admin's "*" is expanded into every permission in the
-- catalogue.
--
-- A wildcard cannot be un-ticked. Every box on the matrix would read as on and
-- stay on however it was clicked, so the top role holds an explicit list like
-- everyone else. The cost lands later and is worth stating here: a permission
-- added to the catalogue in a future release does NOT reach super_admin on its
-- own any more. `permissions.test.ts` fails until somebody decides who gets it,
-- which is the point — the decision becomes visible instead of automatic.
--
-- `granted_by_id` is NULL for every row: nobody granted these, they are where
-- the product started.
INSERT INTO "role_permissions" ("role", "permission") VALUES
  ('super_admin', 'ticket:read'),
  ('super_admin', 'ticket:create'),
  ('super_admin', 'ticket:write'),
  ('super_admin', 'ticket:assign'),
  ('super_admin', 'ticket:import'),
  ('super_admin', 'ticket:delete'),
  ('super_admin', 'kb:write'),
  ('super_admin', 'problem:read'),
  ('super_admin', 'problem:write'),
  ('super_admin', 'asset:read'),
  ('super_admin', 'asset:write'),
  ('super_admin', 'user:read'),
  ('super_admin', 'user:write'),
  ('super_admin', 'project:read'),
  ('super_admin', 'project:write'),
  ('super_admin', 'project:delete'),
  ('super_admin', 'customer:write'),
  ('super_admin', 'customer:archive'),
  ('super_admin', 'category:write'),
  ('super_admin', 'audit:read'),
  ('super_admin', 'settings:write'),
  ('super_admin', 'comment:moderate'),
  ('super_admin', 'permission:write'),
  ('admin', 'ticket:read'),
  ('admin', 'ticket:write'),
  ('admin', 'ticket:create'),
  ('admin', 'ticket:import'),
  ('admin', 'user:read'),
  ('admin', 'asset:write'),
  ('admin', 'problem:write'),
  ('admin', 'asset:read'),
  ('admin', 'problem:read'),
  ('admin', 'project:read'),
  ('admin', 'audit:read'),
  ('admin', 'kb:write'),
  ('admin', 'customer:write'),
  ('user', 'ticket:read'),
  ('user', 'ticket:create');
