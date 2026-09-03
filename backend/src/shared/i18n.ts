/**
 * Server-side translations, for text the server WRITES rather than renders.
 *
 * The web app has its own dictionary (`frontend/src/features/i18n/dictionary.ts`)
 * and this is deliberately not it: that one is loaded by a browser that knows
 * which human is looking at it, while this one is read by a background sweep
 * composing mail for someone who is not here. The two never share a string
 * because they never describe the same thing — the UI labels controls, this
 * writes sentences addressed to a person.
 *
 * Keys are flat and dotted. A missing key falls back to English and then to the
 * key itself, so a half-translated addition degrades to readable English rather
 * than to a blank line in someone's inbox.
 */

export const LANGUAGES = ["en", "th"] as const;
export type Lang = (typeof LANGUAGES)[number];

/**
 * The language to write to someone in when nothing else is known.
 *
 * Thai, per the product decision — and NOT the same as the web app's default,
 * which is English. The two answer different questions: the UI default is what
 * an anonymous browser gets before anyone has identified themselves, this is
 * what a known correspondent of this desk is addressed as.
 */
export const DEFAULT_LANG: Lang = "th";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

type Dict = Record<string, string>;

const en: Dict = {
  // --- common labels -------------------------------------------------------
  "label.ticket": "Ticket",
  "label.subject": "Subject",
  "label.status": "Status",
  "label.priority": "Priority",
  "label.category": "Category",
  "label.requester": "Requester",
  "label.assignee": "Assigned to",
  "label.unassigned": "Unassigned",
  "label.when": "Time",
  "label.viewTicket": "View the ticket",
  "label.latestMessage": "Latest message",
  "label.from": "From",

  // --- display statuses (never the stored value) ---------------------------
  "status.new": "New",
  "status.in_progress": "In Progress",
  "status.pending": "Waiting for your confirmation",
  "status.closed": "Closed",

  // --- priorities ----------------------------------------------------------
  "priority.low": "Low",
  "priority.medium": "Medium",
  "priority.high": "High",
  "priority.critical": "Critical",

  // --- body headlines (the SUBJECT LINE is not one of these) ---------------
  "headline.ticket.created": "We received your request",
  "headline.comment.public_reply": "The support desk replied",
  "headline.ticket.pending": "Your request is done — please confirm",
  "headline.ticket.auto_close_reminder": "Your request closes soon unless you reply",
  "headline.ticket.closed": "Your request is closed",
  "headline.ticket.assigned": "A ticket was assigned to you",
  "headline.comment.requester_replied": "The requester replied",
  "headline.ticket.closure_rejected": "The requester asked to reopen this",
  "headline.comment.internal_note": "New internal note",
  "headline.ticket.sla_warning": "Ticket approaching its SLA",
  "headline.ticket.sla_breach": "Ticket has breached its SLA",
  "headline.queue.ticket_unassigned": "New unassigned ticket in your queue",
  "headline.queue.requester_replied": "Requester replied on an unassigned ticket",
  "headline.digest.multiple_updates": "Several updates on this ticket",
  "headline.digest.bulk_assigned": "{count} tickets were assigned to you",

  // --- bodies --------------------------------------------------------------
  "body.greeting": "Hi {name},",
  "body.ticket.created":
    "We have received your request and opened ticket #{id}. Quote that number in any reply and it will reach the same ticket.",
  "body.comment.public_reply": "{author} replied to your request.",
  "body.ticket.pending":
    "The work on your request is finished. Please confirm that it is resolved, or ask us to reopen it if something is still wrong.",
  "body.ticket.pending.action":
    "Confirm it is resolved: {confirmUrl}\nAsk us to reopen it: {reopenUrl}",
  "body.ticket.auto_close_reminder":
    "We have not heard back about this request. It will close on its own in {hours} hours unless you reply.",
  "body.ticket.closed.byPerson": "This request was closed by {actor}.",
  "body.ticket.closed.automatic":
    "This request closed automatically because nobody replied within {hours} hours. Reply here if it needs reopening.",
  "body.ticket.assigned": "This ticket is now yours to work.",
  "body.comment.requester_replied": "{author} replied on this ticket.",
  "body.ticket.closure_rejected":
    "{author} rejected the closure and the ticket is back with you.",
  "body.comment.internal_note": "{author} added an internal note.",
  "body.ticket.sla_warning": "This ticket is due at {dueAt} and is approaching its SLA.",
  "body.ticket.sla_breach": "This ticket passed its SLA target at {dueAt}.",
  "body.queue.ticket_unassigned":
    "A new ticket arrived with nobody assigned to it. It is in your team's queue.",
  "body.queue.requester_replied":
    "The requester replied on a ticket that still has nobody assigned to it.",
  "body.digest.multiple_updates":
    "There have been {count} updates on this ticket in the last few minutes. Open the ticket to read them.",
  "body.digest.bulk_assigned":
    "{count} tickets were assigned to you. They are listed below.",

  // --- footer --------------------------------------------------------------
  "footer.why": "You are receiving this because you are a participant on this ticket.",
  "footer.replyHint": "Reply to this email and your message is added to the ticket.",
  "footer.internalWarning":
    "This note is internal to the support desk. Do not forward it to the requester.",
};

