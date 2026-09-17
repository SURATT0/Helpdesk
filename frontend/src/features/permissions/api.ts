import { apiRequest } from "@/lib/api-client";
import { permissionMatrixEnvelope, type PermissionMatrix } from "./schemas";

/** The live role × permission matrix. Readable by anyone signed in. */
export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  const body = await apiRequest("/permissions/matrix");
  return permissionMatrixEnvelope.parse(body).data;
}
