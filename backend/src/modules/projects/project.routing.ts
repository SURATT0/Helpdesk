/**
 * Who owns a project's incoming work, with each candidate's availability.
 * `null` ids mean the slot is empty; availability is false for an empty slot.
 */
export type ProjectRouting = {
  ownerId: number | null;
  ownerAvailable: boolean;
  backupOwnerId: number | null;
  backupOwnerAvailable: boolean;
};

/**
 * Who a newly created ticket should land on, based on the requester's project.
 *
 * Pure so the precedence is unit tested rather than inferred from a query:
 *
 *   1. the project owner, if they are available for assignment;
 *   2. otherwise the backup owner, if they are available;
 *   3. otherwise nobody — the ticket stays unassigned and falls to the queue,
 *      exactly as it did before projects existed.
 *
 * Returning null is a legitimate outcome, not a failure: an unassigned ticket is
 * visible in the queue to every agent of that customer, whereas assigning it to
 * someone who is away would bury it behind a person who isn't reading it.
 *
 * Note this only affects WHO the ticket is assigned to. It never affects who can
 * see it — that stays the customer boundary in `ticketScopeWhere`.
 */
export function resolveRoutedAssignee(
  routing: ProjectRouting | null,
): number | null {
  if (!routing) return null;
  if (routing.ownerId != null && routing.ownerAvailable) return routing.ownerId;
  if (routing.backupOwnerId != null && routing.backupOwnerAvailable) {
    return routing.backupOwnerId;
  }
  return null;
}
