"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Building2,
  ChevronRight,
  FolderKanban,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TOUCH_HEIGHT, TOUCH_TARGET } from "@/components/ui/touch";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { holds } from "@/lib/permissions";
import { useCustomers } from "@/features/customers/queries";
import { ArchiveCustomerDialog } from "@/features/customers/components/archive-customer-dialog";
import { useProjects } from "@/features/projects/queries";
import type { Customer } from "@/features/customers/schemas";
import { DeleteProjectDialog } from "@/features/projects/components/delete-project-dialog";
import type { Project } from "@/features/projects/schemas";
import { CustomerFormModal } from "./customer-form-modal";
import { ProjectFormModal } from "./project-form-modal";

/**
 * Customers and their projects, on one screen.
 *
 * They were two pages, and the split never matched the data: a project belongs
 * to exactly one customer and cannot exist without one, so "the projects page"
 * was a flat list of things that only make sense grouped. Anyone adding a
 * project had to pick the customer again in a form having just been looking at
 * it.
 *
 * Master–detail rather than an accordion, and the reason is the detail pane's
 * weight: a customer carries three counts, an archive control and a table of
 * projects with owners and members. Folded into an expanding row that is taller
 * than the screen, and expanding two of them puts two project tables on top of
 * each other with nothing saying which is whose.
 *
 * The selection lives in the URL (`/admin/customers/[id]`) rather than in state,
 * so a customer can be linked to, reloaded onto and gone back from. That is also
 * what makes the phone layout fall out for free: with no id the list is the
 * whole page, with one the detail is — two screens and a back button, rather
 * than two columns squeezed into 375px.
 */
