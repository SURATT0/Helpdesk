import { apiRequest } from "@/lib/api-client";
import {
  auditActionsSchema,
  auditListSchema,
  type AuditPage,
} from "./schemas";

export type AuditFilter = {
  /** Prefix — "ticket" matches every `ticket.*` action. */
  action?: string;
  entity?: string;
  limit: number;
  offset: number;
};

export async function fetchAuditLog(filter: AuditFilter): Promise<AuditPage> {
  const qs = new URLSearchParams();
  if (filter.action) qs.set("action", filter.action);
  if (filter.entity) qs.set("entity", filter.entity);
  qs.set("limit", String(filter.limit));
  qs.set("offset", String(filter.offset));
  const body = await apiRequest(`/audit?${qs.toString()}`);
  return auditListSchema.parse(body);
}

export async function fetchAuditActions(): Promise<string[]> {
  const body = await apiRequest("/audit/actions");
  return auditActionsSchema.parse(body).data;
}
