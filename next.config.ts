import type { NextConfig } from "next";

// 31 days, in seconds. Garden photos are effectively immutable once uploaded,
// so cache optimized transforms for a month to cut repeat transformations and
// cache writes.
const ONE_MONTH_IN_SECONDS = 2678400;

const nextConfig: NextConfig = {
  images: {
    // Every optimized image is served from Supabase public storage. Keep the
    // remote allowlist tight so only these images are ever transformed.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Nothing local is run through next/image (public/ holds only SVGs, which we
    // never optimize), so disallow local optimization entirely.
    localPatterns: [],
    // A single output format keeps us to one transformation per source/size
    // rather than one per format.
    formats: ["image/webp"],
    // Photos don't change, so hold transforms for a month to reduce cache writes
    // and re-transformations.
    minimumCacheTTL: ONE_MONTH_IN_SECONDS,
    // Only the default quality (75) is ever requested; lock the allowlist to it
    // so no extra qualities can be transformed.
    qualities: [75],
    // Every rendered image is a small fixed-size thumbnail (<=220px intrinsic,
    // ~440px at 2x); the full-size lightbox uses a plain <img> and isn't
    // optimized. Trim the size ladders to what we actually request.
    imageSizes: [64, 128, 256, 384, 512],
    deviceSizes: [640, 828, 1080, 1920],
  },
};

export default nextConfig;
