import { describe, it, expect, afterEach, vi } from "vitest";

// `env` is captured from process.env at module load, so each scenario sets the
// vars, resets the module registry, and re-imports a fresh copy before calling
// validateEnv. A 32-char+ non-default secret used by the "happy" prod cases.
const STRONG_A = "prod-access-secret-0123456789abcdef0123";
const STRONG_B = "prod-refresh-secret-0123456789abcdef0123";

async function runValidate(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("./env");
  return mod.validateEnv();
}

const BASE_PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: STRONG_A,
  JWT_REFRESH_SECRET: STRONG_B,
  COOKIE_SECURE: "true",
};

describe("validateEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("passes in development even with default secrets", async () => {
    await expect(
      runValidate({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        JWT_ACCESS_SECRET: undefined,
        JWT_REFRESH_SECRET: undefined,
        COOKIE_SECURE: undefined,
      }),
    ).resolves.toEqual({ warnings: [] });
  });

  it("passes in production with strong, distinct, explicit secrets", async () => {
    await expect(runValidate(BASE_PROD)).resolves.toEqual({ warnings: [] });
  });

  it("throws when DATABASE_URL is missing", async () => {
    // Empty (not deleted) so dotenv.config() won't repopulate it from .env.
    await expect(
      runValidate({ ...BASE_PROD, DATABASE_URL: "" }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("rejects a known dev-default secret in production", async () => {
    await expect(
      runValidate({ ...BASE_PROD, JWT_ACCESS_SECRET: "dev-access-secret-change-me" }),
    ).rejects.toThrow(/JWT_ACCESS_SECRET .* dev default/);
  });

  it("rejects a too-short secret in production", async () => {
    await expect(
      runValidate({ ...BASE_PROD, JWT_REFRESH_SECRET: "short-refresh" }),
    ).rejects.toThrow(/at least 32 characters/);
  });

  it("rejects identical access and refresh secrets", async () => {
    await expect(
      runValidate({ ...BASE_PROD, JWT_REFRESH_SECRET: STRONG_A }),
    ).rejects.toThrow(/must be different/);
  });

  it("warns (non-fatal) when COOKIE_SECURE is false in production", async () => {
    const { warnings } = await runValidate({ ...BASE_PROD, COOKIE_SECURE: "false" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/COOKIE_SECURE/);
  });
});

/**
 * WEB_ORIGIN answers two questions that are easy to conflate: where may a
 * browser load the app FROM (a list), and which address do we WRITE INTO links
 * we send people (exactly one). Getting the second wrong is the quiet failure —
 * a link built from a phone's LAN address is dead the moment the mail leaves the
 * building — so the split is pinned here.
 */
async function loadEnv(webOrigin: string | undefined) {
  vi.resetModules();
  if (webOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = webOrigin;
  return (await import("./env")).env;
}

describe("WEB_ORIGIN", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to localhost for both the canonical address and the allow-list", async () => {
    const env = await loadEnv(undefined);
    expect(env.webOrigin).toBe("http://localhost:3000");
    expect(env.corsOrigins).toEqual(["http://localhost:3000"]);
  });

  it("allows every listed origin", async () => {
    const env = await loadEnv(
      "http://localhost:3000,http://192.168.1.20:3000,https://desk.example.com",
    );
    expect(env.corsOrigins).toEqual([
      "http://localhost:3000",
      "http://192.168.1.20:3000",
      "https://desk.example.com",
    ]);
  });

  it("writes links with the FIRST one, not whichever a request came from", async () => {
    const env = await loadEnv("https://desk.example.com,http://192.168.1.20:3000");
    expect(env.webOrigin).toBe("https://desk.example.com");
  });

  it("tolerates the spacing people actually type", async () => {
    const env = await loadEnv(" http://localhost:3000 , http://192.168.1.20:3000 ");
    expect(env.webOrigin).toBe("http://localhost:3000");
    expect(env.corsOrigins).toEqual([
      "http://localhost:3000",
      "http://192.168.1.20:3000",
    ]);
  });

  it("drops a trailing comma rather than allowing an empty origin", async () => {
    const env = await loadEnv("http://localhost:3000,");
    expect(env.corsOrigins).toEqual(["http://localhost:3000"]);
  });
});
