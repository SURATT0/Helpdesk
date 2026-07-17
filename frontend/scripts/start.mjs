// Run the Next.js standalone production server locally.
// `output: "standalone"` emits a self-contained server but does NOT include the
// static assets (or public/) — the Docker image copies them in, and so must a
// local run. This copies them next to the standalone server, then starts it
// (matching the container's `node server.js` with cwd = the standalone dir).
import { cpSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}

cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
}

const result = spawnSync(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
