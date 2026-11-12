import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents left off: every page here is per-user, nothing to
  // prerender, and auth redirects stay normal HTTP redirects
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
