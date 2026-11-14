import { parseGoogleFailure } from "../errors";
import { GoogleApiError } from "../failover";
import { googleFetch } from "./oauth";

/**
 * YouTube, for both halves of how a video gets onto a product.
 *
 * A seller either uploads through the app — which spends 1,600 quota units
 * against their Cloud project — or pastes a link to a video already on their
 * channel, which spends 1. Both end up as the same product_images row in the
 * same `processing` state, polled the same way, gating publication the same
 * way. The only difference is how the row was created.
 *
 * The pure parts (URL parsing, readiness, duration) are separated from the
 * HTTP because they carry all the fiddly rules and none of the network.
 */

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

// ── Pure: parsing what a seller pasted ────────────────────────────────────

/** Eleven characters of base64url. Stable since 2007. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pulls a video id out of whatever the seller pasted.
 *
 * They will paste a watch URL, a share link, a Shorts URL, an embed snippet,
 * or the bare id, and every one of those is a reasonable thing to expect to
 * work. Returning null for anything else matters as much as parsing the rest:
 * a wrong id becomes a product page showing somebody else's video.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (VIDEO_ID.test(trimmed)) return trimmed;

  // An <iframe> pasted straight out of YouTube's share dialog.
  const iframeSrc = trimmed.match(/src=["']([^"']+)["']/);
  const candidate = iframeSrc ? iframeSrc[1] : trimmed;

  let url: URL;
  try {
    url = new URL(
      candidate.startsWith("http") ? candidate : `https://${candidate}`,
    );
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return VIDEO_ID.test(id) ? id : null;
  }

  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const queryId = url.searchParams.get("v");
  if (queryId && VIDEO_ID.test(queryId)) return queryId;

  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const [prefix, id] = segments;
    if (["embed", "shorts", "live", "v"].includes(prefix)) {
      return VIDEO_ID.test(id) ? id : null;
    }
  }

  return null;
}

/** PT1H2M3S -> 3723. Returns null for a duration YouTube has not set yet. */
export function parseIsoDuration(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const match = value.match(
    /^P(?:([\d.]+)D)?T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/,
  );
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  // P0D is what a video reports while it is still being processed.
  return total > 0 ? Math.round(total) : null;
}

// ── Pure: is this video usable yet? ───────────────────────────────────────

export type VideoStatusResponse = {
  items?: {
    id?: string;
    status?: {
      uploadStatus?: string;
      privacyStatus?: string;
      embeddable?: boolean;
      rejectionReason?: string;
      failureReason?: string;
    };
    processingDetails?: { processingStatus?: string };
    contentDetails?: { duration?: string };
    snippet?: {
      title?: string;
      thumbnails?: Record<
        string,
        { url?: string; width?: number; height?: number }
      >;
    };
  }[];
};

export type VideoReadiness =
  | {
      state: "ready";
      durationSeconds: number | null;
      thumbnailUrl: string | null;
      title: string | null;
    }
  | { state: "processing" }
  | { state: "failed"; reason: string }
  | { state: "unavailable"; reason: string };

/**
 * Turns a videos.list response into a media state.
 *
 * `embeddable` is the check people forget. A video can be fully processed,
 * public, and still refuse to embed — and the product page then shows
 * "Video unavailable" inside a box the seller was told was fine. Treating it
 * as failed here means the seller finds out at upload time, when they can
 * still do something about it.
 *
 * processingDetails is only returned to the video's owner, so this has to
 * work without it: the fallbacks are uploadStatus and whether a duration has
 * appeared, both of which are visible on a public read.
 */