export function CustomersAdminView({
  selectedId,
}: {
  /** From the route. Null on the list page, which on a phone IS the page. */
  selectedId: number | null;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();

  /**
   * Mirrors the server's gate on this screen's actions: `customer:write` AND
   * platform reach. The API refuses regardless of what this returns; this only
   * decides whether to render a page that would be all refusals.
   *
   * Reach, not the role name alone, and the difference is the whole bug this
   * replaced. Role and reach are separate axes: a super admin who BELONGS to a
   * customer is not platform-wide, and a customer they create lands outside
   * everyone's reach — so they were shown the full screen, told their new tenant
   * was created, and sent to a page that answered 404. `platformWide` is the
   * server's own word for it, carried on the session user, so the two sides
   * cannot drift apart the way a role comparison here already had.
   */
  const canRead = user?.platformWide === true;

  const customers = useCustomers({ enabled: canRead });
  // One request for every project, filtered per customer below, rather than one
  // per selection. There are a handful of projects in total and the list is
  // already cached for the pickers; a request per click would be slower and
  // would make the detail pane flash on every navigation.
  const projects = useProjects({ enabled: canRead });

  const [query, setQuery] = React.useState("");
  /**
   * Which form is open, if any.
   *
   * `"new"` and a customer are the same modal with one field; the distinction
   * lives here rather than in two pieces of state, so the two can never both be
   * true.
   */
  const [editing, setEditing] = React.useState<Customer | "new" | null>(null);
  const [archiving, setArchiving] = React.useState<Customer | null>(null);
  /** The project form: `"new"` to add one to the selected customer, or the one
   *  being edited. Same shape as `editing` above, for the same reason. */
  const [editingProject, setEditingProject] = React.useState<Project | "new" | null>(
    null,
  );
  const [archivingProject, setArchivingProject] = React.useState<Project | null>(
    null,
  );

  /**
   * Archiving is its own grant, read through the shared permission table rather
   * than compared against a role name here — the same arrangement
   * `project:delete` uses, and deliberately stricter than creating. Both are
   * enforced by the API; these only decide whether a button is in the document.
   *
   * The API asks for platform reach here too, which this does not repeat: every
   * use of it is below the `canRead` guard, and that is where reach is settled.
   */
  const canArchive = user != null && holds(user.role, "customer:archive");

  if (!canRead) {
    return (
      <>
        <Topbar titleKey="nav.customers" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-10 text-center">
            <ShieldAlert size={22} className="text-faint" />
            <div className="text-lead font-semibold text-ink">
              {t("adminCustomers.forbidden")}
            </div>
            <div className="max-w-[46ch] text-body text-subtle">
              {t("adminCustomers.forbiddenNote")}
            </div>
          </div>
        </main>
      </>
    );
  }

  const all = customers.data ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? all.filter((c) => c.name.toLowerCase().includes(needle))
    : all;
  const selected = selectedId == null ? null : all.find((c) => c.id === selectedId);

  const projectsFor = (customerId: number) =>
    (projects.data?.projects ?? []).filter((p) => p.customerId === customerId);

  return (
    <>
      <Topbar titleKey="nav.customers" showSearch={false} />
      {/*
        Two panes side by side from `lg` up, and exactly one of them on a phone.

        Which one is decided by the URL, not by a breakpoint hiding a column:
        squeezing a list and a detail into 375px gives two unusable halves, and
        rendering both and hiding one leaves a screen reader walking through a
        page the sighted reader cannot see.
      */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "flex min-h-0 w-full flex-col border-line lg:w-[320px] lg:flex-none lg:border-r",
            // On a phone the list is the page — until something is selected,
            // and then the detail is.
            selectedId != null && "hidden lg:flex",
          )}
        >
          <div className="flex-none border-b border-hairline p-3">
            <Button
              onClick={() => setEditing("new")}
              className={cn("mb-2 w-full gap-1.5", TOUCH_HEIGHT)}
            >
              <Plus size={14} strokeWidth={2.5} />
              {t("adminCustomers.new")}
            </Button>
            <label className="relative block">
              <span className="sr-only">{t("adminCustomers.search")}</span>
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("adminCustomers.search")}
                className={cn(
                  "w-full rounded-md border border-edge bg-white py-1.5 pl-8 pr-2.5 text-ink placeholder:text-faint",
                  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                  FIELD_TEXT_12,
                )}
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {customers.isLoading ? (
              <div className="p-3">
                <LoadingRow />
              </div>
            ) : customers.isError ? (
              <div className="p-3">
                <ErrorState
                  message={t("adminCustomers.loadError")}
                  onRetry={customers.refetch}
                />
              </div>
            ) : shown.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  message={
                    needle
                      ? t("adminCustomers.noMatch", { q: query.trim() })
                      : t("adminCustomers.empty")
                  }
                />
              </div>
            ) : (
              <ul>
                {shown.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    selected={c.id === selectedId}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            selectedId == null && "hidden lg:block",
          )}
        >
          {selected ? (
            <CustomerDetail
              customer={selected}
              projects={projectsFor(selected.id)}
              projectsLoading={projects.isLoading}
              canArchive={canArchive}
              onRename={() => setEditing(selected)}
              onArchive={() => setArchiving(selected)}
              onAddProject={() => setEditingProject("new")}
              onEditProject={setEditingProject}
              onArchiveProject={setArchivingProject}
            />
          ) : selectedId != null && !customers.isLoading ? (
            // A customer that is not in the list: archived, or an id somebody
            // typed. Said plainly rather than left as an empty pane.
            <div className="p-4 sm:p-6">
              <BackToList />
              <ErrorState message={t("adminCustomers.notFound")} />
            </div>
          ) : (
            // Desktop only — on a phone this pane is not rendered at all when
            // nothing is selected, because the list is the page.
            <div className="hidden h-full place-items-center p-10 text-center lg:grid">
              <div className="flex flex-col items-center gap-2">
                <Building2 size={22} className="text-faint" />
                <div className="max-w-[34ch] text-body text-subtle">
                  {t("adminCustomers.choose")}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <CustomerFormModal
        open={editing != null}
        customer={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        // Land on what was just added, rather than leaving somebody to find it
        // in a list they have just made longer.
        onCreated={(id) => router.push(`/admin/customers/${id}`)}
      />

      {/* Both project dialogs need a selected customer, which is the only state
          in which either can be opened. */}
      {selected ? (
        <ProjectFormModal
          open={editingProject != null}
          customerId={selected.id}
          customerName={selected.name}
          project={editingProject === "new" ? null : editingProject}
          onClose={() => setEditingProject(null)}
        />
      ) : null}

      {archivingProject ? (
        <DeleteProjectDialog
          project={archivingProject}
          onClose={() => setArchivingProject(null)}
        />
      ) : null}

      {archiving ? (
        <ArchiveCustomerDialog
          customer={archiving}
          onClose={() => {
            setArchiving(null);
            // The archived tenant leaves the list, so the detail pane is showing
            // something that is no longer there.
            if (archiving.id === selectedId) router.push("/admin/customers");
          }}
        />
      ) : null}
    </>
  );
}

/** One customer in the left-hand list. A link, so the URL carries the choice. */
function CustomerRow({
  customer,
  selected,
}: {
  customer: Customer;
  selected: boolean;
}) {
  const { t } = useI18n();
  return (
    <li>
      <Link
        href={`/admin/customers/${customer.id}`}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex items-center gap-2 border-b border-hairline px-3 py-2.5 text-left",
          TOUCH_TARGET,
          selected ? "bg-accent-soft" : "hover:bg-app",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-control font-semibold text-ink">
            {customer.name}
          </span>
          {/* The project count in the list, because it is the number somebody
              scanning for "which customer has work set up" is looking for. The
              other two counts live in the detail, where there is room to label
              them. */}
          <span className="mt-0.5 flex items-center gap-1 text-caption text-faint">
            <FolderKanban size={11} strokeWidth={2} />
            {t("adminCustomers.projectCount", { n: customer.counts.projects })}
          </span>
        </span>
        {/* Only where there is no second pane to show the selection. */}
        <ChevronRight size={14} className="flex-none text-faint lg:hidden" />
      </Link>
    </li>
  );
}

function BackToList() {
  const { t } = useI18n();
  return (
    <Link
      href="/admin/customers"
      className={cn(
        "mb-3 inline-flex items-center gap-1.5 text-body text-muted hover:text-ink lg:hidden",
        TOUCH_TARGET,
      )}
    >
      <ArrowLeft size={14} />
      {t("adminCustomers.back")}
    </Link>
  );
}

/** The right-hand pane: one customer, and the projects filed under it. */
function CustomerDetail({
  customer,
  projects,
  projectsLoading,
  canArchive,
  onRename,
  onArchive,
  onAddProject,
  onEditProject,
  onArchiveProject,
}: {
  customer: Customer;
  projects: Project[];
  projectsLoading: boolean;
  canArchive: boolean;
  onRename: () => void;
  onArchive: () => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onArchiveProject: (project: Project) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="p-4 sm:p-6">
      <BackToList />

      {/* `flex-wrap`, so the two controls drop below the name on a phone rather
          than squeezing a long company name into a third of the width. */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex min-w-0 items-center gap-2 text-hero font-bold tracking-heading text-ink">
          <Building2 size={20} className="flex-none text-faint" />
          <span className="min-w-0 break-words">{customer.name}</span>
        </h1>
        <div className="flex flex-none items-center gap-2">
          <Button
            variant="secondary"
            onClick={onRename}
            className={cn("gap-1.5", TOUCH_HEIGHT)}
          >
            <Pencil size={13} strokeWidth={2} />
            {t("adminCustomers.rename")}
          </Button>
          {canArchive ? (
            <Button
              variant="secondary"
              onClick={onArchive}
              className={cn("gap-1.5", TOUCH_HEIGHT)}
            >
              <Archive size={13} strokeWidth={2} />
              {t("adminCustomers.archive")}
            </Button>
          ) : null}
        </div>
      </header>

      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {(
            [
              ["projects", customer.counts.projects],
              ["tickets", customer.counts.tickets],
              ["users", customer.counts.users],
            ] as const
          ).map(([key, n]) => (
            <div key={key}>
              <dt className="text-eyebrow font-semibold uppercase tracking-eyebrow text-faint">
                {t(`adminCustomers.count.${key}`)}
              </dt>
              <dd className="mt-0.5 text-section font-semibold tabular-nums text-ink">
                {n}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section font-semibold text-ink">
          {t("adminCustomers.projects")}
        </h2>
        {/* The customer is already chosen, so adding a project asks for a name
            and nothing else — see ProjectFormModal. A customer may run as many
            as it likes; nothing here caps them. */}
        <Button onClick={onAddProject} className={cn("gap-1.5", TOUCH_HEIGHT)}>
          <Plus size={14} strokeWidth={2.5} />
          {t("adminCustomers.newProject")}
        </Button>
      </div>
      {projectsLoading ? (
        <LoadingRow />
      ) : projects.length === 0 ? (
        <EmptyState message={t("adminCustomers.noProjects")} />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-panel">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 border-b border-hairline pr-2 last:border-b-0"
            >
              {/* The row opens the project's own page — where its description
                  and the tickets filed under it live. That page is deliberately
                  kept rather than folded in here: a list of tickets and a CRUD
                  pane are two different jobs. */}
              <button
                type="button"
                onClick={() => router.push(`/projects/${p.id}`)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-left hover:bg-app",
                  TOUCH_TARGET,
                )}
              >
                <FolderKanban size={14} className="flex-none text-faint" />
                <span className="min-w-0 flex-1 truncate text-control font-medium text-ink">
                  {p.name}
                </span>
                <span className="flex-none text-caption text-faint">
                  {t("adminCustomers.memberCount", { n: p.members })}
                </span>
                <ChevronRight size={14} className="flex-none text-faint" />
              </button>
              <button
                type="button"
                onClick={() => onEditProject(p)}
                aria-label={t("adminCustomers.editProjectNamed", { name: p.name })}
                className={cn(
                  "grid flex-none place-items-center rounded-md text-faint hover:bg-app hover:text-ink",
                  TOUCH_TARGET,
                )}
              >
                <Pencil size={13} strokeWidth={2} />
              </button>
              {canArchive ? (
                <button
                  type="button"
                  onClick={() => onArchiveProject(p)}
                  aria-label={t("adminCustomers.archiveProjectNamed", { name: p.name })}
                  className={cn(
                    "grid flex-none place-items-center rounded-md text-faint hover:bg-danger-bg hover:text-danger",
                    TOUCH_TARGET,
                  )}
                >
                  <Archive size={13} strokeWidth={2} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
