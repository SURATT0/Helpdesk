import { describe, expect, it } from "vitest";
import { ACCEPTED_TYPES, ATTACHMENT_ACCEPT } from "./accept";

/**
 * The picker's list and the API's list have to agree, and they drifted apart in
 * both directions before this file existed: `image/*` offered formats the server
 * refuses (HEIC, straight off an iPhone), while plain text, zip, .doc and .docx
 * were accepted by the server and greyed out in the picker.
 *
 * The server's set lives in `backend/src/modules/attachments/attachment.service.ts`
 * as `ALLOWED_TYPES`. It is restated here rather than imported — the two
 * packages do not share a module graph — so this test is the seam that fails
 * when one side moves without the other.
 */
const SERVER_ALLOWED_TYPES = [
  // RENDERABLE_MIMES
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // …plus the documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

describe("the attachment accept list", () => {
  it("offers exactly what the API accepts — no more, no less", () => {
    expect([...ACCEPTED_TYPES].sort()).toEqual([...SERVER_ALLOWED_TYPES].sort());
  });

  // A wildcard is how the iPhone case happened: the picker let someone choose a
  // HEIC photo and the upload came back refused after they had chosen it.
  it("names concrete types rather than a wildcard", () => {
    expect(ATTACHMENT_ACCEPT).not.toContain("*");
  });

  // Mixing `.ext` aliases with MIME types buys nothing on a desktop and is one
  // of the shapes iOS Safari is reported to handle badly.
  it("carries no bare file-extension aliases", () => {
    for (const type of ACCEPTED_TYPES) {
      expect(type, `${type} looks like an extension`).toContain("/");
    }
  });

  // SVG can carry script; rendering one inline would be an XSS vector, and the
  // server refuses it. The picker must not offer it either.
  it("does not offer SVG", () => {
    expect(ATTACHMENT_ACCEPT).not.toContain("svg");
  });

  it("is a comma-separated attribute value", () => {
    expect(ATTACHMENT_ACCEPT.split(",")).toHaveLength(ACCEPTED_TYPES.length);
    expect(ATTACHMENT_ACCEPT).not.toContain(" ");
  });
});
