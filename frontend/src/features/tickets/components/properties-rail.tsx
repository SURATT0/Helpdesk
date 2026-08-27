"use client";

import { PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { AttachmentsPanel } from "@/features/attachments/components/attachments-panel";
import { ProblemPanel } from "@/features/problems/components/problem-panel";
import { useI18n } from "@/features/i18n/context";
import { SlaBadge } from "./sla-badge";
import { useAssessSla } from "../use-sla";
import { HistoryPanel } from "./history-panel";
import { StatusMenu } from "./status-menu";
import type { Ticket } from "../schemas";

function Section({
  title,
  children,
  first,
}: {
  title: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div className={first ? "" : "border-t border-hairline pt-4"}>
      <div className="mb-2.5 text-eyebrow font-semibold uppercase tracking-[0.08em] text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

export function PropertiesRail({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const assess = useAssessSla();
  const unassigned = t("bulk.unassigned");
  return (
    <aside className="flex flex-col gap-[18px] bg-panel p-5">
      <Section title={t("rail.properties")} first>
        <div className="flex flex-col gap-2.5 text-body">
          <Row label={t("col.status")}>
            <StatusMenu ticket={ticket} />
          </Row>
          <Row label={t("col.priority")}>
            {/* `ink`, matching the Status, Category and Requester values beside
                it — a property's value reads darker than its label. */}
            <PriorityIndicator
              priority={ticket.priority}
              tone="ink"
              className="font-medium"
            />
          </Row>
          <Row label={t("col.assignee")}>
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <Avatar name={ticket.assignee ?? unassigned} size={20} />
              {ticket.assignee ?? unassigned}
            </span>
          </Row>
          <Row label={t("col.category")}>
            <span className="font-medium text-ink">{ticket.category}</span>
          </Row>
          <Row label={t("col.requester")}>
            <span className="font-medium text-ink">{ticket.requester}</span>
          </Row>
        </div>
      </Section>

      <Section title="SLA">
        <div className="flex items-center justify-between rounded-tile border border-line bg-wash px-3.5 py-3">
          <span className="text-dense font-semibold text-muted">
            {t("rail.resolutionDue")}
          </span>
          <SlaBadge sla={assess(ticket)} />
        </div>
      </Section>

      {/* Above attachments: whether this incident is part of a known problem
          changes how the agent handles it, so it belongs near the top. */}
      <Section title={t("rail.problem")}>
        <ProblemPanel ticket={ticket} />
      </Section>

      <Section title={t("rail.attachments", { n: ticket.attachments })}>
        <AttachmentsPanel ticketId={ticket.id} />
      </Section>

      <Section title={t("rail.history")}>
        <HistoryPanel ticketId={ticket.id} />
      </Section>
    </aside>
  );
}
