import { describe, it, expect } from "vitest";
import { makeTranslator } from "./intake-i18n.js";

describe("makeTranslator", () => {
  it("returns Thai text by default", () => {
    const t = makeTranslator("th");
    expect(t("submit.button")).toBe("ส่งเรื่อง");
  });

  it("returns English text when lang is en", () => {
    const t = makeTranslator("en");
    expect(t("submit.button")).toBe("Submit");
  });

  it("substitutes placeholders", () => {
    const t = makeTranslator("en");
    expect(t("field.message.count", { n: 12, max: 2000 })).toBe("12 / 2000");
  });

  it("substitutes the same placeholder appearing more than once", () => {
    const t = makeTranslator("en");
    const text = t("err.file.too_large", { name: "photo.png" });
    expect(text).toBe("photo.png — file is over 10 MB");
  });

  it("falls back to the key itself for an unknown key, so a typo is visible rather than blank", () => {
    const t = makeTranslator("en");
    expect(t("not.a.real.key")).toBe("not.a.real.key");
  });

  it("falls back to Thai for an unrecognized language code", () => {
    const t = makeTranslator("fr");
    expect(t("submit.button")).toBe("ส่งเรื่อง");
  });
});
