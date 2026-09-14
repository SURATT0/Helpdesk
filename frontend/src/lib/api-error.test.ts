import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { API_ERROR_CODES, apiErrorMessage } from "./api-error";
import { dictionaries } from "@/features/i18n/dictionary";

/**
 * The API answers with a code; this side owns the sentence.
 *
 * What has to hold is the join between the two: every code the API can send has
 * a line in BOTH languages, and no route through `apiErrorMessage` can ever put
 * the API's English on a screen. The second one is the bug this whole mechanism
 * exists to prevent, so it is asserted directly rather than inferred from the
 * first.
 */

const { en, th } = dictionaries;

/** The `t` a component would pass in, for one language. */
const translate =
  (lang: "en" | "th") =>
  (key: string, params?: Record<string, string | number>) => {
    let s = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return s;
  };

describe("every code the API can send has a sentence", () => {
  it.each(API_ERROR_CODES)("%s is worded in both languages", (code) => {
    expect(en[`error.${code}`], `en error.${code}`).toBeTruthy();
    expect(th[`error.${code}`], `th error.${code}`).toBeTruthy();
  });

  it("words the Thai side in Thai, not in English", () => {
    // A copy-paste that leaves the English sentence in the th half passes the
    // parity test in dictionary.test.ts and fails the reader.
    const untranslated = API_ERROR_CODES.filter(
      (code) => th[`error.${code}`] === en[`error.${code}`],
    );
    expect(untranslated).toEqual([]);
  });
});

describe("the API's own words never reach a screen", () => {
  const ENGLISH_PROSE = "Ticket moved to pending while you were changing it";

  it("shows the reader's language, not the message on the error", () => {
    const err = new ApiError(409, "CONCURRENT_STATUS_CHANGE", ENGLISH_PROSE, {
      attemptedFrom: "new",
      to: "closed",
      actual: "pending",
    });
    const msg = apiErrorMessage(err, translate("th"), "status.updateError");
    expect(msg).not.toContain(ENGLISH_PROSE);
    expect(msg).toContain("pending"); // the value, interpolated into Thai
    expect(msg).toBe(th["error.CONCURRENT_STATUS_CHANGE"].replace("{actual}", "pending"));
  });

  it("falls back to the caller's own line for a code it does not know", () => {
    // A newer API, or a proxy inventing an error body. The action's own line
    // says less than the server's sentence and says it in the right language,
    // which is the trade this makes deliberately.
    const err = new ApiError(418, "SOME_FUTURE_CODE", "I am a teapot");
    const msg = apiErrorMessage(err, translate("th"), "kb.saveError");
    expect(msg).toBe(th["kb.saveError"]);
    expect(msg).not.toContain("teapot");
  });

  it("falls back the same way for something that is not an ApiError at all", () => {
    const msg = apiErrorMessage(new Error("boom"), translate("th"), "kb.saveError");
    expect(msg).toBe(th["kb.saveError"]);
  });

  it("never returns the raw key", () => {
    // `t` returns the key when an entry is missing, which on screen looks like
    // "error.NOT_AN_IMAGE" — worse than the English it replaced.
    for (const code of API_ERROR_CODES) {
      const err = new ApiError(400, code, "english");
      for (const lang of ["en", "th"] as const) {
        const msg = apiErrorMessage(err, translate(lang), "kb.saveError");
        expect(msg, `${lang} ${code}`).not.toBe(`error.${code}`);
      }
    }
  });
});

describe("values are interpolated, shapes are not", () => {
  it("puts a count into the sentence", () => {
    const err = new ApiError(409, "USER_HAS_OPEN_QUEUE", "english", { count: 4 });
    expect(apiErrorMessage(err, translate("th"), "handover.error")).toContain("4");
  });

  it("leaves an object out rather than rendering [object Object]", () => {
    // CONFLICT carries `details.fields`, an array. It is there for code to
    // branch on, and a textual substitution would paste "name" — or worse — into
    // the middle of a sentence that never asked for it.
    const err = new ApiError(409, "CONFLICT", "english", { fields: ["name"] });
    const msg = apiErrorMessage(err, translate("th"), "customers.createError");
    expect(msg).toBe(th["error.CONFLICT"]);
    expect(msg).not.toContain("object Object");
  });

  it("leaves an unfilled placeholder nowhere on screen", () => {
    // Every placeholder in an error sentence must be covered by the details the
    // API actually sends for that code — an "{count}" on screen is a broken
    // sentence, and it only shows up when that error fires in production.
    const SENT: Record<string, Record<string, string | number>> = {
      MISSING_PERMISSION: { permission: "ticket:import" },
      ILLEGAL_TRANSITION: { from: "closed", to: "pending" },
      CONCURRENT_STATUS_CHANGE: { attemptedFrom: "new", to: "closed", actual: "pending" },
      TICKET_NOT_AWAITING_ANSWER: { actual: "closed" },
      USER_HAS_OPEN_QUEUE: { count: 4 },
      PROJECT_HAS_MEMBERS: { count: 3 },
      CUSTOMER_NOT_EMPTY: { projects: 1, tickets: 2, users: 3 },
      UNSUPPORTED_FILE_TYPE: { mimetype: "image/heic" },
      SOURCE_NOT_CONFIGURED: { label: "Jira" },
    };
    for (const code of API_ERROR_CODES) {
      const err = new ApiError(400, code, "english", SENT[code]);
      for (const lang of ["en", "th"] as const) {
        const msg = apiErrorMessage(err, translate(lang), "kb.saveError");
        expect(msg, `${lang} ${code}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
