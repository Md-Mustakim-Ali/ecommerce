import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { slugify } from "@/lib/catalog/normalize";
import type { StorageProvider, StoredObject, UploadInput } from "./provider";

/**
 * Cloudflare R2.
 *
 * The production adapter. Same contract as the local one — the image editor,
 * the schema and the storefront are unchanged — but the bytes go to a bucket
 * instead of a disk that does not survive a redeploy.
 *
 * ── Why R2 rather than S3 or the host's own storage ──────────────────────
 *
 * Egress. R2 charges nothing to serve a file, and on this deployment that is
 * not a cost optimisation, it is what makes the free tier survivable at all:
 * Netlify's free plan meters bandwidth out of a 300-credit monthly budget and
 * pauses *every* project on the account when it runs out. Product photography
 * is the overwhelming majority of an online shop's bytes, so serving it from
 * R2 rather than through the app means the budget is spent on HTML and
 * JavaScript instead of on JPEGs.
 *
 * ── The processing is identical to local.ts on purpose ───────────────────
 *
 * Re-encoding, EXIF stripping, the dimension cap and the LQIP all happen the
 * same way in both adapters. That is duplication, and it is the right kind:
 * the alternative is a shared helper that both call, which sounds tidier until
 * the day a provider needs to do it differently — presigned direct-to-bucket
 * uploads, say, where the server never sees the bytes at all. The port exists
 * precisely so adapters can diverge.
 */
export class R2StorageProvider implements StorageProvider {
  readonly name = "r2";
  /** Served from the bucket's own host, so next.config.ts must allowlist it. */
  readonly servesLocally = false;

  private readonly client: S3Client;

  constructor(
    private readonly config: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      /** Public base URL: an r2.dev domain or a custom one. No trailing slash. */
      publicUrl: string;
    },
  ) {
    this.client = new S3Client({
      // R2 is S3-compatible but single-region. "auto" is what Cloudflare
      // documents; a real AWS region name here is silently accepted and then
      // signs requests wrong.
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    const image = sharp(Buffer.from(input.bytes), { failOn: "error" });

    // Reading the metadata is also the validation: a file that claims to be a
    // PNG in its content-type but is not an image at all fails here rather
    // than being served to shoppers as a broken <img>.
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("That file is not an image we can read.");
    }

    // Re-encoded rather than stored as uploaded. It strips EXIF — which
    // routinely carries the GPS coordinates of wherever the photo was taken —
    // normalises orientation, and caps the dimensions so one 40-megapixel
    // phone photo does not become the page weight.
    const normalised = await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const base =
      slugify(path.parse(input.filename).name).slice(0, 48) || "image";
    const key = `${input.scope}/${base}-${randomUUID().slice(0, 8)}.webp`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: normalised.data,
        // Always webp, because that is what we just encoded — never the
        // content-type the browser claimed, which is attacker-controlled and
        // would let an uploader have their file served as text/html.
        ContentType: "image/webp",
        // A year, immutable. Safe because the key carries a random suffix, so
        // an edited image is a new object rather than a replaced one and there
        // is nothing to invalidate.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    // A 16px-wide encode is enough to hold the average colour and rough shape.
    // Inlined as a data URL because a second network request for a placeholder
    // defeats the purpose of having one.
    const blur = await sharp(normalised.data)
      .resize(16, 16, { fit: "inside" })
      .webp({ quality: 40 })
      .toBuffer();

    return {
      url: `${this.config.publicUrl}/${key}`,
      key,
      width: normalised.info.width,
      height: normalised.info.height,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    };
  }

  async remove(key: string): Promise<void> {
    // No path traversal guard needed here, unlike the local adapter: a key is
    // an opaque object name in a bucket, not a filesystem path, so "../" in it
    // addresses an object literally called that rather than escaping anywhere.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    // S3 delete is idempotent and does not 404 on a missing key, so "already
    // gone" needs no special handling the way unlink() did.
  }
}
