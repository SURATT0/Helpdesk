"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPermissionMatrix } from "./api";

export const permissionKeys = {
  matrix: ["permissions", "matrix"] as const,
};

/**
 * The live matrix.
 *
 * Not keyed by viewer: the table is the same for everybody who reads it — it
 * describes roles, not the person asking — so one cache entry serves the page
 * whoever is signed in.
 */
export function usePermissionMatrix() {
  return useQuery({
    queryKey: permissionKeys.matrix,
    queryFn: fetchPermissionMatrix,
    // Grants change when somebody edits them, which is rare and never in the
    // middle of reading this page. A minute keeps a tab switch from re-asking
    // while still catching an edit made in another window.
    staleTime: 60_000,
  });
}
