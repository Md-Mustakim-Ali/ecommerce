/**
 * Moves images already on local disk into R2, and rewrites the rows that point
 * at them.
 *
 * Without this, deploying to a serverless host leaves every existing product
 * photo as a 404: the URLs in the database are `/uploads/...`, which was served
 * from a filesystem that no longer exists.
 *
 * Safe to re-run. It only touches rows whose URL still starts with `/uploads/`,
 * so a second run after a partial failure picks up exactly what is left.
 *
 *   pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.ts
 *   pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.ts --dry-run
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { productImages } from "@/lib/db/schema";

const dryRun = process.argv.includes("--dry-run");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See docs/deploy.md.`);
  return value;
}

const bucket = required("R2_BUCKET");
const publicUrl = required("R2_PUBLIC_URL").replace(/\/+$/, "");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

const root = path.join(process.cwd(), "public", "uploads");

const rows = await db
  .select({ id: productImages.id, url: productImages.url })
  .from(productImages)
  .where(like(productImages.url, "/uploads/%"));

console.log(
  `${rows.length} image(s) still on local disk${dryRun ? " (dry run)" : ""}\n`,
);

let moved = 0;
let missing = 0;

for (const row of rows) {
  // "/uploads/products/foo-1a2b.webp" -> "products/foo-1a2b.webp"
  const key = row.url.replace(/^\/uploads\//, "");
  const source = path.resolve(root, key);

  // The same containment check the local adapter uses on delete. A crafted URL
  // in the database should not be able to read /etc/passwd and publish it to a
  // public bucket.
  if (!source.startsWith(path.resolve(root) + path.sep)) {
    console.error(`  ! ${row.url} resolves outside public/uploads — skipped`);
    continue;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch {
    // Seeded rows often point at remote placeholders that were never on disk.
    console.warn(`  - ${key} not found on disk, leaving the row alone`);
    missing++;
    continue;
  }

  if (dryRun) {
    console.log(
      `  would upload ${key} (${(bytes.length / 1024).toFixed(0)}kB)`,
    );
    moved++;
    continue;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      // Everything the local adapter wrote was already re-encoded to WebP.
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  // Row updated only after the upload succeeds, so a crash mid-run leaves the
  // row pointing at the file that still works rather than at one that does not
  // exist yet.
  await db
    .update(productImages)
    .set({ url: `${publicUrl}/${key}` })
    .where(eq(productImages.id, row.id));

  console.log(`  ✓ ${key}`);
  moved++;
}

console.log(
  `\n${dryRun ? "Would move" : "Moved"} ${moved}, skipped ${missing} not on disk.`,
);
process.exit(0);
