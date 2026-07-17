"use client";

import { PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { AttachmentsPanel } from "@/features/attachments/attachments-panel";
import { useI18n } from "@/features/i18n/context";
import { slaColor } from "../data";
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
    <div className={first ? "" : "border-t border-[#eef1f5] pt-4"}>
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
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
  const unassigned = t("bulk.unassigned");
  return (
    <aside className="flex flex-col gap-[18px] bg-panel p-5">
      <Section title={t("rail.properties")} first>
        <div className="flex flex-col gap-2.5 text-[12.5px]">
          <Row label={t("col.status")}>
            <StatusMenu ticket={ticket} />
          </Row>
          <Row label={t("col.priority")}>
            <PriorityIndicator
              priority={ticket.priority}
              className="font-medium text-ink"
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
        <div className="flex items-center justify-between rounded-[9px] border border-line bg-[#fafbfc] px-3.5 py-3">
          <span className="text-[12px] font-semibold text-muted">
            {t("rail.resolutionDue")}
          </span>
          <span
            className="font-mono text-[12.5px] font-semibold"
            style={{ color: slaColor[ticket.slaState] }}
          >
            {ticket.slaDue}
          </span>
        </div>
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
