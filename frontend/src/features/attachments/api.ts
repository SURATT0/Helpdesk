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
  /**
   * The message this file was sent with, so the thread can draw it inside that
   * bubble. Omitted for a file attached to the ticket from the sidebar.
   */
  commentId?: number,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  if (commentId != null) form.append("commentId", String(commentId));
  const body = await apiRequest(`/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: form,
  });
  return attachmentEnvelopeSchema.parse(body).data;
}

export async function deleteAttachment(id: number): Promise<void> {
  await apiRequest(`/attachments/${id}`, { method: "DELETE" });
}

/**
 * Fetch an attachment's bytes with the bearer token (authed binary endpoint).
 *
 * `variant: "thumb"` asks for the resized copy. The server falls back to the
 * original when no thumbnail was produced, so the caller never has to branch on
 * whether one exists.
 */
async function fetchBlob(
  id: number,
  disposition: "inline" | "attachment",
  variant: "full" | "thumb" = "full",
) {
  const token = tokenStore.get();
  const path =
    variant === "thumb"
      ? `/attachments/${id}/thumb`
      : `/attachments/${id}?disposition=${disposition}`;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, "ATTACHMENT_ERROR", "Couldn't open file");
  }
  return res.blob();
}

/**
 * Download is a binary, authed endpoint — fetch it with the bearer token and
 * push the blob to the browser (a plain <a href> couldn't send the token).
 *
 * `filename` is the server's `displayName`. The browser uses this rather than the
 * `Content-Disposition` header because the blob is local by the time it is
 * saved — which is precisely why the header's RFC 5987 form matters too: an API
 * client without this code path still gets the right name.
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
 * Fetch an attachment as an object URL for inline `<img>` display.
 *
 * The endpoint needs the bearer token, and an `<img src>` cannot send one — the
 * token is deliberately kept in memory rather than in a cookie, so there is no
 * ambient credential a plain URL could ride on. Fetching the bytes and wrapping
 * them in an object URL is what keeps the route authenticated; the caller must
 * revoke the URL when the element unmounts.
 */
export async function fetchAttachmentObjectUrl(
  id: number,
  variant: "full" | "thumb" = "full",
): Promise<string> {
  const blob = await fetchBlob(id, "inline", variant);
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
