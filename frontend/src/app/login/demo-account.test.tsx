import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

/**
 * Whether the login screen offers a demo account at all.
 *
 * The password behind that button used to be the literal `password123`, written
 * into the page. It stopped being true the day the seed started taking its
 * password from `SEED_PASSWORD` and generating one when that is unset — from
 * then on, any deployment that had not set that exact value shipped a
 * one-click sign-in that could not work and a line of copy naming a password
 * that was not the password.
 *
 * So the pair now comes from the environment, and the case worth pinning is the
 * one every real deployment is in: NOTHING configured. The button and the hint
 * must both be gone, rather than falling back to a literal that was only ever
 * right for the demo seed.
 *
 * `NEXT_PUBLIC_*` is read at module scope and inlined by the bundler, so each
 * case has to set the variables and then import the page fresh —
 * `vi.resetModules()` plus a dynamic import, not a top-level one.
 */

const h = vi.hoisted(() => ({ login: vi.fn(), bootstrap: vi.fn() }));

/*
 * The auth context is mocked away rather than wrapped around the page.
 *
 * `vi.resetModules()` gives each case a fresh copy of the page module — that is
 * the only way to re-read a `NEXT_PUBLIC_*` that the module reads at import
 * time — and a provider rendered from a module graph that was NOT reset hands
 * its value to a different copy of the context than the fresh page reads from,
 * so the page throws "useAuth must be used within AuthProvider". Mocking the
 * hook sidesteps the problem entirely, and nothing here is about auth wiring.
 */
vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({ login: h.login, status: "unauthenticated" }),
}));

/*
 * `t` returns the key, with any interpolated values appended.
 *
 * Enough to assert both things this file cares about — that the demo button is
 * or is not rendered, and that the hint quotes the password it was CONFIGURED
 * with — without pinning the English copy, which is not what is under test and
 * would make this file fail on a wording change.
 */
vi.mock("@/features/i18n/context", () => ({
  useI18n: () => ({
    lang: "en",
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key} ${Object.values(vars).join(" ")}` : key,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

async function renderLogin() {
  vi.resetModules();
  const { default: LoginPage } = await import("./page");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

const ENV_KEYS = [
  "NEXT_PUBLIC_DEMO_EMAIL",
  "NEXT_PUBLIC_DEMO_PASSWORD",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  h.bootstrap.mockResolvedValue(null);
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the demo account on the login screen", () => {
  it("is not offered when nothing is configured", async () => {
    await renderLogin();
    expect(
      screen.queryByRole("button", { name: /demo/i }),
    ).not.toBeInTheDocument();
  });

  it("names no password when nothing is configured", async () => {
    // The sharper half: a hint printing a password nobody set is worse than no
    // hint, because somebody will type it.
    await renderLogin();
    expect(screen.queryByText(/password123/)).not.toBeInTheDocument();
  });

  it("stays away when only one of the pair is set", async () => {
    // Half-configured is a mistake, not a mode. Signing in needs both, so
    // offering the button on one would produce a click that cannot work.
    process.env.NEXT_PUBLIC_DEMO_EMAIL = "demo@example.com";
    await renderLogin();
    expect(
      screen.queryByRole("button", { name: /demo/i }),
    ).not.toBeInTheDocument();
  });

  it("appears, with that password, when both are set", async () => {
    process.env.NEXT_PUBLIC_DEMO_EMAIL = "demo@example.com";
    process.env.NEXT_PUBLIC_DEMO_PASSWORD = "not-the-old-literal";
    await renderLogin();
    expect(
      screen.getByRole("button", { name: /demo/i }),
    ).toBeInTheDocument();
    // The hint quotes what was configured — not a constant that happens to
    // agree with it today.
    expect(screen.getByText(/not-the-old-literal/)).toBeInTheDocument();
  });
});
