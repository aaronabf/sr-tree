import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `pg` is a Node-only package; keep it out of the client bundle.
  serverExternalPackages: ["pg"],
}

export default nextConfig
