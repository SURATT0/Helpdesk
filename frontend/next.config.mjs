/**
 * The address of the API, as the WEB SERVER reaches it — a server-to-server hop
 * inside the same host or compose network, never something a browser sees. The
 * browser now calls `/api/v1` on whatever origin it loaded the app from, and the
 * rewrite below forwards that to here, so one address (a tunnel, a LAN IP,
 * localhost) serves the whole app and nothing about the API URL depends on how
 * the app was reached.
 *
 * Read at build time, not at runtime: Next writes the rewrite destination into
 * routes-manifest.json during `next build`. That is fine for this value — it
 * describes the topology (in compose, always `http://api:4000`), not the way in.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // self-contained server bundle for the Docker runtime

  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
