import { parseGoogleFailure } from "../errors";
import { GoogleApiError } from "../failover";
import { googleFetch } from "./oauth";

/**
 * Google Drive, as the seller's own storage.
 *
 * The scope is drive.file — files this app created, nothing else. That is the
 * difference between a consent screen a shop owner will actually accept and
 * Google's restricted-scope security assessment, which costs weeks and money.
 * It also means a bug here cannot touch a seller's personal documents: they
 * are not visible to this token at all.
 *
 * Bytes stay in Drive. They are served through the app's own origin rather
 * than linked directly, because Drive is not a CDN — the undocumented
 * hotlinking tricks rate-limit on anything popular and Google has broken them
 * repeatedly. Mirroring into R2 would fix delivery but store everything twice
 * and put the storage cost straight back on the platform, which is the
 * opposite of why sellers connect Drive.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// ── Pure: storage quota ───────────────────────────────────────────────────

export type StorageQuota = {
  /** null when the account has no enforced limit (pooled or enterprise). */
  limitBytes: number | null;
  usageBytes: number;
};

export type AboutResponse = {
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
};

/**
 * Reads about.get into numbers.
 *
 * Google sends these as strings because 2 TB overflows a JSON number in some
 * clients. `limit` is absent — not zero — for accounts with unlimited pooled
 * storage, and reading that absence as zero would mark a perfectly good
 * account as permanently full.
 *
 * `usage` rather than `usageInDrive`: the 15 GB free tier is shared with Gmail
 * and Photos, so the Drive-only figure understates how full the account is and
 * uploads would start failing well before the picker expected them to.
 */
export function parseStorageQuota(response: AboutResponse): StorageQuota {
  const quota = response.storageQuota ?? {};

  const usage = Number(quota.usage ?? quota.usageInDrive ?? 0);
  const limit = quota.limit === undefined ? null : Number(quota.limit);

  return {
    limitBytes: limit !== null && Number.isFinite(limit) ? limit : null,
    usageBytes: Number.isFinite(usage) ? usage : 0,
  };
}

export async function fetchStorageQuota(
  accessToken: string,
): Promise<StorageQuota> {
  const body = (await googleFetch(`${API}/about?fields=storageQuota`, {
    accessToken,
    method: "GET",
  })) as AboutResponse;

  return parseStorageQuota(body);
}

// ── Pure: is the file still there? ────────────────────────────────────────

export type FileResponse = {
  id?: string;
  name?: string;
  size?: string;
  mimeType?: string;
  trashed?: boolean;
  imageMediaMetadata?: { width?: number; height?: number };
};

export type FileReadiness =
  | {
      state: "ready";
      sizeBytes: number | null;
      width: number | null;
      height: number | null;
    }
  | { state: "unavailable"; reason: string };

/**
 * Whether a Drive file is still usable.
 *
 * There is no transcoding step for an image, so this is really a liveness
 * check: the re-verification pass runs it against live products to catch the
 * case nobody plans for, where a seller tidies up their Drive months later and
 * silently breaks every listing the files were on.
 *
 * A trashed file still resolves through the API, which is why `trashed` has to
 * be asked about explicitly rather than inferred from a 404.
 */
export function evaluateFileReadiness(file: FileResponse): FileReadiness {
  if (file.trashed) {
    return {
      state: "unavailable",
      reason: "That file is in the Drive trash.",
    };
  }
  if (!file.id) {
    return { state: "unavailable", reason: "That file no longer exists." };
  }

  const size = file.size === undefined ? null : Number(file.size);
  const meta = file.imageMediaMetadata ?? {};

  return {
    state: "ready",
    sizeBytes: size !== null && Number.isFinite(size) ? size : null,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}

export async function fetchFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<FileReadiness> {
  const body = (await googleFetch(
    `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,trashed,imageMediaMetadata`,
    { accessToken, method: "GET" },
  )) as FileResponse;

  return evaluateFileReadiness(body);
}

// ── Upload ────────────────────────────────────────────────────────────────

/**
 * Multipart upload, for anything that fits comfortably in memory.
 *
 * Product photos are capped at 8 MB by lib/storage, so a single request is the
 * right shape — the resumable protocol's extra round trip buys nothing at that
 * size. Video does not come through here; it goes to YouTube.
 */
export async function uploadFile(input: {
  accessToken: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /** Drive folder id. Omitted means the account's root. */
  parentId?: string;
}): Promise<{ fileId: string }> {
  const boundary = `boundary${crypto.randomUUID().replace(/-/g, "")}`;

  const metadata = JSON.stringify({
    name: input.filename,
    ...(input.parentId ? { parents: [input.parentId] } : {}),
  });

  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      "content-type: application/json; charset=UTF-8\r\n\r\n" +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `content-type: ${input.contentType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(
    head.byteLength + input.bytes.byteLength + tail.byteLength,
  );
  body.set(head, 0);
  body.set(input.bytes, head.byteLength);
  body.set(tail, head.byteLength + input.bytes.byteLength);

  const response = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body: body as unknown as BodyInit,
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new GoogleApiError(
      parseGoogleFailure(response.status, safeJson(text), response.headers),
    );
  }

  const parsed = safeJson(text) as { id?: string } | null;
  if (!parsed?.id) {
    throw new GoogleApiError({
      status: response.status,
      message: "Drive accepted the upload but returned no file id.",
    });
  }

  return { fileId: parsed.id };
}

/**
 * Streams a file's bytes back.
 *
 * Returns the raw Response so the route handler can pipe it through without
 * buffering a whole image into the instance's memory — on a 512 MB box, a
 * handful of concurrent product-page loads doing that is an OOM restart.
 */
export async function downloadFile(
  accessToken: string,
  fileId: string,
): Promise<Response> {
  const response = await fetch(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new GoogleApiError(
      parseGoogleFailure(response.status, safeJson(text), response.headers),
    );
  }

  return response;
}

export async function deleteFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  await googleFetch(`${API}/files/${encodeURIComponent(fileId)}`, {
    accessToken,
    method: "DELETE",
  });
}

/**
 * Finds or creates the folder a store's uploads live in.
 *
 * Sellers open their own Drive and see these files. Dropping them loose in the
 * root looks like malware; one clearly named folder is the difference between
 * a seller trusting the integration and disconnecting it.
 */
export async function ensureStoreFolder(
  accessToken: string,
  storeName: string,
): Promise<string> {
  const name = `${storeName} — shop media`;

  // drive.file only sees files this app created, so this search cannot find
  // (or collide with) anything else in the seller's Drive.
  const query = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );

  const found = (await googleFetch(
    `${API}/files?q=${query}&fields=files(id)&pageSize=1`,
    { accessToken, method: "GET" },
  )) as { files?: { id?: string }[] };

  const existing = found.files?.[0]?.id;
  if (existing) return existing;

  const created = (await googleFetch(`${API}/files?fields=id`, {
    accessToken,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  })) as { id?: string };

  if (!created.id) {
    throw new GoogleApiError({
      status: 500,
      message: "Drive did not return a folder id.",
    });
  }

  return created.id;
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
