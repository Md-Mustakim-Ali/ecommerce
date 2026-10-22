/**
 * The storage port.
 *
 * Same shape as the payment provider: everything in the app depends on this
 * interface, so putting images on S3 or R2 later is a new adapter plus one
 * branch in index.ts — not a change to the editor, the schema or the
 * storefront.
 *
 * The interface is deliberately narrow. Presigned uploads, CDN invalidation
 * and image transforms are all things a real provider does differently, and
 * inventing a lowest-common-denominator API for them now would guarantee the
 * wrong abstraction.
 */

export type StoredObject = {
  /** The URL the storefront renders. Public. */
  url: string;
  /** Provider-specific handle, needed to delete it later. */
  key: string;
  width: number | null;
  height: number | null;
  /** Base64 LQIP, so the layout does not shift when the image loads. */
  blurDataUrl: string | null;
};

export type UploadInput = {
  /** Namespaces the object. Used as a path prefix or key prefix. */
  scope: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export interface StorageProvider {
  readonly name: string;
  /**
   * True when the provider serves from the app's own origin.
   *
   * next.config.ts has to allowlist a remote host before <Image> will load
   * from it, so the UI needs to know whether a URL will actually render.
   */
  readonly servesLocally: boolean;

  upload(input: UploadInput): Promise<StoredObject>;
  remove(key: string): Promise<void>;
}

/** What the platform will accept. Enforced server-side, not by the file picker. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function isAcceptedImageType(value: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value);
}
