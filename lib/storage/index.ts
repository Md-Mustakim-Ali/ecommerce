import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";

/**
 * The single place a concrete storage provider is chosen.
 *
 * Local disk for now. An S3 or R2 adapter is a new file implementing
 * StorageProvider plus a branch here — nothing that reads or writes images
 * needs to change.
 */
let cached: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (cached) return cached;
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
