"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { productImages, products, stores } from "@/lib/db/schema";
import { GoogleApiError, runWithFailover } from "@/lib/media/failover";
import { ensureStoreFolder, uploadFile } from "@/lib/media/google/drive";
import { accessTokenForGrant } from "@/lib/media/google/oauth";
import {
  beginResumableUpload,
  fetchVideoStatus,
  parseVideoId,
} from "@/lib/media/google/youtube";
import {
  checkRemoteImageResponse,
  checkRemoteUrl,
  filenameFromUrl,
  isBlockedAddress,
  MAX_REMOTE_BYTES,
  REMOTE_IMAGE_TYPES,
} from "@/lib/media/remote-url";
import {
  databaseFailoverSink,
  loadGrantCandidates,
  loadGrantCredentials,
} from "@/lib/media/repository";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/storage";

/**
 * Seller-supplied media, routed through the connected Google pool.
 *
 * Every path here ends in the same product_images row with the same states, so
 * the readiness gate, the sweeper and the storefront do not care which one was
 * used. That uniformity is the point — a description embed, a gallery photo, a
 * pasted link and an uploaded video are one thing with four front doors.
 */

export type MediaResult =
  | { ok: true; message: string; mediaId?: string }
  | { ok: false; message: string };

const MAX_MEDIA_PER_PRODUCT = 24;

async function ownedProduct(productId: string, storeId: string) {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      storeName: stores.name,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);
  return row ?? null;
}

async function nextPosition(productId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  return count;
}

/**
 * Turns a failover failure into something a shop owner can act on.
 *
 * The distinction that matters to them is whether waiting fixes it. "Try again
 * in an hour" and "reconnect your account" are different jobs, and a single
 * generic error message would leave them retrying a thing that will never work.
 */
function explainFailure(
  failure: Awaited<ReturnType<typeof runWithFailover>>,
): string {
  if (failure.ok) return "";

  switch (failure.reason) {
    case "no_capacity":
      if (failure.retryAt) {
        return `All connected accounts are busy or out of quota. This will retry automatically after ${failure.retryAt.toLocaleString()}.`;
      }
      return "No connected Google account can take this right now. Check your connections in store settings.";
    case "transient":
      return "Google is not responding. This will retry automatically.";
    case "rejected":
      return failure.message;
    case "exhausted_attempts":
      return "Tried every connected account without success. Check your connections in store settings.";
  }
}

// ── Images, into the seller's Drive ────────────────────────────────────────

const imageInput = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  placement: z.enum(["gallery", "description"]).default("gallery"),
  alt: z.string().max(200).optional(),
});

/**
 * Uploads a photo to whichever connected Drive has room.
 *
 * Bytes pass through the server because the Drive API needs an access token
 * the browser must never see, and at the 8 MB image cap that is affordable.
 * Video does not work this way — see beginVideoUploadAction.
 */
