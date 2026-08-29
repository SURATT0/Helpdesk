import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { storage } from "../src/shared/storage";
import { buildDisplayName } from "../src/modules/attachments/attachment.naming";
import { prisma, resetDb } from "./db";

/**
 * Images in the chat, and the three names an attachment has.
 *
 * The seed creates no attachments, so every fixture here is uploaded through the
 * real endpoint — which means the magic-byte check, the display name, the
 * thumbnail and the message link are all exercised as a request would exercise
 * them, not as a repository call.
 */

const app = createApp();
const API = "/api/v1";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const AGENT = "dana.reyes@acme.com"; // admin, Acme — assignee of 1042
const REQUESTER = "marcus.chen@acme.com"; // user, Acme — requester of 1042
const OUTSIDER = "l.osei@acme.com"; // user, Acme — unrelated to 1042
const GLOBEX = "priya.shah@acme.com"; // user, Globex

/** The ticket the image cases hang off: Acme, Marcus requests, Dana assigned. */
const TICKET = 1042;

/** A real PNG of the given size, so sharp has something genuine to measure. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

/** Bytes that are not an image at all, whatever they are called. */
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(256)]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

async function upload(
  token: string,
  opts: {
    ticketId?: number;
    file: Buffer;
    name: string;
    type: string;
    commentId?: number;
  },
) {
  const req = request(app)
    .post(`${API}/tickets/${opts.ticketId ?? TICKET}/attachments`)
    .set(bearer(token));
  if (opts.commentId != null) req.field("commentId", String(opts.commentId));
  return req.attach("file", opts.file, { filename: opts.name, contentType: opts.type });
}

async function postComment(token: string, body: string): Promise<number> {
  const res = await request(app)
    .post(`${API}/tickets/${TICKET}/comments`)
    .set(bearer(token))
    .send({ body, internal: false });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

beforeEach(async () => {
  await resetDb();
});

describe("display names", () => {
  it("names the first file in a ticket T<id>-01-<slug>.<ext>", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: await png(40, 30),
      name: "error screen.png",
      type: "image/png",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.displayName).toBe(`T${TICKET}-01-error-screen.png`);
    // The uploader's own name is kept alongside it, not replaced.
    expect(res.body.data.filename).toBe("error screen.png");
  });

  it("numbers the second file in the same ticket 02", async () => {
    const token = await login(AGENT);
    await upload(token, { file: await png(20, 20), name: "one.png", type: "image/png" });
    const second = await upload(token, {
      file: await png(20, 20),
      name: "two.png",
      type: "image/png",
    });
    expect(second.body.data.displayName).toBe(`T${TICKET}-02-two.png`);
  });

  it("keeps Thai characters in the slug", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: await png(20, 20),
      name: "ภาพหน้าจอ.png",
      type: "image/png",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.displayName).toBe(`T${TICKET}-01-ภาพหน้าจอ.png`);
  });

  it("caps a 200-character name at 100 characters", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: await png(20, 20),
      name: `${"a".repeat(200)}.png`,
      type: "image/png",
    });
    expect(res.status).toBe(201);
    const name: string = res.body.data.displayName;
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith(`T${TICKET}-01-`)).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
  });

  it("stores a key that carries no ticket id and no uploader text", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: await png(20, 20),
      name: "../../etc/passwd.png",
      type: "image/png",
    });
    expect(res.status).toBe(201);
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.storageKey).toMatch(/^attachments\/[0-9a-f]{32}\.png$/);
    expect(row.storageKey).not.toContain(String(TICKET));
    expect(row.storageKey).not.toContain("passwd");
  });

  it("serves the display name in an RFC 5987 header a Thai name survives", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(20, 20),
      name: "ภาพหน้าจอ.png",
      type: "image/png",
    });
    const res = await request(app)
      .get(`${API}/attachments/${created.body.data.id}`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const cd = res.headers["content-disposition"] as string;
    // The plain parameter can only hold ASCII, so the real name rides in
    // `filename*`. Both are present, which is what RFC 6266 asks for.
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain(encodeURIComponent(`T${TICKET}-01-ภาพหน้าจอ.png`));
    expect(res.headers["cache-control"]).toContain("private");
  });
});

