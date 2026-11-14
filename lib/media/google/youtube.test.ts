import { describe, expect, it } from "vitest";
import {
  evaluateVideoReadiness,
  parseIsoDuration,
  parseRangeEnd,
  parseVideoId,
  type VideoStatusResponse,
} from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseVideoId", () => {
  it("reads every form a seller might paste", () => {
    const forms = [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `youtube.com/watch?v=${ID}`,
      ID,
    ];
    for (const form of forms) {
      expect(parseVideoId(form), form).toBe(ID);
    }
  });

  it("survives the extra parameters share links carry", () => {
    expect(parseVideoId(`https://youtu.be/${ID}?t=42&si=abcdef`)).toBe(ID);
    expect(
      parseVideoId(`https://www.youtube.com/watch?v=${ID}&list=PL123&index=2`),
    ).toBe(ID);
  });

  it("reads an iframe pasted from the share dialog", () => {
    const iframe = `<iframe width="560" src="https://www.youtube.com/embed/${ID}?rel=0" title="x"></iframe>`;
    expect(parseVideoId(iframe)).toBe(ID);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseVideoId(`  https://youtu.be/${ID}  `)).toBe(ID);
  });

  it("refuses anything that is not a YouTube video", () => {
    // A wrong id is worse than none: it puts somebody else's video on the
    // product page, and nothing downstream would catch it.
    const bad = [
      "",
      "   ",
      "https://vimeo.com/123456",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=tooshort",
      "https://www.youtube.com/channel/UCabcdefghijk",
      "https://www.youtube.com/results?search_query=shirt",
      "not a url at all",
      "dQw4w9WgXc",
      "dQw4w9WgXcQextra",
    ];
    for (const value of bad) {
      expect(parseVideoId(value), value).toBeNull();
    }
  });
});

describe("parseIsoDuration", () => {
  it("reads the shapes YouTube emits", () => {
    expect(parseIsoDuration("PT30S")).toBe(30);
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT2M")).toBe(120);
    expect(parseIsoDuration("P1DT2H")).toBe(93600);
  });

  it("treats a zero duration as not-yet-known", () => {
    // P0D is what a video reports while it is still being processed, so
    // returning 0 would look like a real answer.
    expect(parseIsoDuration("P0D")).toBeNull();
    expect(parseIsoDuration("PT0S")).toBeNull();
  });

  it("returns null for absent or malformed values", () => {
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration("90 seconds")).toBeNull();
  });
});

const video = (
  overrides: Partial<NonNullable<VideoStatusResponse["items"]>[number]> = {},
): VideoStatusResponse => ({
  items: [
    {
      id: ID,
      status: {
        uploadStatus: "processed",
        privacyStatus: "unlisted",
        embeddable: true,
      },
      processingDetails: { processingStatus: "succeeded" },
      contentDetails: { duration: "PT1M30S" },
      snippet: {
        title: "Shirt on the loom",
        thumbnails: { high: { url: "https://i.ytimg.com/vi/x/hq.jpg" } },
      },
      ...overrides,
    },
  ],
});

describe("evaluateVideoReadiness", () => {
  it("is ready when everything lines up", () => {
    const result = evaluateVideoReadiness(video());
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.durationSeconds).toBe(90);
      expect(result.thumbnailUrl).toBe("https://i.ytimg.com/vi/x/hq.jpg");
      expect(result.title).toBe("Shirt on the loom");
    }
  });

  it("is unavailable when the video is not in the response", () => {
    // Deleted, or private to everyone including us.
    expect(evaluateVideoReadiness({ items: [] }).state).toBe("unavailable");
    expect(evaluateVideoReadiness({}).state).toBe("unavailable");
  });

  it("is still processing while transcoding", () => {
    expect(
      evaluateVideoReadiness(
        video({ processingDetails: { processingStatus: "processing" } }),
      ).state,
    ).toBe("processing");

    expect(
      evaluateVideoReadiness(
        video({
          status: { uploadStatus: "uploaded", embeddable: true },
        }),
      ).state,
    ).toBe("processing");
  });

  it("treats a missing duration as still processing", () => {
    // processingDetails is owner-only, so on a public read this is the signal.
    expect(
      evaluateVideoReadiness(
        video({
          processingDetails: {},
          contentDetails: { duration: "P0D" },
        }),
      ).state,
    ).toBe("processing");
  });

  it("fails a video that cannot be embedded", () => {
    // The check people forget. Fully processed and public, and the product
    // page still shows "Video unavailable" inside the player.
    const result = evaluateVideoReadiness(
      video({
        status: {
          uploadStatus: "processed",
          privacyStatus: "public",
          embeddable: false,
        },
      }),
    );
    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.reason).toMatch(/Embedding is disabled/);
    }
  });

  it("fails a private video and says what to do", () => {
    const result = evaluateVideoReadiness(
      video({
        status: {
          uploadStatus: "processed",
          privacyStatus: "private",
          embeddable: true,
        },
      }),
    );
    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.reason).toMatch(/unlisted/);
    }
  });

  it("reports a rejection with YouTube's reason", () => {
    const result = evaluateVideoReadiness(
      video({
        status: { uploadStatus: "rejected", rejectionReason: "copyright" },
      }),
    );
    expect(result.state).toBe("failed");
    if (result.state === "failed") expect(result.reason).toMatch(/copyright/);
  });

  it("fails when processing terminated", () => {
    expect(
      evaluateVideoReadiness(
        video({ processingDetails: { processingStatus: "terminated" } }),
      ).state,
    ).toBe("failed");
  });

  it("marks a deleted video unavailable rather than failed", () => {
    // Different remedy: failed means fix the file, unavailable means it is
    // gone at the source and the seller has to re-add it.
    expect(
      evaluateVideoReadiness(video({ status: { uploadStatus: "deleted" } }))
        .state,
    ).toBe("unavailable");
  });
});

describe("parseRangeEnd", () => {
  it("converts a confirmed range to the next offset", () => {
    expect(parseRangeEnd("bytes=0-262143")).toBe(262144);
    expect(parseRangeEnd("bytes=0-0")).toBe(1);
  });

  it("starts from zero when YouTube has confirmed nothing", () => {
    expect(parseRangeEnd(null)).toBe(0);
    expect(parseRangeEnd("")).toBe(0);
    expect(parseRangeEnd("nonsense")).toBe(0);
  });
});
