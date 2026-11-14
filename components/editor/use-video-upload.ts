"use client";

import { useCallback, useRef, useState } from "react";
import {
  beginVideoUploadAction,
  completeVideoUploadAction,
} from "@/lib/actions/product-media";
import {
  contentRange,
  nextChunk,
  percentComplete,
  probeRange,
} from "@/lib/media/resumable";

/**
 * Uploading a video from the browser straight to YouTube.
 *
 * The bytes deliberately never touch this application's server. A product
 * video is hundreds of megabytes, the instance it would pass through has
 * 512 MB of memory, and a server action is not a file transfer mechanism —
 * proxying one would be an out-of-memory restart on a good day and a request
 * timeout on a normal one.
 *
 * So the server does the two things only it can: it spends the quota and mints
 * a resumable session with the seller's credentials. The session URI is a
 * capability scoped to one upload, which is safe to hand to the browser; the
 * refresh token behind it never leaves the server.
 *
 * Resume is the whole reason for the complexity. Google charges the 1,600
 * quota units when the session is created, so a dropped connection that
 * restarts from zero costs another 1,600 — a third of a seller's daily
 * allowance for one video. Resuming the same session costs nothing.
 */

const MAX_RETRIES_PER_CHUNK = 5;

export type UploadState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "uploading"; percent: number; retrying: boolean }
  | { status: "processing"; mediaId: string }
  | { status: "error"; message: string };

type Options = {
  storeId: string;
  productId: string;
  placement?: "gallery" | "description";
  onComplete?: (mediaId: string) => void;
};

/** Bytes Google has confirmed, asked for directly rather than assumed. */
async function confirmedOffset(
  sessionUri: string,
  totalBytes: number,
): Promise<number> {
  const response = await fetch(sessionUri, {
    method: "PUT",
    headers: { "content-range": probeRange(totalBytes) },
  });

  // 200/201 means it already finished — the response that told us so was the
  // one lost when the connection dropped.
  if (response.ok) return totalBytes;

  if (response.status === 308) {
    const range = response.headers.get("range");
    if (!range) return 0;
    const match = range.match(/bytes=\d+-(\d+)/);
    return match ? Number(match[1]) + 1 : 0;
  }

  throw new Error(`Upload session is no longer valid (${response.status}).`);
}

export function useVideoUpload({
  storeId,
  productId,
  placement = "gallery",
  onComplete,
}: Options) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  const upload = useCallback(
    async (file: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: "preparing" });

      const begun = await beginVideoUploadAction({
        storeId,
        productId,
        placement,
        filename: file.name,
        contentType: file.type || "video/mp4",
        sizeBytes: file.size,
      });

      if (!begun.ok) {
        setState({ status: "error", message: begun.message });
        return;
      }

      const { sessionUri, mediaId } = begun;
      let offset = 0;
      let videoId: string | null = null;

      try {
        while (offset < file.size) {
          if (controller.signal.aborted) return;

          const chunk = nextChunk(offset, file.size);
          if (!chunk) break;

          let attempt = 0;
          let sent = false;

          while (!sent) {
            if (controller.signal.aborted) return;

            setState({
              status: "uploading",
              percent: percentComplete(offset, file.size),
              retrying: attempt > 0,
            });

            try {
              const response = await fetch(sessionUri, {
                method: "PUT",
                headers: {
                  "content-type": file.type || "video/mp4",
                  "content-range": contentRange(chunk, file.size),
                },
                body: file.slice(chunk.start, chunk.end + 1),
                signal: controller.signal,
              });

              if (response.status === 308) {
                const range = response.headers.get("range");
                const match = range?.match(/bytes=\d+-(\d+)/);
                // Trust Google's count, not our own: they differ by exactly
                // the bytes that were in flight when a socket died.
                offset = match ? Number(match[1]) + 1 : chunk.end + 1;
                sent = true;
                continue;
              }

              if (response.ok) {
                const body = (await response.json()) as { id?: string };
                if (!body.id) {
                  throw new Error("YouTube returned no video id.");
                }
                videoId = body.id;
                offset = file.size;
                sent = true;
                continue;
              }

              // 4xx other than 308 is fatal — the session is gone or the file
              // was rejected, and retrying spends time to reach the same wall.
              if (response.status < 500) {
                throw new Error(
                  `YouTube rejected the upload (${response.status}).`,
                );
              }

              throw new Error(`YouTube error ${response.status}.`);
            } catch (error) {
              if (controller.signal.aborted) return;

              attempt++;
              if (attempt >= MAX_RETRIES_PER_CHUNK) throw error;

              // Re-ask Google where it actually got to before retrying, so a
              // partially-received chunk is not sent twice.
              await new Promise((resolve) =>
                setTimeout(resolve, 2 ** attempt * 500),
              );
              offset = await confirmedOffset(sessionUri, file.size);
              if (offset >= file.size) {
                sent = true;
              }
            }
          }
        }

        if (!videoId) {
          throw new Error("Upload finished without a video id.");
        }

        const completed = await completeVideoUploadAction({
          storeId,
          productId,
          mediaId,
          videoId,
        });

        if (!completed.ok) {
          setState({ status: "error", message: completed.message });
          return;
        }

        // `processing`, not done. YouTube has the bytes but has not transcoded
        // them, and the sweeper is what decides when it is embeddable.
        setState({ status: "processing", mediaId });
        onComplete?.(mediaId);
      } catch (error) {
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The upload failed. Try again.",
        });
      } finally {
        abortRef.current = null;
      }
    },
    [storeId, productId, placement, onComplete],
  );

  return { state, upload, cancel };
}
