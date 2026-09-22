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