export async function uploadProductImageToDriveAction(
  formData: FormData,
): Promise<MediaResult> {
  const parsed = imageInput.safeParse({
    storeId: formData.get("storeId"),
    productId: formData.get("productId"),
    placement: formData.get("placement") ?? "gallery",
    alt: formData.get("alt") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const input = parsed.data;

  await requireStorePermission(input.storeId, "product.update");
  const owned = await ownedProduct(input.productId, input.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a file." };
  }
  // Server-side, both of them. The accept attribute is a picker convenience
  // and is trivially bypassed.
  if (!isAcceptedImageType(file.type)) {
    return { ok: false, message: "Images only — JPEG, PNG, WebP or AVIF." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    };
  }

  const position = await nextPosition(input.productId);
  if (position >= MAX_MEDIA_PER_PRODUCT) {
    return {
      ok: false,
      message: `A product can have ${MAX_MEDIA_PER_PRODUCT} pieces of media. Remove one first.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const candidates = await loadGrantCandidates(input.storeId);

  const result = await runWithFailover({
    candidates,
    need: { kind: "drive", bytes: bytes.byteLength },
    now: new Date(),
    sink: databaseFailoverSink(),
    attempt: async (grant) => {
      const credentials = await loadGrantCredentials(grant.grantId);
      if (!credentials) {
        throw new GoogleApiError({
          status: 401,
          reason: "invalid_grant",
          message: "That connection is missing its credentials.",
        });
      }

      const token = await accessTokenForGrant(grant.grantId, credentials);
      const folderId = await ensureStoreFolder(token, owned.storeName);

      const uploaded = await uploadFile({
        accessToken: token,
        filename: file.name || `${owned.slug}-${position}`,
        contentType: file.type,
        bytes,
        parentId: folderId,
      });

      return { fileId: uploaded.fileId, accountId: grant.accountId };
    },
  });

  if (!result.ok) return { ok: false, message: explainFailure(result) };

  // Two statements, because the proxy URL contains the row's own id and so
  // cannot be known until the insert returns. See app/api/media/[mediaId].
  //
  // It lands as `queued` and only becomes `ready` in the second write, once
  // the URL is actually set. Inserting it ready would open a window — however
  // short — where the publish gate counts the asset as finished while every
  // read path still filters it out for having no URL, and a product could go
  // live with a photo that renders as nothing.
  const [row] = await db
    .insert(productImages)
    .values({
      productId: input.productId,
      kind: "image",
      provider: "drive",
      placement: input.placement,
      providerRef: result.value.fileId,
      googleAccountId: result.value.accountId,
      state: "queued",
      alt: input.alt ?? null,
      position,
    })
    .returning({ id: productImages.id });

  // Unlike a video there is no processing step: the bytes were confirmed in
  // Drive by the time the upload call returned.
  await db
    .update(productImages)
    .set({ url: `/api/media/${row.id}`, state: "ready" })
    .where(eq(productImages.id, row.id));

  revalidatePath(`/dashboard/${input.storeId}/products/${input.productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, message: "Uploaded.", mediaId: row.id };
}

// ── Video by link ─────────────────────────────────────────────────────────

const linkInput = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  url: z.string().min(1).max(2000),
  placement: z.enum(["gallery", "description"]).default("gallery"),
  alt: z.string().max(200).optional(),
});

/**
 * Attaches a video the seller has already uploaded to their own channel.
 *
 * This is the path that costs one quota unit instead of 1,600, and it is the
 * one most sellers should use. The row still enters the normal lifecycle: a
 * video that is public but still transcoding lands in `processing` and holds
 * publication exactly as an in-app upload would.
 */
export async function attachVideoLinkAction(
  input: z.input<typeof linkInput>,
): Promise<MediaResult> {
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const videoId = parseVideoId(data.url);
  if (!videoId) {
    return {
      ok: false,
      message: "That does not look like a YouTube link. Paste the video's URL.",
    };
  }

  const [existing] = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, data.productId),
        eq(productImages.providerRef, videoId),
      ),
    )
    .limit(1);
  if (existing) {
    return { ok: false, message: "That video is already on this product." };
  }

  const position = await nextPosition(data.productId);
  if (position >= MAX_MEDIA_PER_PRODUCT) {
    return {
      ok: false,
      message: `A product can have ${MAX_MEDIA_PER_PRODUCT} pieces of media. Remove one first.`,
    };
  }

  // Verified up front — one unit — so an unusable link is refused while the
  // seller is still looking at the form, rather than silently blocking
  // publication until the sweeper gets to it.
  const candidates = await loadGrantCandidates(data.storeId);
  const check = await runWithFailover({
    candidates,
    need: { kind: "youtube", operation: "videosList" },
    now: new Date(),
    sink: databaseFailoverSink(),
    attempt: async (grant) => {
      const credentials = await loadGrantCredentials(grant.grantId);
      if (!credentials) {
        throw new GoogleApiError({
          status: 401,
          reason: "invalid_grant",
          message: "That connection is missing its credentials.",
        });
      }
      const token = await accessTokenForGrant(grant.grantId, credentials);
      return {
        readiness: await fetchVideoStatus(token, videoId),
        accountId: grant.accountId,
      };
    },
  });

  if (!check.ok) return { ok: false, message: explainFailure(check) };

  const { readiness, accountId } = check.value;

  if (readiness.state === "failed" || readiness.state === "unavailable") {
    return { ok: false, message: readiness.reason };
  }

  const ready = readiness.state === "ready";

  const [row] = await db
    .insert(productImages)
    .values({
      productId: data.productId,
      kind: "video",
      provider: "youtube",
      placement: data.placement,
      providerRef: videoId,
      googleAccountId: accountId,
      state: ready ? "ready" : "processing",
      url: ready ? readiness.thumbnailUrl : null,
      durationSeconds: ready ? readiness.durationSeconds : null,
      alt: data.alt ?? (ready ? readiness.title : null),
      position,
    })
    .returning({ id: productImages.id });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);

  return {
    ok: true,
    mediaId: row.id,
    message: ready
      ? "Video added."
      : "Video added. It is still processing on YouTube and will appear when ready.",
  };
}

// ── Anything with a URL ───────────────────────────────────────────────────

/**
 * Every address the hostname resolves to must be public.
 *
 * checkRemoteUrl catches a literal `127.0.0.1`, but nothing stops a seller
 * pointing `pictures.example.com` at it — DNS is theirs to control, not ours.
 * The addresses are what the fetch will actually reach, so the addresses are
 * what get checked.
 */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  // Already a literal address: checkRemoteUrl has judged it.
  if (isBlockedAddress(hostname)) return false;
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return true;

  try {
    const { lookup } = await import("node:dns/promises");
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) return false;
    return results.every((entry) => !isBlockedAddress(entry.address));
  } catch {
    // A hostname that will not resolve here will not fetch either.
    return false;
  }
}