export function evaluateVideoReadiness(
  response: VideoStatusResponse,
): VideoReadiness {
  const video = response.items?.[0];

  // An empty list means deleted, or private to everyone including us.
  if (!video) {
    return {
      state: "unavailable",
      reason: "That video is private or no longer exists.",
    };
  }

  const status = video.status ?? {};
  const upload = status.uploadStatus;

  if (upload === "rejected") {
    return {
      state: "failed",
      reason: status.rejectionReason
        ? `YouTube rejected the video: ${status.rejectionReason}.`
        : "YouTube rejected the video.",
    };
  }
  if (upload === "failed") {
    return {
      state: "failed",
      reason: status.failureReason
        ? `Upload failed: ${status.failureReason}.`
        : "Upload failed.",
    };
  }
  if (upload === "deleted") {
    return { state: "unavailable", reason: "That video was deleted." };
  }

  const processing = video.processingDetails?.processingStatus;
  if (processing === "failed" || processing === "terminated") {
    return { state: "failed", reason: "YouTube could not process the video." };
  }

  const duration = parseIsoDuration(video.contentDetails?.duration);

  // Still transcoding. `uploaded` is the pre-`processed` state, and a missing
  // duration is the public-read equivalent of the same thing.
  if (
    processing === "processing" ||
    upload === "uploaded" ||
    duration === null
  ) {
    return { state: "processing" };
  }

  if (status.privacyStatus === "private") {
    return {
      state: "failed",
      reason: "A private video cannot be embedded. Set it to unlisted.",
    };
  }

  if (status.embeddable === false) {
    return {
      state: "failed",
      reason: "Embedding is disabled for that video.",
    };
  }

  const thumbnails = video.snippet?.thumbnails ?? {};
  const best =
    thumbnails.maxres ??
    thumbnails.standard ??
    thumbnails.high ??
    thumbnails.medium;

  return {
    state: "ready",
    durationSeconds: duration,
    thumbnailUrl: best?.url ?? null,
    title: video.snippet?.title ?? null,
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

/** videos.list — 1 unit. Cheap enough to poll as often as needed. */
export async function fetchVideoStatus(
  accessToken: string,
  videoId: string,
): Promise<VideoReadiness> {
  const url = `${API}/videos?part=status,processingDetails,contentDetails,snippet&id=${encodeURIComponent(videoId)}`;
  const body = (await googleFetch(url, {
    accessToken,
    method: "GET",
  })) as VideoStatusResponse;

  return evaluateVideoReadiness(body);
}

export type UploadMetadata = {
  title: string;
  description?: string;
  /** Unlisted by default: embeddable, but not cluttering the seller's channel. */
  privacyStatus?: "unlisted" | "public";
};

/**
 * Opens a resumable upload session and returns its URI.
 *
 * Resumable rather than a single POST because of what a failure costs. The
 * 1,600 units are charged when the session is created, so a connection that
 * drops halfway through a 200 MB video can resume against the same session
 * for free — whereas restarting a simple upload spends another 1,600 and, on
 * a six-a-day budget, throws away a sixth of the seller's capacity.
 */
export async function beginResumableUpload(
  accessToken: string,
  metadata: UploadMetadata,
  contentLength: number,
  contentType: string,
): Promise<string> {
  const response = await fetch(
    `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-upload-content-length": String(contentLength),
        "x-upload-content-type": contentType,
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title.slice(0, 100),
          description: (metadata.description ?? "").slice(0, 5000),
        },
        status: {
          privacyStatus: metadata.privacyStatus ?? "unlisted",
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new GoogleApiError(
      parseGoogleFailure(
        response.status,
        body ? safeJson(body) : null,
        response.headers,
      ),
    );
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new GoogleApiError({
      status: response.status,
      message: "YouTube did not return an upload session URI.",
    });
  }

  return location;
}

export type ResumableProgress =
  | { done: true; videoId: string }
  /** Bytes YouTube has confirmed. Resume from here. */
  | { done: false; receivedBytes: number };

/** Uploads (or resumes) the bytes for an open session. */
export async function uploadResumableChunk(input: {
  sessionUri: string;
  body: Uint8Array;
  /** Offset of `body` within the whole file. */
  offset: number;
  totalBytes: number;
  contentType: string;
}): Promise<ResumableProgress> {
  const end = input.offset + input.body.byteLength - 1;

  const response = await fetch(input.sessionUri, {
    method: "PUT",
    headers: {
      "content-type": input.contentType,
      "content-range": `bytes ${input.offset}-${end}/${input.totalBytes}`,
    },
    body: input.body as unknown as BodyInit,
  });

  // 308 is the resumable protocol's "keep going", not an error.
  if (response.status === 308) {
    return {
      done: false,
      receivedBytes: parseRangeEnd(response.headers.get("range")),
    };
  }

  const body = await response.text();

  if (!response.ok) {
    throw new GoogleApiError(
      parseGoogleFailure(
        response.status,
        body ? safeJson(body) : null,
        response.headers,
      ),
    );
  }

  const parsed = safeJson(body) as { id?: string } | null;
  if (!parsed?.id) {
    throw new GoogleApiError({
      status: response.status,
      message: "Upload finished but YouTube returned no video id.",
    });
  }

  return { done: true, videoId: parsed.id };
}

/**
 * "bytes=0-262143" -> 262144, the offset to resume from.
 *
 * Absent means YouTube has confirmed nothing, so the next write starts at 0.
 */
export function parseRangeEnd(header: string | null): number {
  if (!header) return 0;
  const match = header.match(/bytes=\d+-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

/** videos.delete — 50 units, irrelevant against the daily budget. */
export async function deleteVideo(
  accessToken: string,
  videoId: string,
): Promise<void> {
  await googleFetch(`${API}/videos?id=${encodeURIComponent(videoId)}`, {
    accessToken,
    method: "DELETE",
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
