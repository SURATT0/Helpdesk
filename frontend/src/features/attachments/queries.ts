import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commentKeys, ticketKeys } from "@/features/tickets/queries";
import { deleteAttachment, fetchAttachments, uploadAttachment } from "./api";

export const attachmentKeys = {
  list: (ticketId: number) => ["attachments", ticketId] as const,
};

export function useAttachments(ticketId: number) {
  return useQuery({
    queryKey: attachmentKeys.list(ticketId),
    queryFn: () => fetchAttachments(ticketId),
    enabled: Number.isFinite(ticketId),
  });
}

/**
 * Upload a file to a ticket, optionally linked to the message it was sent with.
 *
 * The variables are an object rather than a bare `File` so `commentId` can ride
 * along: a file sent with a chat message is drawn inside that bubble, and a file
 * added from the sidebar belongs to the ticket alone.
 *
 * Invalidates the comment thread as well as the file list — the message the file
 * was linked to has to refetch, or the bubble it belongs in stays empty until
 * something else happens to refresh it.
 */
export function useUploadAttachment(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: File | { file: File; commentId?: number }) =>
      vars instanceof File
        ? uploadAttachment(ticketId, vars)
        : uploadAttachment(ticketId, vars.file, vars.commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentKeys.list(ticketId) });
      qc.invalidateQueries({ queryKey: commentKeys.list(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all }); // refresh the count
    },
  });
}

export function useDeleteAttachment(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAttachment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentKeys.list(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all }); // refresh the count
    },
  });
}
