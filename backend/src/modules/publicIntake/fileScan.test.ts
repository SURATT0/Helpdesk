import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { scanBuffer } from "./fileScan";

const original = { ...env.publicIntake.clamav };

afterEach(() => {
  Object.assign(env.publicIntake.clamav, original);
});

describe("scanBuffer — never rejects, an unreachable scanner is just \"error\"", () => {
  it("answers error without touching the network when CLAMAV_HOST is unset", async () => {
    env.publicIntake.clamav.host = undefined;
    const result = await scanBuffer(Buffer.from("anything"));
    expect(result.verdict).toBe("error");
    expect(result.detail).toMatch(/not configured/i);
  });

  it("answers error, not a thrown exception, when the daemon refuses the connection", async () => {
    env.publicIntake.clamav.host = "127.0.0.1";
    env.publicIntake.clamav.port = 1; // reserved, nothing listens here
    env.publicIntake.clamav.timeoutMs = 2000;
    const result = await scanBuffer(Buffer.from("anything"));
    expect(result.verdict).toBe("error");
  });
});

/**
 * A minimal stand-in for clamd that only speaks the one line this module
 * reads: a fixed reply, sent back the instant anything arrives, with the
 * SAME trailing NUL byte the real daemon sends on every `z`-prefixed
 * command's reply (confirmed against a real clamav/clamav container — see
 * docker-compose.yml's clamav service). Regression coverage for a real bug:
 * `reply.trim()` does not strip `\0` (it is not whitespace), so "stream:
 * OK\0" failed an `/OK$/` match and every clean scan misread as "error"
 * until this was caught by testing against the real daemon.
 */
function withFakeClamd(reply: string, run: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.end(Buffer.from(`${reply}\0`));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      env.publicIntake.clamav.host = "127.0.0.1";
      env.publicIntake.clamav.port = port;
      env.publicIntake.clamav.timeoutMs = 2000;
      run()
        .then(() => server.close(() => resolve()))
        .catch((err) => server.close(() => reject(err)));
    });
  });
}

describe("scanBuffer — parses a real, NUL-terminated clamd reply", () => {
  it("reads a NUL-terminated \"stream: OK\\0\" as clean, not error", () =>
    withFakeClamd("stream: OK", async () => {
      const result = await scanBuffer(Buffer.from("harmless"));
      expect(result).toEqual({ verdict: "clean", detail: "stream: OK" });
    }));

  it("reads a NUL-terminated FOUND reply as infected, not error", () =>
    withFakeClamd("stream: Eicar-Test-Signature FOUND", async () => {
      const result = await scanBuffer(Buffer.from("eicar-shaped"));
      expect(result).toEqual({
        verdict: "infected",
        detail: "stream: Eicar-Test-Signature FOUND",
      });
    }));
});
