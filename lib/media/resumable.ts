/**
 * Chunk arithmetic for a resumable upload.
 *
 * Separated from the network code because the arithmetic is where the bugs
 * live and the network is where they are impossible to reproduce. An
 * off-by-one in a Content-Range header produces a 400 from Google with no
 * useful message, after the seller has already waited through a 200 MB upload.
 */

/**
 * Google requires every chunk except the last to be a multiple of 256 KB.
 *
 * 8 MB is a compromise: large enough that a 200 MB video is 25 requests rather
 * than 800, small enough that a dropped connection on a phone loses seconds of
 * progress rather than minutes.
 */
export const CHUNK_ALIGNMENT = 256 * 1024;
export const DEFAULT_CHUNK_SIZE = 32 * CHUNK_ALIGNMENT;

export type Chunk = {
  start: number;
  /** Inclusive, as Content-Range wants it. */
  end: number;
  size: number;
  isLast: boolean;
};

/**
 * The next chunk to send from `offset`.
 *
 * Returns null when the whole file is confirmed. `end` is inclusive because
 * that is what `Content-Range: bytes start-end/total` means — writing an
 * exclusive end there is the classic way to get a 400 on every request.
 */
export function nextChunk(
  offset: number,
  totalBytes: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Chunk | null {
  if (totalBytes <= 0) return null;
  if (offset >= totalBytes) return null;

  const size = Math.min(chunkSize, totalBytes - offset);
  const end = offset + size - 1;

  return { start: offset, end, size, isLast: end === totalBytes - 1 };
}

/** `bytes start-end/total`, the only format the endpoint accepts. */
export function contentRange(chunk: Chunk, totalBytes: number): string {
  return `bytes ${chunk.start}-${chunk.end}/${totalBytes}`;
}

/**
 * The header that asks "how much did you actually get?" without sending data.
 *
 * Sent after a connection drops, so the upload resumes from what Google
 * confirmed rather than from what the browser believed it had sent — those
 * differ by exactly the bytes that were in flight when the socket died.
 */
export function probeRange(totalBytes: number): string {
  return `bytes */${totalBytes}`;
}

/** 0-100, for a progress bar. */
export function percentComplete(offset: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.round((offset / totalBytes) * 100));
}
