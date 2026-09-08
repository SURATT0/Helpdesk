import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `API_BASE_URL` is read once at module load (Next inlines the env var at build
 * time), so each case re-imports the module with a different environment.
 */
async function baseUrlWith(value: string | undefined) {
  vi.resetModules();
  const previous = process.env.NEXT_PUBLIC_API_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = value;
  try {
    return (await import("./api-client")).API_BASE_URL;
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = previous;
  }
}

afterEach(() => vi.resetModules());

describe("API_BASE_URL", () => {
  it("is same-origin by default, so one address serves the whole app", async () => {
    expect(await baseUrlWith(undefined)).toBe("/api/v1");
  });

  it("treats an empty value as unset", async () => {
    // A build arg that is declared but left empty (`${NEXT_PUBLIC_API_URL:-}` in
    // compose) inlines as "". `??` would take that as a deliberate choice and
    // point every call at the site root.
    expect(await baseUrlWith("")).toBe("/api/v1");
  });

  it("still honours an absolute URL, for an API on another host", async () => {
    expect(await baseUrlWith("https://api.example.com/api/v1")).toBe(
      "https://api.example.com/api/v1",
    );
  });
});
