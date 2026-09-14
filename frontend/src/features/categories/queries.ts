import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCategory, fetchOtherDescriptions } from "./api";

export const categoryKeys = {
  otherDescriptions: ["categories", "other-descriptions"] as const,
};

/**
 * The "Other" phrases, for the review page.
 *
 * `enabled` because only platform staff may read it — asking as anybody else is
 * a guaranteed 403, and a page that fires one to decide what to render has
 * already told the user it is broken.
 */
export function useOtherDescriptions(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: categoryKeys.otherDescriptions,
    queryFn: fetchOtherDescriptions,
    enabled: opts.enabled ?? true,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    // Both: the phrase list is unchanged by a promotion (the old tickets keep
    // their words) but the CATEGORY list now has a new row, and the create-ticket
    // form reads that.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["categories"] });
      void qc.invalidateQueries({ queryKey: categoryKeys.otherDescriptions });
    },
  });
}