describe("magic bytes", () => {
  it("refuses an executable renamed to .png", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: EXE,
      name: "screenshot.png",
      type: "image/png",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("executable");
    // Nothing was stored — not the row, and not the bytes.
    expect(await prisma.attachment.count({ where: { ticketId: TICKET } })).toBe(0);
  });

  it("refuses a JPEG that claims to be a PNG", async () => {
    const token = await login(AGENT);
    const jpeg = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    const res = await upload(token, {
      file: jpeg,
      name: "shot.png",
      type: "image/png",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("image/jpeg");
  });

  it("refuses an SVG, which is why none can ever be rendered inline", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: SVG,
      name: "icon.svg",
      type: "image/svg+xml",
    });
    expect(res.status).toBe(400);
  });

  it("marks a stored SVG as not renderable, if one ever exists", async () => {
    // The API cannot produce this row — SVG is refused at upload. It is written
    // directly to prove the READ path is what decides renderability, so a row
    // that arrived some other way is still a download card and never an <img>.
    const dana = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
    await prisma.attachment.create({
      data: {
        ticketId: TICKET,
        uploaderId: dana.id,
        filename: "legacy.svg",
        displayName: `T${TICKET}-01-legacy.svg`,
        contentType: "image/svg+xml",
        sizeBytes: SVG.length,
        storageKey: "attachments/legacy.svg",
      },
    });
    const res = await request(app)
      .get(`${API}/tickets/${TICKET}/attachments`)
      .set(bearer(await login(AGENT)));
    expect(res.status).toBe(200);
    const svg = res.body.data.find((a: { filename: string }) => a.filename === "legacy.svg");
    expect(svg.isImage).toBe(false);
  });
});

describe("thumbnails and dimensions", () => {
  it("records the original's pixel size", async () => {
    const token = await login(AGENT);
    const res = await upload(token, {
      file: await png(1200, 400),
      name: "wide.png",
      type: "image/png",
    });
    expect(res.body.data.width).toBe(1200);
    expect(res.body.data.height).toBe(400);
  });

  it("makes a resized copy for a large image and serves it from /thumb", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(1600, 800),
      name: "big.png",
      type: "image/png",
    });
    expect(created.body.data.hasThumbnail).toBe(true);

    const thumb = await request(app)
      .get(`${API}/attachments/${created.body.data.id}/thumb`)
      .set(bearer(token));
    expect(thumb.status).toBe(200);
    expect(thumb.headers["cache-control"]).toContain("private");
    // The point of the thumbnail: the bubble loads 800px, not 1600.
    const meta = await sharp(thumb.body).metadata();
    expect(meta.width).toBe(800);

    const full = await request(app)
      .get(`${API}/attachments/${created.body.data.id}`)
      .set(bearer(token));
    expect((await sharp(full.body).metadata()).width).toBe(1600);
  });

  it("makes no copy for an image already small enough", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(320, 200),
      name: "small.png",
      type: "image/png",
    });
    expect(created.body.data.hasThumbnail).toBe(false);
    // /thumb still answers — it falls back to the original, so the client never
    // has to branch on whether a thumbnail was produced.
    const thumb = await request(app)
      .get(`${API}/attachments/${created.body.data.id}/thumb`)
      .set(bearer(token));
    expect(thumb.status).toBe(200);
    expect((await sharp(thumb.body).metadata()).width).toBe(320);
  });

  it("stores the file even when it cannot be measured or resized", async () => {
    // A .png header with garbage after it: sharp cannot read this, and the
    // upload must still succeed — losing the file because we could not shrink it
    // would be worse than serving the original.
    const token = await login(AGENT);
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not really a png"),
    ]);
    const res = await upload(token, {
      file: broken,
      name: "truncated.png",
      type: "image/png",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.width).toBeNull();
    expect(res.body.data.hasThumbnail).toBe(false);
    expect(res.body.data.isImage).toBe(true);
  });

  it("refuses /thumb for something that is not an image", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: Buffer.from("%PDF-1.4\nnot really\n"),
      name: "manual.pdf",
      type: "application/pdf",
    });
    expect(created.status).toBe(201);
    const res = await request(app)
      .get(`${API}/attachments/${created.body.data.id}/thumb`)
      .set(bearer(token));
    expect(res.status).toBe(400);
  });
});

