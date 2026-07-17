import { apiRequest } from "@/lib/api-client";
import { userEnvelopeSchema, userListSchema, type User } from "./schemas";

export async function fetchUsers(): Promise<User[]> {
  const body = await apiRequest("/users");
  return userListSchema.parse(body).data;
}

/** Self-service: update the signed-in user's own profile (display name). */
export async function updateMyProfile(name: string): Promise<User> {
  const body = await apiRequest("/users/me", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return userEnvelopeSchema.parse(body).data;
}
