import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      // Seed placeholder imagery only. Replace with the S3/R2 bucket host when
      // real uploads land — this list is an allowlist, and leaving a
      // third-party host in it lets anyone proxy images through our optimizer.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
    ],
  },
};

export default nextConfig;
