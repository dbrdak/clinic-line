import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
  logging: { fetches: { fullUrl: false } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
        ],
      },
    ];
  },
};

export default config;
