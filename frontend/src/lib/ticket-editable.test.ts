import { describe, expect, it } from "vitest";
import { mayEditOwnWording } from "./ticket-editable";

/**
 * The client half of the edit rule.
 *
 * It decides whether to OFFER the edit; the server decides whether to allow it,
 * again, inside the write. These cases exist so the button appears in the same
 * situations the API accepts — a button that is offered and then refused is a
 * worse experience than no button, and one that is hidden when the edit would
 * have worked silently removes something people are entitled to.
 */

const base = {
  status: "new",
  requesterId: 7,
  viewerId: 7,
  comments: [] as { internal: boolean; author: { role: string } }[],
};

describe("offering the edit", () => {
  it("offers it on an untouched ticket of your own", () => {
    expect(mayEditOwnWording(base)).toBe(true);
  });

  it("still offers it when an agent has been assigned but has said nothing", () => {
    // Assignment is not work. This is the case the whole rule exists for, and
    // the one a naive "is it assigned?" check would get wrong.
    expect(mayEditOwnWording({ ...base })).toBe(true);
  });

  it("still offers it after an INTERNAL note — that is not an answer", () => {
    expect(
      mayEditOwnWording({
        ...base,
        comments: [{ internal: true, author: { role: "admin" } }],
      }),
    ).toBe(true);
  });

  it("still offers it after the requester's own comment", () => {
    expect(
      mayEditOwnWording({
        ...base,
        comments: [{ internal: false, author: { role: "user" } }],
      }),
    ).toBe(true);
  });
});

describe("withdrawing it", () => {
  it("withdraws it once the desk has replied publicly", () => {
    expect(
      mayEditOwnWording({
        ...base,
        comments: [{ internal: false, author: { role: "admin" } }],
      }),
    ).toBe(false);
  });

  it("withdraws it once the ticket leaves `new`", () => {
    for (const status of ["pending", "closed"]) {
      expect(mayEditOwnWording({ ...base, status }), status).toBe(false);
    }
  });

  it("never offers it on somebody else's ticket", () => {
    expect(mayEditOwnWording({ ...base, viewerId: 8 })).toBe(false);
  });

  it("never offers it to a signed-out viewer", () => {
    expect(mayEditOwnWording({ ...base, viewerId: undefined })).toBe(false);
  });
});
