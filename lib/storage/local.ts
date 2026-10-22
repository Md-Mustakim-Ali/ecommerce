import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { slugify } from "@/lib/catalog/normalize";
import type { StorageProvider, StoredObject, UploadInput } from "./provider";

/**
 * Local disk storage, for development.
 *
 * Writes under `public/uploads`, which Next serves statically. This is the
 * storage equivalent of the manual payment adapter: it makes the whole feature
 * exercisable end to end without an account anywhere, and it is deliberately
 * not what production should run.
 *
 * Why not production: a serverless or containerised deployment has an ephemeral
 * and per-instance filesystem, so an image uploaded by one instance is a 404 on
 * the next and gone entirely on redeploy. Swapping in an S3 or R2 adapter is
 * one new file and one branch in index.ts.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  readonly servesLocally = true;

  private readonly root = path.join(process.cwd(), "public", "uploads");

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
    const target = path.join(this.root, key);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, normalised.data);

    // A 16px-wide encode is enough to hold the average colour and rough shape.
    // Inlined as a data URL because a second network request for a placeholder
    // defeats the purpose of having one.
    const blur = await sharp(normalised.data)
      .resize(16, 16, { fit: "inside" })
      .webp({ quality: 40 })
      .toBuffer();

    return {
      url: `/uploads/${key}`,
      key,
      width: normalised.info.width,
      height: normalised.info.height,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    };
  }

  async remove(key: string): Promise<void> {
    // A key from the database, joined to a fixed root. Resolving it and
    // checking it is still inside that root is what stops `../../.env` from
    // being deletable through this method.
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error("Refusing to delete outside the upload directory.");
    }

    try {
      await unlink(target);
    } catch (error) {
      // Already gone is the desired end state, so it is not an error. Anything
      // else is.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
