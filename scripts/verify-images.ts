/**
 * Exercises the storage adapter directly.
 *
 * The server action needs a session, so this checks the part that has no such
 * dependency: that an upload is re-encoded, stripped, capped and given a blur
 * placeholder, and that delete cannot be walked out of the upload directory.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { storageProvider } from "../lib/storage/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function main() {
  const storage = storageProvider();
  console.log(`provider: ${storage.name}\n--- upload ---`);

  // Generated rather than read from a fixture, so the script is self-contained
  // and leaves nothing behind to be committed by accident.
  const original = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#1b2a4a" },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const stored = await storage.upload({
    scope: "products/verify",
    filename: "Test Photo (1).JPG",
    contentType: "image/jpeg",
    bytes: new Uint8Array(original),
  });

  check("returns a public url", stored.url.startsWith("/uploads/"), stored.url);
  check(
    "slugifies the filename",
    /test-photo-1-[0-9a-f]{8}\.webp$/.test(stored.url),
    stored.url,
  );
  check(
    "reports dimensions",
    stored.width === 1200 && stored.height === 1200,
    `${stored.width}x${stored.height}`,
  );
  check(
    "generates a blur placeholder",
    (stored.blurDataUrl ?? "").startsWith("data:image/webp;base64,"),
    `${stored.blurDataUrl?.length ?? 0} chars`,
  );
  check(
    "the placeholder is small enough to inline",
    (stored.blurDataUrl?.length ?? 0) < 2000,
  );

  const onDisk = path.join(
    process.cwd(),
    "public",
    stored.url.replace(/^\//, ""),
  );
  const info = await stat(onDisk);
  const written = await sharp(onDisk).metadata();

  check("the file exists on disk", info.size > 0, `${info.size} bytes`);
  check("re-encoded to webp", written.format === "webp", written.format ?? "?");
  check(
    "EXIF is stripped",
    written.exif === undefined,
    written.exif ? "STILL PRESENT" : "none",
  );

  // A photo larger than the cap must come back scaled down.
  const huge = await sharp({
    create: { width: 5000, height: 3000, channels: 3, background: "#333" },
  })
    .jpeg()
    .toBuffer();

  const capped = await storage.upload({
    scope: "products/verify",
    filename: "huge.jpg",
    contentType: "image/jpeg",
    bytes: new Uint8Array(huge),
  });
  check(
    "oversized images are capped",
    (capped.width ?? 0) <= 2400 && (capped.height ?? 0) <= 2400,
    `5000x3000 -> ${capped.width}x${capped.height}`,
  );
  check(
    "and keep their aspect ratio",
    Math.abs((capped.width ?? 1) / (capped.height ?? 1) - 5000 / 3000) < 0.01,
  );

  console.log("\n--- rejection ---");
  let rejected = false;
  try {
    await storage.upload({
      scope: "products/verify",
      filename: "notanimage.jpg",
      contentType: "image/jpeg",
      bytes: new TextEncoder().encode("this is definitely not an image"),
    });
  } catch {
    rejected = true;
  }
  check("a file that is not an image is refused", rejected);

  console.log("\n--- delete ---");
  let escaped = false;
  try {
    await storage.remove("../../../.env.local");
  } catch {
    escaped = true;
  }
  check("path traversal out of the upload directory is refused", escaped);

  const envStillThere = await stat(".env.local").then(
    () => true,
    () => false,
  );
  check("and .env.local is untouched", envStillThere);

  await storage.remove(stored.key);
  const gone = await stat(onDisk).then(
    () => false,
    () => true,
  );
  check("removing deletes the file", gone);

  // Deleting something already gone is the desired end state, not an error.
  let threwOnMissing = false;
  try {
    await storage.remove(stored.key);
  } catch {
    threwOnMissing = true;
  }
  check("removing a missing file is not an error", !threwOnMissing);

  await storage.remove(capped.key);

  console.log(
    failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
