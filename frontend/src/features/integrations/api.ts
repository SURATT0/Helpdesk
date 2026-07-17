import { apiRequest } from "@/lib/api-client";
import {
  emailStatusEnvelope,
  sourceListSchema,
  syncResultEnvelope,
  type EmailStatus,
  type SourceInfo,
  type SyncResult,
} from "./schemas";

export async function fetchSources(): Promise<SourceInfo[]> {
  const body = await apiRequest("/integrations/sources");
  return sourceListSchema.parse(body).data;
}

export async function fetchEmailStatus(): Promise<EmailStatus> {
  const body = await apiRequest("/integrations/email/status");
  return emailStatusEnvelope.parse(body).data;
}

export async function syncSource(id: string): Promise<SyncResult> {
  const body = await apiRequest(`/integrations/sources/${id}/sync`, {
    method: "POST",
  });
  return syncResultEnvelope.parse(body).data;
}
