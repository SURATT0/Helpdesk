"use client";

import * as React from "react";
import { Info, UserPlus, Users as UsersIcon } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { toneForName } from "@/features/tickets/data";
import { useAuth } from "@/features/auth/context";
import { useProjects } from "@/features/projects/queries";
import { useUpdateUser, useUsers } from "@/features/users/queries";
import { AccountToggle } from "@/features/users/components/account-toggle";
import { ApprovalQueue } from "@/features/users/components/approval-queue";
import { CreateUserModal } from "@/features/users/components/create-user-modal";
import { CustomerAccess } from "@/features/users/components/customer-access";
import { UserFiltersBar } from "@/features/users/components/user-filters";
import { AvailabilityToggle } from "@/features/users/components/availability-toggle";
import { HandoverQueueModal } from "@/features/users/components/handover-queue-modal";
import { ProjectSelect } from "@/features/users/components/project-select";
import { SuspensionToggle } from "@/features/users/components/suspension-toggle";
import { useI18n } from "@/features/i18n/context";
import { apiErrorMessage } from "@/lib/api-error";
import type { Project } from "@/features/projects/schemas";
import type {
  User,
  UserFilters,
  UserRole,
  UserStatus,
} from "@/features/users/schemas";
import { BADGE, type ColourPair } from "@/lib/palette";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * The list a row gets when its customer owns no projects — and the list
 * platform staff always get, since they belong to no customer.
 *
 * A shared constant rather than `[]` at the call site: a fresh empty array on
 * every render is a new prop for every such row, every time the table redraws.
 */
const EMPTY_PROJECTS: Project[] = [];

// Descending privilege, so the badge colours read as a ladder at a glance.
const ROLE_STYLE: Record<UserRole, ColourPair> = {
  super_admin: BADGE.violet,
  admin: BADGE.green,
  user: BADGE.slate,
};

/*
 * `minmax(0, …fr)` on the two flexible tracks, not a bare `1.2fr`.
 *
 * An `fr` track's automatic minimum is `min-content`, so a cell holding
 * something that cannot wrap sets a floor the ratio has to honour — and the
 * OTHER flexible track pays for it. The "Add customer access" control under the
 * name is exactly that: its label does not break, its min-content came out at
 * ~162px, and with only ~210px of free space to share that left the email
 * column 16px wide. Six characters and an ellipsis.
 *
 * It appeared the day the seeded super admins stopped belonging to a tenant:
 * granting reach is platform-wide only, so before that the control rendered on
 * no row at all and the floor never existed. The table had simply never been
 * asked to lay out with it.
 *
 * `minmax(0, …)` lets the tracks keep their 1.2 : 1.5 ratio and hands the
 * overflow to the `truncate` inside each cell, which is what it is there for.
 */
const COLS =
  "grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_110px_140px_170px_120px_110px_120px_130px]";

/**
 * Width floor for the horizontal scroller, and it has to move with the columns.
 *
 * 900px of fixed columns + 32px of row padding, leaving ~178px for the two `fr`
 * columns to share — enough that the name and email stay readable rather than
 * becoming decoration. Adding the ACCOUNT column without raising this squeezed
 * them to zero on a phone, which is exactly what the mobile-tables spec measures.
 */
const MIN_WIDTH = 1110;

/**
 * The account's state, shown beside the name — and ONLY when it is not the
 * ordinary one.
 *
 * Not a tenth column, for the same reason cross-tenant reach is not one: the
 * table already carries nine and scrolls sideways on a phone, and `active` is
 * almost every row. A column would spend width on every reader to print the word
 * "Active" over and over, while the rows that actually need saying something —
 * somebody suspended, somebody still waiting — are the rare ones a badge makes
 * jump out.
 */
function AccountStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useI18n();
  if (status === "active") return null;
  // Amber for the one that is waiting on somebody, rose for the two that are a
  // refusal — the same distinction the palette already draws between "in hand"
  // and "a fault".
  const tone = status === "pending" ? BADGE.amber : BADGE.rose;
  return (
    <span
      className="inline-flex flex-none items-center rounded-full px-2 py-[2px] text-caption font-semibold"
      style={{ color: tone.fg, background: tone.bg }}
    >
      {t(`accountStatus.${status}`)}
    </span>
  );
}

