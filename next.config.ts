import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.WEB_ADMIN_QA === "1" ? ".local/next-qa" : ".next",
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" }
    ] }];
  }
};

export default nextConfig;
