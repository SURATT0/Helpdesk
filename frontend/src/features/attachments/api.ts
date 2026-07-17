import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api-client";
import { tokenStore } from "@/features/auth/token-store";
import {
  attachmentEnvelopeSchema,
  attachmentListSchema,
  type Attachment,
} from "./schemas";

export async function fetchAttachments(
  ticketId: number,
): Promise<Attachment[]> {
  const body = await apiRequest(`/tickets/${ticketId}/attachments`);
  return attachmentListSchema.parse(body).data;
}

export async function uploadAttachment(
  ticketId: number,
  file: File,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const body = await apiRequest(`/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: form,
  });
  return attachmentEnvelopeSchema.parse(body).data;
}

export async function deleteAttachment(id: number): Promise<void> {
  await apiRequest(`/attachments/${id}`, { method: "DELETE" });
}

/** Fetch an attachment's bytes with the bearer token (authed binary endpoint). */
async function fetchBlob(id: number, disposition: "inline" | "attachment") {
  const token = tokenStore.get();
  const res = await fetch(
    `${API_BASE_URL}/attachments/${id}?disposition=${disposition}`,
    {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!res.ok) {
    throw new ApiError(res.status, "ATTACHMENT_ERROR", "Couldn't open file");
  }
  return res.blob();
}

/**
 * Download is a binary, authed endpoint — fetch it with the bearer token and
 * push the blob to the browser (a plain <a href> couldn't send the token).
 */
export async function downloadAttachment(
  id: number,
  filename: string,
): Promise<void> {
  const blob = await fetchBlob(id, "attachment");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetch an attachment as an object URL for inline `<img>` display. The endpoint
 * is authed (needs the bearer token), so a plain URL can't be used as a src —
 * the caller must revoke the returned URL when the element unmounts.
 */
export async function fetchAttachmentObjectUrl(id: number): Promise<string> {
  const blob = await fetchBlob(id, "inline");
  return URL.createObjectURL(blob);
}

/**
 * View an attachment inline (images / PDFs preview in a new tab; other types
 * fall back to a download in the browser). The tab is opened synchronously so
 * the user-gesture survives the async fetch and popup blockers don't fire.
 */
export async function viewAttachment(id: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const blob = await fetchBlob(id, "inline");
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      window.location.href = url; // popup blocked — same-tab fallback
    }
    // Give the new tab time to load before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}
