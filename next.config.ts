import type { NextConfig } from "next";

/**
 * The bucket images are served from, taken from the same env var the storage
 * adapter uses so the allowlist cannot drift from where uploads actually land.
 *
 * Parsed rather than pattern-matched: a malformed R2_PUBLIC_URL should fail
 * the build here, not present as every product photo silently missing.
 */
function bucketHost(): string | null {
  const raw = process.env.R2_PUBLIC_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    throw new Error(
      `R2_PUBLIC_URL is not a valid URL: ${raw}\n` +
        `Expected something like https://pub-xxxx.r2.dev or https://img.yourdomain.com`,
    );
  }
}

const host = bucketHost();

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    /*
      Unoptimised on purpose, and it is a cost decision rather than a quality
      one.

      Next's optimizer runs as a serverless function on every distinct image
      URL and size. On Netlify's free plan that compute is metered out of the
      same 300-credit monthly budget as everything else, and when the budget is
      gone every project on the account pauses until the next cycle — with no
      way to buy your way out.

      The images do not need it. lib/storage/r2.ts already re-encodes every
      upload to WebP, caps it at 2400px, strips EXIF and generates the blur
      placeholder, and R2 serves the result through Cloudflare's CDN with an
      immutable one-year cache and zero egress charges. Running a second
      optimiser over an already-optimised WebP would spend credits to save
      almost nothing.
    */
    unoptimized: true,
    remotePatterns: [
      // Seed placeholder imagery. Safe to drop once real uploads replace it —
      // this list is an allowlist, and leaving a third-party host in it lets
      // anyone proxy images through the site.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      // YouTube poster frames for video embeds. Narrow on purpose: this host
      // only ever serves thumbnails keyed by video id, so allowing it does not
      // turn the site into an open image proxy the way a broad Google host
      // would.
      //
      // No Google Drive host appears here, and that is deliberate. Drive is
      // not a CDN: the uc?export=view and lh3.googleusercontent.com tricks are
      // undocumented, rate-limit on anything popular, and Google has broken
      // them repeatedly. Allowing lh3 would also make this site an open proxy
      // for any Google-hosted image. Drive-backed media is served from our own
      // origin instead — see app/api/media/[mediaId] — which keeps the bytes
      // in the seller's Drive, where the whole point was to put them.
      { protocol: "https", hostname: "i.ytimg.com" },
      ...(host ? [{ protocol: "https" as const, hostname: host }] : []),
    ],
  },
};

export default nextConfig;