const th: Dict = {
  // --- common labels -------------------------------------------------------
  "label.ticket": "เลขที่",
  "label.subject": "เรื่อง",
  "label.status": "สถานะ",
  "label.priority": "ความสำคัญ",
  "label.category": "หมวดหมู่",
  "label.requester": "ผู้แจ้ง",
  "label.assignee": "ผู้ดูแล",
  "label.unassigned": "ยังไม่มีผู้ดูแล",
  "label.when": "เวลา",
  "label.viewTicket": "เปิดดูเรื่องนี้",
  "label.latestMessage": "ข้อความล่าสุด",
  "label.from": "จาก",

  // --- display statuses ----------------------------------------------------
  "status.new": "ใหม่",
  "status.in_progress": "กำลังดำเนินการ",
  "status.pending": "รอยืนยันการปิด",
  "status.closed": "ปิดแล้ว",

  // --- priorities ----------------------------------------------------------
  "priority.low": "ต่ำ",
  "priority.medium": "ปานกลาง",
  "priority.high": "สูง",
  "priority.critical": "วิกฤต",

  // --- body headlines ------------------------------------------------------
  "headline.ticket.created": "รับเรื่องของคุณแล้ว",
  "headline.comment.public_reply": "ทีมผู้ดูแลตอบกลับแล้ว",
  "headline.ticket.pending": "งานเสร็จแล้ว รอคุณยืนยัน",
  "headline.ticket.auto_close_reminder": "เรื่องนี้กำลังจะปิดอัตโนมัติ",
  "headline.ticket.closed": "เรื่องของคุณถูกปิดแล้ว",
  "headline.ticket.assigned": "คุณได้รับมอบหมายเรื่องนี้",
  "headline.comment.requester_replied": "ผู้แจ้งตอบกลับ",
  "headline.ticket.closure_rejected": "ผู้แจ้งขอเปิดเรื่องนี้ใหม่",
  "headline.comment.internal_note": "มีบันทึกภายในใหม่",
  "headline.ticket.sla_warning": "เรื่องนี้ใกล้ครบกำหนด SLA",
  "headline.ticket.sla_breach": "เรื่องนี้เกินกำหนด SLA แล้ว",
  "headline.queue.ticket_unassigned": "มีเรื่องใหม่เข้าคิว ยังไม่มีผู้ดูแล",
  "headline.queue.requester_replied": "ผู้แจ้งตอบในเรื่องที่ยังไม่มีผู้ดูแล",
  "headline.digest.multiple_updates": "มีความเคลื่อนไหวหลายรายการ",
  "headline.digest.bulk_assigned": "คุณได้รับมอบหมาย {count} เรื่อง",

  // --- bodies --------------------------------------------------------------
  "body.greeting": "เรียน คุณ{name}",
  "body.ticket.created":
    "เราได้รับเรื่องของคุณแล้ว และเปิดเป็นเลขที่ #{id} หากตอบกลับอีเมลนี้ ข้อความจะเข้าเรื่องเดิมโดยอัตโนมัติ",
  "body.comment.public_reply": "{author} ตอบกลับเรื่องของคุณ",
  "body.ticket.pending":
    "ทีมผู้ดูแลทำงานในเรื่องนี้เสร็จแล้ว รบกวนยืนยันว่าเรียบร้อย หรือแจ้งกลับหากยังมีปัญหาอยู่",
  "body.ticket.pending.action":
    "ยืนยันว่าเรียบร้อยแล้ว: {confirmUrl}\nแจ้งว่ายังไม่เรียบร้อย: {reopenUrl}",
  "body.ticket.auto_close_reminder":
    "เรื่องนี้ยังไม่ได้รับการยืนยันจากคุณ หากไม่มีการตอบกลับ ระบบจะปิดเรื่องอัตโนมัติภายใน {hours} ชั่วโมง",
  "body.ticket.closed.byPerson": "เรื่องนี้ถูกปิดโดย {actor}",
  "body.ticket.closed.automatic":
    "เรื่องนี้ถูกปิดอัตโนมัติ เนื่องจากไม่มีการตอบกลับภายใน {hours} ชั่วโมง หากต้องการเปิดใหม่ ตอบกลับอีเมลนี้ได้เลย",
  "body.ticket.assigned": "เรื่องนี้ถูกมอบหมายให้คุณดูแล",
  "body.comment.requester_replied": "{author} ตอบกลับในเรื่องนี้",
  "body.ticket.closure_rejected": "{author} ไม่ยืนยันการปิด เรื่องนี้กลับมาที่คุณแล้ว",
  "body.comment.internal_note": "{author} เพิ่มบันทึกภายใน",
  "body.ticket.sla_warning": "เรื่องนี้ครบกำหนด {dueAt} และกำลังใกล้ครบ SLA",
  "body.ticket.sla_breach": "เรื่องนี้เกินกำหนด SLA ตั้งแต่ {dueAt}",
  "body.queue.ticket_unassigned":
    "มีเรื่องใหม่เข้ามาโดยยังไม่มีผู้ดูแล ขณะนี้อยู่ในคิวของทีมคุณ",
  "body.queue.requester_replied": "ผู้แจ้งตอบกลับในเรื่องที่ยังไม่มีผู้ดูแล",
  "body.digest.multiple_updates":
    "เรื่องนี้มีความเคลื่อนไหว {count} รายการในช่วงไม่กี่นาทีที่ผ่านมา เปิดดูรายละเอียดได้ที่ลิงก์ด้านล่าง",
  "body.digest.bulk_assigned": "คุณได้รับมอบหมาย {count} เรื่อง ตามรายการด้านล่าง",

  // --- footer --------------------------------------------------------------
  "footer.why": "คุณได้รับอีเมลนี้เพราะเกี่ยวข้องกับเรื่องนี้",
  "footer.replyHint": "ตอบกลับอีเมลนี้เพื่อเพิ่มข้อความเข้าเรื่องได้เลย",
  "footer.internalWarning":
    "บันทึกนี้เป็นข้อมูลภายในของทีมผู้ดูแล ห้ามส่งต่อให้ผู้แจ้ง",
};

const dictionaries: Record<Lang, Dict> = { en, th };

/**
 * Look up `key` in `lang` and fill `{placeholders}` from `params`.
 *
 * A placeholder with no matching param is left as written rather than blanked:
 * `{dueAt}` in the output is a visible bug report, an empty gap is a silent one.
 */
export function t(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Every key that is in English but missing a translation — used by the tests. */
export function missingKeys(lang: Lang): string[] {
  return Object.keys(en).filter((k) => !(k in dictionaries[lang]));
}