/**
 * Downloads an image a seller linked to, into their own Drive.
 *
 * Ingested rather than hotlinked, for three reasons. next.config.ts keeps a
 * deliberately short allowlist of image hosts and adding "anywhere" to it
 * would make the storefront an open image proxy. A linked image can change or
 * disappear under a live listing with nothing to detect it. And a copy in the
 * seller's Drive is subject to the same readiness gate, sweeper and
 * delete-by-owning-account as everything else.
 */
async function ingestRemoteImage(
  url: URL,
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; message: string }
> {
  if (!(await resolvesPublicly(url.hostname))) {
    return {
      ok: false,
      message: "That address is not reachable from the internet.",
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      // manual, so a 302 to 169.254.169.254 is not followed by the runtime
      // behind our back. One hop is all that is offered.
      redirect: "manual",
      headers: { accept: REMOTE_IMAGE_TYPES.join(",") },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: "Could not reach that link." };
  }

  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      message: "That link redirects. Use the direct image address.",
    };
  }
  if (!response.ok) {
    return { ok: false, message: `That link returned ${response.status}.` };
  }

  const check = checkRemoteImageResponse(response.headers);
  if (!check.ok) return { ok: false, message: check.message };

  const buffer = await response.arrayBuffer();
  // Checked again after reading: Content-Length is advisory and a hostile
  // server can simply omit it.
  if (buffer.byteLength > MAX_REMOTE_BYTES) {
    return {
      ok: false,
      message: `That image is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_REMOTE_BYTES / 1024 / 1024} MB.`,
    };
  }

  return {
    ok: true,
    bytes: new Uint8Array(buffer),
    contentType: check.contentType,
  };
}

/**
 * One field for any link a seller pastes.
 *
 * A YouTube URL becomes a video on their channel; anything else is tried as an
 * image and copied into their Drive. Asking which kind it was first would be a
 * question the address already answers.
 */
export async function attachMediaLinkAction(
  input: z.input<typeof linkInput>,
): Promise<MediaResult> {
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  // YouTube first: it is the cheap path and the unambiguous one.
  if (parseVideoId(data.url)) {
    return attachVideoLinkAction(data);
  }

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const checked = checkRemoteUrl(data.url);
  if (!checked.ok) return { ok: false, message: checked.message };

  const position = await nextPosition(data.productId);
  if (position >= MAX_MEDIA_PER_PRODUCT) {
    return {
      ok: false,
      message: `A product can have ${MAX_MEDIA_PER_PRODUCT} pieces of media. Remove one first.`,
    };
  }

  const fetched = await ingestRemoteImage(checked.url);
  if (!fetched.ok) return { ok: false, message: fetched.message };

  const candidates = await loadGrantCandidates(data.storeId);
  const result = await runWithFailover({
    candidates,
    need: { kind: "drive", bytes: fetched.bytes.byteLength },
    now: new Date(),
    sink: databaseFailoverSink(),
    attempt: async (grant) => {
      const credentials = await loadGrantCredentials(grant.grantId);
      if (!credentials) {
        throw new GoogleApiError({
          status: 401,
          reason: "invalid_grant",
          message: "That connection is missing its credentials.",
        });
      }
      const token = await accessTokenForGrant(grant.grantId, credentials);
      const folderId = await ensureStoreFolder(token, owned.storeName);
      const uploaded = await uploadFile({
        accessToken: token,
        filename: filenameFromUrl(checked.url, fetched.contentType),
        contentType: fetched.contentType,
        bytes: fetched.bytes,
        parentId: folderId,
      });
      return { fileId: uploaded.fileId, accountId: grant.accountId };
    },
  });

  if (!result.ok) return { ok: false, message: explainFailure(result) };

  const [row] = await db
    .insert(productImages)
    .values({
      productId: data.productId,
      kind: "image",
      provider: "drive",
      placement: data.placement,
      providerRef: result.value.fileId,
      googleAccountId: result.value.accountId,
      state: "queued",
      alt: data.alt ?? null,
      position,
    })
    .returning({ id: productImages.id });

  await db
    .update(productImages)
    .set({ url: `/api/media/${row.id}`, state: "ready" })
    .where(eq(productImages.id, row.id));

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, mediaId: row.id, message: "Image added." };
}

// ── Video by upload ───────────────────────────────────────────────────────

const beginUploadInput = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(128 * 1024 * 1024 * 1024),
  placement: z.enum(["gallery", "description"]).default("gallery"),
});

