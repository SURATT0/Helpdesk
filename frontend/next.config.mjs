/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // self-contained server bundle for the Docker runtime
};

export default nextConfig;