describe("the link to a message", () => {
  it("attaches a file to the message it was sent with", async () => {
    const token = await login(AGENT);
    const commentId = await postComment(token, "Here is the error");
    const created = await upload(token, {
      file: await png(60, 40),
      name: "error.png",
      type: "image/png",
      commentId,
    });
    expect(created.body.data.commentId).toBe(commentId);

    // And the thread carries it, so the bubble can draw it.
    const thread = await request(app)
      .get(`${API}/tickets/${TICKET}/comments`)
      .set(bearer(token));
    const message = thread.body.data.find((c: { id: number }) => c.id === commentId);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].displayName).toBe(`T${TICKET}-01-error.png`);
    expect(message.attachments[0].width).toBe(60);
  });

  it("carries three images on one message, in upload order", async () => {
    const token = await login(AGENT);
    const commentId = await postComment(token, "Three shots");
    for (const name of ["first.png", "second.png", "third.png"]) {
      const res = await upload(token, {
        file: await png(30, 30),
        name,
        type: "image/png",
        commentId,
      });
      expect(res.status).toBe(201);
    }
    const thread = await request(app)
      .get(`${API}/tickets/${TICKET}/comments`)
      .set(bearer(token));
    const message = thread.body.data.find((c: { id: number }) => c.id === commentId);
    expect(message.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      "first.png",
      "second.png",
      "third.png",
    ]);
    // Sequence follows upload order, which is what the grid reads.
    expect(message.attachments.map((a: { displayName: string }) => a.displayName)).toEqual(
      [
        `T${TICKET}-01-first.png`,
        `T${TICKET}-02-second.png`,
        `T${TICKET}-03-third.png`,
      ],
    );
  });

  it("leaves a ticket-level file unlinked, so no bubble claims it", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(30, 30),
      name: "sidebar.png",
      type: "image/png",
    });
    expect(created.body.data.commentId).toBeNull();

    const thread = await request(app)
      .get(`${API}/tickets/${TICKET}/comments`)
      .set(bearer(token));
    for (const c of thread.body.data) expect(c.attachments).toEqual([]);
  });

  it("refuses a message id that belongs to another ticket", async () => {
    const token = await login(AGENT);
    const commentId = await postComment(token, "on 1042");
    const res = await upload(token, {
      ticketId: 1035,
      file: await png(30, 30),
      name: "wrong.png",
      type: "image/png",
      commentId,
    });
    expect(res.status).toBe(400);
  });
});

describe("missing bytes", () => {
  it("answers 404 when the row exists but the file is gone", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(900, 600),
      name: "vanishing.png",
      type: "image/png",
    });
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    await storage.delete(row.storageKey);
    if (row.thumbKey) await storage.delete(row.thumbKey);

    // A clean 404 rather than a 500: the thread draws "file unavailable" from
    // this, and a crash here would take the whole conversation with it.
    for (const path of [`/attachments/${row.id}`, `/attachments/${row.id}/thumb`]) {
      const res = await request(app).get(`${API}${path}`).set(bearer(token));
      expect(res.status, path).toBe(404);
    }

    // The thread itself still loads, with the row still listed.
    const list = await request(app)
      .get(`${API}/tickets/${TICKET}/attachments`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.some((a: { id: number }) => a.id === row.id)).toBe(true);
  });

  it("falls back to the original when only the thumbnail is gone", async () => {
    const token = await login(AGENT);
    const created = await upload(token, {
      file: await png(1200, 600),
      name: "thumbless.png",
      type: "image/png",
    });
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.thumbKey).not.toBeNull();
    await storage.delete(row.thumbKey!);

    const res = await request(app)
      .get(`${API}/attachments/${row.id}/thumb`)
      .set(bearer(token));
    expect(res.status).toBe(200);
    // Served the full image rather than nothing: a derived file going missing
    // should cost bandwidth, not the picture.
    expect((await sharp(res.body).metadata()).width).toBe(1200);
  });
});