const formatDate = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { user: me } = useAuth();
  const [filters, setFilters] = React.useState<UserFilters>({});
  const { data: users = [], isLoading, isError, refetch } = useUsers({ filters });
  const update = useUpdateUser();

  // Mirrors the server's user:write grant. The API is the real gate; this only
  // avoids rendering controls that would be refused.
  const canEdit = hasPermission(me, "user:write");
  // Handing over a whole queue needs ticket:assign — managers and admins only,
  // unlike single-ticket assignment which any agent may do.
  // Its own grant, not `canEdit` reused — the comment above already said the two
  // are different questions and the code answered them the same way. Handing a
  // whole queue over is `ticket:assign`; changing a role is `user:write`.
  const canHandover = hasPermission(me, "ticket:assign");
  // Reach is the one thing on this page a customer's own super admin may NOT
  // change: granting it crosses the tenant boundary, so it is platform-wide
  // only. The server is the gate; this just avoids offering a refused control.
  const canGrantReach = me?.platformWide === true;
  const [handoverFor, setHandoverFor] = React.useState<User | null>(null);
  const [creating, setCreating] = React.useState(false);
  // Projects are only needed for the editable picker, and requesters/agents
  // cannot write anyway — so don't fetch them for a read-only view.
  const { data: projectData } = useProjects({ enabled: canEdit });
  /**
   * The routing projects each customer owns, so a row can be offered only its
   * own tenant's.
   *
   * The picker used to receive the whole list. For a customer-bound viewer that
   * WAS one tenant's projects and the distinction never showed; for platform
   * staff it is every project that exists, so a requester at one company was
   * offered another company's routing — and `users.project_id` is what decides
   * who their next ticket is assigned to.
   *
   * Grouped once rather than filtered per row: the table re-renders on every
   * mutation, and a fresh array per row per render is a new prop identity for
   * each `<ProjectSelect>` each time.
   */
  const projectsByCustomer = React.useMemo(() => {
    const byCustomer = new Map<number, Project[]>();
    for (const p of projectData?.projects ?? []) {
      const list = byCustomer.get(p.customerId);
      if (list) list.push(p);
      else byCustomer.set(p.customerId, [p]);
    }
    return byCustomer;
  }, [projectData]);
  const pendingId = update.isPending ? update.variables?.id : undefined;

  return (
    <>
      <Topbar titleKey="nav.users" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="flex max-w-[70ch] items-start gap-2 text-body leading-relaxed text-subtle">
            <Info size={14} className="mt-[2px] flex-none text-faint" />
            {t("users.explainer")}
          </p>
          {/* Same gate as the approval queue below, and for the same reason:
              creating an account chooses somebody's tenant. The server refuses
              anyone else; this only avoids offering a button that would 403. */}
          {canGrantReach ? (
            <Button onClick={() => setCreating(true)}>
              <UserPlus size={14} strokeWidth={2} />
              {t("createUser.open")}
            </Button>
          ) : null}
        </div>

        {/* A refused edit has to be readable. Closing an account that still holds
            tickets comes back with the count and "hand the queue over first" —
            the one message on this page a reader has to act on, and it used to go
            nowhere because nothing rendered `update.error`.

            Through `apiErrorMessage`, so the count arrives in `details` and the
            sentence around it is written here rather than by the API, which is
            not told what language the reader has. */}
        {update.isError ? (
          <div
            role="alert"
            className="mb-4 flex max-w-[70ch] items-start gap-2 rounded-md border border-danger-edge bg-danger-bg px-3 py-2.5 text-body font-medium text-danger-ink"
          >
            <Info size={14} className="mt-[2px] flex-none" />
            {apiErrorMessage(update.error, t, "users.updateError")}
          </div>
        ) : null}

        {/* Above the directory, and only when somebody is actually waiting —
            see ApprovalQueue. It is the one list here where a person is blocked
            until an administrator acts. */}
        <ApprovalQueue canDecide={canGrantReach} />

        <UserFiltersBar
          filters={filters}
          onChange={setFilters}
          // The customer filter is worth offering only to a viewer who reaches
          // more than one: for everybody else the column holds the same name on
          // every row.
          showCustomer={canGrantReach}
        />

        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <TableScroll minWidth={MIN_WIDTH}>
          <div
            className={cn(
              "grid items-center border-b border-hairline bg-wash px-4 py-2.5 text-caption font-semibold tracking-columns text-faint",
              COLS,
            )}
          >
            <span>{t("users.col.name")}</span>
            <span>{t("users.col.email")}</span>
            <span>{t("users.col.role")}</span>
            <span>{t("users.col.team")}</span>
            <span>{t("users.col.project")}</span>
            <span>{t("users.col.routing")}</span>
            <span>{t("users.col.account")}</span>
            <span>{t("users.col.joined")}</span>
            <span>{t("users.col.queue")}</span>
          </div>

          {isLoading ? <LoadingRow label={t("users.loading")} /> : null}
          {isError ? (
            <ErrorState message={t("users.loadError")} onRetry={() => refetch()} />
          ) : null}
          {!isLoading && !isError && users.length === 0 ? (
            <EmptyState message={t("users.empty")} />
          ) : null}

          {users.map((u, i) => {
            const role = ROLE_STYLE[u.role];
            return (
              <div
                key={u.id}
                className={cn(
                  "grid items-center px-4 py-3 text-control",
                  COLS,
                  i < users.length - 1 && "border-b border-rule",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-ink">
                  <Avatar name={u.name} tone={toneForName(u.name)} size={24} />
                  {/* Cross-tenant access sits under the name rather than in a
                      column of its own: it is empty on nearly every row, and a
                      tenth column would cost every reader width on a table that
                      already scrolls sideways on a phone. */}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{u.name}</span>
                      <AccountStatusBadge status={u.status} />
                    </span>
                    <CustomerAccess user={u} canGrant={canGrantReach} />
                  </span>
                </span>
                <span className="truncate text-body text-subtle">
                  {u.email}
                </span>
                <span>
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-[3px] text-caption font-semibold"
                    style={{ color: role.fg, background: role.bg }}
                  >
                    {t(`role.${u.role}`)}
                  </span>
                </span>
                <span className="truncate text-body text-subtle">
                  {u.team?.name ?? "—"}
                </span>

                <span className="pr-3">
                  {canEdit ? (
                    <ProjectSelect
                      value={u.project?.id ?? null}
                      // Their own customer's projects, and nobody else's.
                      // Platform staff belong to no customer, so they get an
                      // empty list — which is the same answer the API gives.
                      projects={
                        (u.customer
                          ? projectsByCustomer.get(u.customer.id)
                          : undefined) ?? EMPTY_PROJECTS
                      }
                      disabled={pendingId === u.id}
                      ariaLabel={`${t("users.col.project")} — ${u.name}`}
                      onChange={(projectId) =>
                        update.mutate({ id: u.id, input: { projectId } })
                      }
                    />
                  ) : (
                    <span className="truncate text-body text-subtle">
                      {u.project?.name ?? "—"}
                    </span>
                  )}
                </span>

                <span>
                  <AvailabilityToggle
                    available={u.availableForAssignment}
                    canEdit={canEdit}
                    pending={pendingId === u.id}
                    ariaLabel={`${t("users.col.routing")} — ${u.name}`}
                    onChange={(availableForAssignment) =>
                      update.mutate({
                        id: u.id,
                        input: { availableForAssignment },
                      })
                    }
                  />
                </span>

                <span className="flex flex-col items-start">
                  <AccountToggle
                    active={u.isActive}
                    canEdit={canEdit}
                    // Closing your own account would lock you out; the server
                    // refuses it too, so don't offer the switch.
                    disabled={u.id === me?.id}
                    pending={pendingId === u.id}
                    ariaLabel={`${t("users.col.account")} — ${u.name}`}
                    onChange={(isActive) =>
                      update.mutate({ id: u.id, input: { isActive } })
                    }
                  />
                  {/* Under the door switch rather than beside it: the two are
                      easy to confuse, and only one of them says the person has
                      left. See SuspensionToggle for why both exist. */}
                  <SuspensionToggle
                    status={u.status}
                    canEdit={canEdit}
                    isSelf={u.id === me?.id}
                    pending={pendingId === u.id}
                    onChange={(status) =>
                      update.mutate({ id: u.id, input: { status } })
                    }
                  />
                </span>

                <span className="text-body text-faint">
                  {formatDate(u.createdAt, lang)}
                </span>

                <span>
                  {/* Requesters raise tickets, they never hold a queue. */}
                  {canHandover && u.role !== "user" ? (
                    <button
                      type="button"
                      onClick={() => setHandoverFor(u)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-caption font-semibold text-subtle hover:bg-app"
                    >
                      <UsersIcon size={12} strokeWidth={2} />
                      {t("users.handover")}
                    </button>
                  ) : (
                    <span className="text-body text-faint">—</span>
                  )}
                </span>
              </div>
            );
          })}
          </TableScroll>
        </div>
      </main>

      {creating ? <CreateUserModal onClose={() => setCreating(false)} /> : null}

      {handoverFor ? (
        <HandoverQueueModal
          from={handoverFor}
          candidates={users}
          onClose={() => setHandoverFor(null)}
        />
      ) : null}
    </>
  );
}
