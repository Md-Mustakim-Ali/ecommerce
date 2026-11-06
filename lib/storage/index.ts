import { env } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";
import { R2StorageProvider } from "./r2";

/**
 * The single place a concrete storage provider is chosen.
 *
 * R2 when it is configured, local disk otherwise. The fallback is what keeps a
 * fresh clone working with no accounts anywhere — but it is a development
 * convenience only, and on a serverless host it is actively wrong: the
 * filesystem is per-instance and does not survive a redeploy, so an image
 * uploaded through one Lambda is a 404 on the next.
 *
 * The decision is made once, here. Nothing that reads or writes an image knows
 * which one it got.
 */
let cached: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (cached) return cached;

  // All five or none. A half-configured bucket would otherwise fail at the
  // moment a seller uploads a photo rather than at boot, and the error there
  // is an opaque signing failure rather than "you forgot R2_BUCKET".
  if (
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    env.R2_PUBLIC_URL
  ) {
    cached = new R2StorageProvider({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      // Trailing slashes are the classic way to end up with a double slash in
      // every image URL, which some CDNs treat as a different object.
      publicUrl: env.R2_PUBLIC_URL.replace(/\/+$/, ""),
    });
    return cached;
  }

  cached = new LocalStorageProvider();
  return cached;
}

export {
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  type StorageProvider,
  type StoredObject,
} from "./provider";