describe("who may see the bytes", () => {
  it("serves the requester and the assignee of the ticket", async () => {
    const agent = await login(AGENT);
    const created = await upload(agent, {
      file: await png(40, 40),
      name: "shared.png",
      type: "image/png",
    });
    const id = created.body.data.id;

    for (const email of [AGENT, REQUESTER]) {
      const res = await request(app)
        .get(`${API}/attachments/${id}/thumb`)
        .set(bearer(await login(email)));
      expect(res.status, email).toBe(200);
    }
  });

  it("refuses a requester with no connection to the ticket", async () => {
    const created = await upload(await login(AGENT), {
      file: await png(40, 40),
      name: "private.png",
      type: "image/png",
    });
    const id = created.body.data.id;

    for (const email of [OUTSIDER, GLOBEX]) {
      for (const path of [`/attachments/${id}`, `/attachments/${id}/thumb`]) {
        const res = await request(app)
          .get(`${API}${path}`)
          .set(bearer(await login(email)));
        // 404, not 403, and deliberately so: every row-scoped read in this
        // codebase refuses by claiming the row does not exist, because a 403
        // confirms that it does. No bytes either way, which is the requirement.
        expect(res.status, `${email} ${path}`).toBe(404);
        expect(res.body.data).toBeUndefined();
      }
    }
  });

  it("serves nothing at all without a token", async () => {
    const created = await upload(await login(AGENT), {
      file: await png(40, 40),
      name: "anon.png",
      type: "image/png",
    });
    const res = await request(app).get(
      `${API}/attachments/${created.body.data.id}/thumb`,
    );
    expect(res.status).toBe(401);
  });
});

describe("backfill", () => {
  it("names every legacy row without colliding inside a ticket", async () => {
    // Rows as they existed before `display_name`: no name, no dimensions.
    const dana = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
    const base = new Date("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await prisma.attachment.create({
        data: {
          ticketId: TICKET,
          uploaderId: dana.id,
          filename: "same name.png",
          contentType: "image/png",
          sizeBytes: 10,
          storageKey: `attachments/legacy-${i}.png`,
          createdAt: new Date(base.getTime() + i * 1000),
        },
      });
    }
    // A second ticket, to prove the sequence is per-ticket.
    await prisma.attachment.create({
      data: {
        ticketId: 1035,
        uploaderId: dana.id,
        filename: "other.png",
        contentType: "image/png",
        sizeBytes: 10,
        storageKey: "attachments/legacy-other.png",
        createdAt: base,
      },
    });

    // The backfill's own logic, applied the way the script applies it: ordered
    // by ticket then age, numbering from 1 within each ticket.
    const pending = await prisma.attachment.findMany({
      where: { displayName: null },
      orderBy: [{ ticketId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const seq = new Map<number, number>();
    for (const row of pending) {
      const next = (seq.get(row.ticketId) ?? 0) + 1;
      seq.set(row.ticketId, next);
      await prisma.attachment.update({
        where: { id: row.id },
        data: {
          displayName: buildDisplayName({
            ticketId: row.ticketId,
            sequence: next,
            originalName: row.filename,
            ext: "png",
          }),
        },
      });
    }

    const named = await prisma.attachment.findMany({
      where: { ticketId: TICKET },
      orderBy: { createdAt: "asc" },
    });
    expect(named.map((a) => a.displayName)).toEqual([
      `T${TICKET}-01-same-name.png`,
      `T${TICKET}-02-same-name.png`,
      `T${TICKET}-03-same-name.png`,
    ]);
    // Three identical original names, three distinct display names.
    expect(new Set(named.map((a) => a.displayName)).size).toBe(3);

    const other = await prisma.attachment.findFirstOrThrow({
      where: { ticketId: 1035 },
    });
    expect(other.displayName).toBe("T1035-01-other.png");

    expect(await prisma.attachment.count({ where: { displayName: null } })).toBe(0);
  });

  it("refuses a duplicate display name inside one ticket at the database", async () => {
    const dana = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
    const row = {
      ticketId: TICKET,
      uploaderId: dana.id,
      filename: "x.png",
      displayName: `T${TICKET}-01-x.png`,
      contentType: "image/png",
      sizeBytes: 1,
    };
    await prisma.attachment.create({
      data: { ...row, storageKey: "attachments/a.png" },
    });
    // This is the guard that makes the sequence race safe — without it two
    // concurrent uploads could both write 01.
    await expect(
      prisma.attachment.create({
        data: { ...row, storageKey: "attachments/b.png" },
      }),
    ).rejects.toThrow();
  });
});
