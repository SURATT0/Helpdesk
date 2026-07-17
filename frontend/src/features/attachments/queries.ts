import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ticketKeys } from "@/features/tickets/queries";
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

export function useUploadAttachment(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAttachment(ticketId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentKeys.list(ticketId) });
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