export type BeginUploadResult =
  | { ok: true; mediaId: string; sessionUri: string }
  | { ok: false; message: string };

/**
 * Opens a YouTube upload session and hands the URI to the browser.
 *
 * The bytes deliberately never touch this server. A product video is hundreds
 * of megabytes, the instance has 512 MB of memory, and Next's server actions
 * are not a file transfer mechanism — proxying one would be an out-of-memory
 * restart on a good day and a request timeout on a normal one. The browser
 * PUTs straight to Google instead.
 *
 * Quota is spent here, at session creation, which is also when Google charges
 * it. The session URI is stored on the row so a dropped connection resumes
 * rather than restarting: on a six-uploads-a-day budget, paying 1,600 units
 * twice for one video throws away a third of the seller's day.
 */
export async function beginVideoUploadAction(
  input: z.input<typeof beginUploadInput>,
): Promise<BeginUploadResult> {
  const parsed = beginUploadInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  if (!data.contentType.startsWith("video/")) {
    return { ok: false, message: "That is not a video file." };
  }

  const position = await nextPosition(data.productId);
  if (position >= MAX_MEDIA_PER_PRODUCT) {
    return {
      ok: false,
      message: `A product can have ${MAX_MEDIA_PER_PRODUCT} pieces of media. Remove one first.`,
    };
  }

  const candidates = await loadGrantCandidates(data.storeId);

  const result = await runWithFailover({
    candidates,
    need: { kind: "youtube", operation: "videosInsert" },
    now: new Date(),
    sink: databaseFailoverSink(),
    attempt: async (grant) => {
      const credentials = await loadGrantCredentials(grant.grantId);
      if (!credentials) {
        throw new GoogleApiError({
          status: 401,
          reason: "invalid_grant",
          message: "That connection is missing its credentials.",
        });
      }
      const token = await accessTokenForGrant(grant.grantId, credentials);

      const sessionUri = await beginResumableUpload(
        token,
        {
          title: owned.title,
          description: `${owned.title} — ${owned.storeName}`,
          // Unlisted: embeddable on the product page, but not cluttering the
          // seller's public channel with one clip per SKU.
          privacyStatus: "unlisted",
        },
        data.sizeBytes,
        data.contentType,
      );

      return { sessionUri, accountId: grant.accountId };
    },
  });

  if (!result.ok) return { ok: false, message: explainFailure(result) };

  const [row] = await db
    .insert(productImages)
    .values({
      productId: data.productId,
      kind: "video",
      provider: "youtube",
      placement: data.placement,
      googleAccountId: result.value.accountId,
      state: "uploading",
      uploadSessionUri: result.value.sessionUri,
      position,
    })
    .returning({ id: productImages.id });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  return { ok: true, mediaId: row.id, sessionUri: result.value.sessionUri };
}

const completeUploadInput = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  mediaId: z.uuid(),
  videoId: z.string().min(1).max(64),
});

/**
 * Records the video id the browser got back from YouTube.
 *
 * The row goes to `processing`, not `ready` — YouTube has the bytes but has
 * not transcoded them, and a video that is embeddable in ten minutes is not
 * embeddable now. The sweeper decides when it is actually usable.
 */
export async function completeVideoUploadAction(
  input: z.input<typeof completeUploadInput>,
): Promise<MediaResult> {
  const parsed = completeUploadInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const videoId = parseVideoId(data.videoId);
  if (!videoId) return { ok: false, message: "Invalid video id." };

  const updated = await db
    .update(productImages)
    .set({
      providerRef: videoId,
      state: "processing",
      uploadSessionUri: null,
      lastCheckedAt: null,
      checkAttempts: 0,
    })
    .where(
      and(
        eq(productImages.id, data.mediaId),
        eq(productImages.productId, data.productId),
        eq(productImages.state, "uploading"),
      ),
    )
    .returning({ id: productImages.id });

  if (updated.length === 0) {
    return { ok: false, message: "That upload is no longer in progress." };
  }

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  return {
    ok: true,
    mediaId: data.mediaId,
    message: "Uploaded. YouTube is processing it now.",
  };
}

// ── Publish mode ──────────────────────────────────────────────────────────

const publishModeInput = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  publishMode: z.enum(["manual", "when_media_ready"]),
});

export async function setPublishModeAction(
  input: z.input<typeof publishModeInput>,
): Promise<MediaResult> {
  const parsed = publishModeInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.publish");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  await db
    .update(products)
    .set({ publishMode: data.publishMode })
    .where(eq(products.id, data.productId));

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  return {
    ok: true,
    message:
      data.publishMode === "when_media_ready"
        ? "This product will publish itself once every file is ready."
        : "This product will stay a draft until you publish it.",
  };
}
