/**
 * ตรวจ Microsoft 365 integration ครบวงจรในสคริปต์เดียว
 *   npx tsx src/scripts/graph-check.ts                 → ดูสิทธิ์ + ทดสอบ inbound
 *   GRAPH_SEND=true PROBE_TO=x@y npx tsx src/scripts/graph-check.ts  → ทดสอบขาส่งด้วย
 *
 * อยู่ใต้ src/ เพื่อให้ `npm run typecheck` ตรวจถึง — ตอนอยู่ที่ราก backend/
 * มันอยู่นอก `include` ของ tsconfig และเน่าได้เงียบ ๆ เมื่อ signature เปลี่ยน
 * ส่วน tsconfig.build.json กัน src/scripts/ ออก dist/ ไว้แล้ว เครื่องมือ
 * diagnostic จึงไม่ติดไปกับ production image
 */
import { graphToken, graphFetch, safeText } from "../modules/integrations/email/graph-client";
import { GraphEmailSource } from "../modules/integrations/sources/graph-email.source";
import { mailSender } from "../modules/integrations/email/mail-sender";
import { env } from "../config/env";

const claims = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString());

async function main() {
  const p = claims(await graphToken());
  const roles: string[] = p.roles ?? [];
  console.log("=== สิทธิ์ที่ token พกมา ===");
  console.log("roles   :", JSON.stringify(roles));
  console.log("app     :", p.app_displayname, `(${p.appid})`);
  console.log("mailbox :", env.integrations.graph.mailbox);
  const canRead = roles.includes("Mail.ReadWrite") || roles.includes("Mail.Read");
  console.log("อ่านเมลได้:", canRead ? "ใช่" : "ไม่ - ยังขาด Mail.ReadWrite");

  const box = encodeURIComponent(env.integrations.graph.mailbox!);

  console.log("\n=== ขาส่ง ===");
  if (!process.env.PROBE_TO) {
    console.log("(ข้าม - ไม่ได้ตั้ง PROBE_TO)");
  } else if (mailSender.transport !== "graph") {
    console.log("(ข้าม - transport =", mailSender.transport + ")");
  } else {
    try {
      const res = await mailSender.send({
        // The mailbox GRAPH_MAILBOX names — the same address GraphMailSender
        // sends as, since an app-only token sends through a mailbox rather than
        // as a person. Stated rather than cast away: this used to be `as never`,
        // which silenced `OutboundMail.from` being required and would have sent
        // with no sender at all through any transport that reads the field.
        from: env.integrations.graph.mailbox!,
        to: process.env.PROBE_TO,
        subject: "Deskly - outbound through the real sender",
        text: "Sent by GraphMailSender: draft created, internetMessageId read, draft sent.",
        html: "<p>Sent by <b>GraphMailSender</b>.</p>",
        headers: { "X-Deskly-Ticket-Id": "probe" },
      });
      console.log("สำเร็จ:", JSON.stringify(res));
    } catch (e) {
      console.log("ล้มเหลว:", (e as Error).message);
    }
  }

  console.log("\n=== ขารับ ===");
  const peek = await graphFetch(
    `/users/${box}/mailFolders/inbox/messages?$filter=isRead eq false&$top=5&$select=subject,from,receivedDateTime`,
  );
  if (!peek.ok) {
    console.log("อ่าน inbox ไม่ได้:", peek.status, (await safeText(peek)).slice(0, 140));
    return;
  }
  const { value } = (await peek.json()) as {
    value: { subject: string; from?: { emailAddress?: { address?: string } }; receivedDateTime: string }[];
  };
  console.log(`เมลที่ยังไม่ได้อ่าน: ${value.length}`);
  for (const m of value) console.log(`  - ${m.from?.emailAddress?.address ?? "?"} : ${m.subject}`);
  if (value.length === 0) { console.log("(ไม่มีเมลใหม่ให้ ingest)"); return; }

  console.log("\nเรียก syncMail()...");
  console.log(JSON.stringify(await new GraphEmailSource().syncMail(), null, 2));
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
