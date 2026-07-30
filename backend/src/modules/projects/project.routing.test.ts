import { describe, expect, it } from "vitest";
import { resolveRoutedAssignee, type ProjectRouting } from "./project.routing";

const routing = (over: Partial<ProjectRouting> = {}): ProjectRouting => ({
  ownerId: 10,
  ownerAvailable: true,
  backupOwnerId: 20,
  backupOwnerAvailable: true,
  ...over,
});

describe("resolveRoutedAssignee", () => {
  it("routes to the owner when they are available", () => {
    expect(resolveRoutedAssignee(routing())).toBe(10);
  });

  // The whole point of the feature: the owner being away must not mean the
  // ticket lands on nobody.
  it("falls back to the backup when the owner is away", () => {
    expect(resolveRoutedAssignee(routing({ ownerAvailable: false }))).toBe(20);
  });

  it("falls back to the backup when there is no owner at all", () => {
    expect(
      resolveRoutedAssignee(routing({ ownerId: null, ownerAvailable: false })),
    ).toBe(20);
  });

  it("leaves the ticket unassigned when both are away", () => {
    // Unassigned is a real answer, not a failure — the queue is visible to every
    // agent of the customer, whereas an away caseworker is not reading theirs.
    expect(
      resolveRoutedAssignee(
        routing({ ownerAvailable: false, backupOwnerAvailable: false }),
      ),
    ).toBeNull();
  });

  it("leaves the ticket unassigned when the project has no caseworkers", () => {
    expect(
      resolveRoutedAssignee(
        routing({
          ownerId: null,
          ownerAvailable: false,
          backupOwnerId: null,
          backupOwnerAvailable: false,
        }),
      ),
    ).toBeNull();
  });

  it("leaves the ticket unassigned when the requester has no project", () => {
    // Pre-existing behaviour for every user who predates projects.
    expect(resolveRoutedAssignee(null)).toBeNull();
  });

  it("never returns an id whose slot is marked available but empty", () => {
    // Guards the id check as well as the availability flag, so a stale/odd row
    // can't produce assigneeId = null-ish nonsense.
    expect(
      resolveRoutedAssignee(routing({ ownerId: null, ownerAvailable: true })),
    ).toBe(20);
    expect(
      resolveRoutedAssignee(
        routing({
          ownerId: null,
          ownerAvailable: true,
          backupOwnerId: null,
          backupOwnerAvailable: true,
        }),
      ),
    ).toBeNull();
  });
});
