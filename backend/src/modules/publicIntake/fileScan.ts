import net from "node:net";
import { env } from "../../config/env";

export type ScanVerdict = "clean" | "infected" | "error";

export type ScanResult = {
  verdict: ScanVerdict;
  /** clamd's own reply line, or a description of what went wrong. Logged, never shown to the sender. */
  detail: string;
};

/**
 * Speaks clamd's own line protocol (INSTREAM) directly over a TCP socket,
 * rather than a client package — the same call attachment.sniff.ts already
 * makes for magic-byte detection ("hand-rolled rather than a dependency").
 * INSTREAM is four documented steps: send `zINSTREAM\0`, send the payload as
 * `<4-byte big-endian length><chunk>` pairs, send a zero-length chunk to end
 * the stream, read one reply line back.
 *
 * Never rejects. An unreachable daemon, a timeout, or any other transport
 * failure resolves as `{ verdict: "error" }` — the design doc's own rule
 * (§08.3: "error → stays pending, retried") is that a scanning outage must not
 * turn into a rejected upload; it turns into a file that just is not usable
 * yet. See intake-attachments.ts, which is the only thing that decides what an
 * "error" verdict means for the row.
 */
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const { host, port, timeoutMs } = env.publicIntake.clamav;
  if (!host) {
    return { verdict: "error", detail: "CLAMAV_HOST not configured" };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection({ host, port });
    const timer = setTimeout(
      () => finish({ verdict: "error", detail: `clamd timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );

    let reply = "";

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const CHUNK_SIZE = 8192;
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      // Zero-length chunk — the protocol's own end-of-stream marker.
      socket.write(Buffer.alloc(4));
    });

    socket.on("data", (data) => {
      reply += data.toString("utf8");
    });

    socket.on("error", (err) => {
      finish({ verdict: "error", detail: err.message });
    });

    socket.on("close", () => {
      // clamd's `z`-prefixed commands (zINSTREAM here) are NUL-terminated on
      // BOTH ends of the wire — the reply carries a trailing "\0" that
      // `.trim()` does not touch (NUL is not whitespace), so "stream: OK\0"
      // failed an `/OK$/` match and every clean scan misread as "error"
      // until this was verified against a real clamd instance rather than
      // just the timeout/unreachable paths, which never hit this line at all.
      const line = reply.replace(/\u0000/g, "").trim();
      if (/FOUND$/.test(line)) {
        finish({ verdict: "infected", detail: line });
      } else if (/OK$/.test(line)) {
        finish({ verdict: "clean", detail: line });
      } else {
        finish({ verdict: "error", detail: line || "no reply from clamd" });
      }
    });
  });
}
