"use client";

import { Topbar } from "@/components/layout/topbar";
import { AuditView } from "@/features/audit/components/audit-view";

export default function AuditPage() {
  return (
    <>
      <Topbar titleKey="nav.audit" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <AuditView />
      </main>
    </>
  );
}
