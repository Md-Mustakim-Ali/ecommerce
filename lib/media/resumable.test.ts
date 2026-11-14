import { describe, expect, it } from "vitest";
import {
  CHUNK_ALIGNMENT,
  contentRange,
  DEFAULT_CHUNK_SIZE,
  nextChunk,
  percentComplete,
  probeRange,
} from "./resumable";

describe("nextChunk", () => {
  const total = 10 * 1024 * 1024;

  it("starts at zero and takes a full chunk", () => {
    const chunk = nextChunk(0, total);
    expect(chunk).toEqual({
      start: 0,
      end: DEFAULT_CHUNK_SIZE - 1,
      size: DEFAULT_CHUNK_SIZE,
      isLast: false,
    });
  });

  it("uses an inclusive end", () => {
    // Content-Range is inclusive. An exclusive end here is a 400 on every
    // request, after the seller has already waited through the upload.
    const chunk = nextChunk(0, 1000, 100);
    expect(chunk?.end).toBe(99);
    expect(chunk?.size).toBe(100);
  });

  it("shortens the final chunk to whatever is left", () => {
    const chunk = nextChunk(9 * 1024 * 1024, total);
    expect(chunk?.size).toBe(1024 * 1024);
    expect(chunk?.end).toBe(total - 1);
    expect(chunk?.isLast).toBe(true);
  });

  it("marks the last chunk even when it is exactly one chunk long", () => {
    const chunk = nextChunk(0, DEFAULT_CHUNK_SIZE);
    expect(chunk?.isLast).toBe(true);
  });

  it("returns null once everything is confirmed", () => {
    expect(nextChunk(total, total)).toBeNull();
    expect(nextChunk(total + 1, total)).toBeNull();
  });

  it("returns null for an empty file", () => {
    expect(nextChunk(0, 0)).toBeNull();
  });

  it("keeps every non-final chunk aligned to 256 KB", () => {
    // Google rejects a non-final chunk that is not a multiple of 256 KB.
    let offset = 0;
    const size = 5 * DEFAULT_CHUNK_SIZE + 7777;
    const chunks = [];
    let chunk = nextChunk(offset, size);
    while (chunk) {
      chunks.push(chunk);
      offset = chunk.end + 1;
      chunk = nextChunk(offset, size);
    }

    for (const each of chunks.slice(0, -1)) {
      expect(each.size % CHUNK_ALIGNMENT).toBe(0);
    }
    // And the walk covers the file exactly once, with no gap or overlap.
    expect(chunks.at(-1)?.end).toBe(size - 1);
    expect(chunks.reduce((sum, c) => sum + c.size, 0)).toBe(size);
  });

  it("resumes from an arbitrary confirmed offset", () => {
    // After a dropped connection Google may have confirmed a partial chunk,
    // so the resume point is not necessarily chunk-aligned.
    const chunk = nextChunk(1_000_003, total);
    expect(chunk?.start).toBe(1_000_003);
    expect(chunk?.end).toBe(1_000_003 + DEFAULT_CHUNK_SIZE - 1);
  });
});

describe("contentRange", () => {
  it("formats the header Google expects", () => {
    expect(
      contentRange({ start: 0, end: 999, size: 1000, isLast: false }, 5000),
    ).toBe("bytes 0-999/5000");
  });
});

describe("probeRange", () => {
  it("asks how much arrived without sending data", () => {
    expect(probeRange(5000)).toBe("bytes */5000");
  });
});

describe("percentComplete", () => {
  it("reports progress", () => {
    expect(percentComplete(0, 100)).toBe(0);
    expect(percentComplete(50, 100)).toBe(50);
    expect(percentComplete(100, 100)).toBe(100);
  });

  it("never exceeds 100 or divides by zero", () => {
    expect(percentComplete(150, 100)).toBe(100);
    expect(percentComplete(0, 0)).toBe(0);
  });
});
