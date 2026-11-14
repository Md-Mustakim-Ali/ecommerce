"use client";

import { Play } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

/**
 * A YouTube embed that does not load YouTube until someone asks for it.
 *
 * The player is well over a megabyte of JavaScript from a third-party origin,
 * and mounting the iframe on render pays that on every product page view —
 * including the overwhelming majority where nobody presses play. On the
 * connections this storefront actually serves that is the difference between a
 * fast product page and a slow one, and it is the single biggest performance
 * decision in the whole media feature.
 *
 * So the initial render is a poster image and a button. The iframe appears on
 * click, with autoplay set because at that point the intent is unambiguous.
 *
 * Used by both the gallery and the description renderer. One component, so a
 * video behaves identically wherever a seller puts it.
 */

export type VideoEmbedProps = {
  /** YouTube video id. */
  videoId: string;
  title: string;
  /** Falls back to YouTube's own thumbnail when the row has no poster. */
  posterUrl?: string | null;
  blurDataUrl?: string | null;
  durationSeconds?: number | null;
  className?: string;
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function VideoEmbed({
  videoId,
  title,
  posterUrl,
  blurDataUrl,
  durationSeconds,
  className,
}: VideoEmbedProps) {
  const [playing, setPlaying] = useState(false);

  // hqdefault rather than maxresdefault: maxres does not exist for every
  // video, and when it is missing YouTube serves a 404 placeholder image
  // rather than falling back, which looks like a broken product photo.
  const poster = posterUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  if (playing) {
    return (
      <div
        className={`relative aspect-video overflow-hidden rounded-lg bg-black ${className ?? ""}`}
      >
        <iframe
          // nocookie: no tracking cookie until the buyer actually plays it,
          // which keeps a product page from setting third-party state nobody
          // consented to.
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play video: ${title}`}
      className={`group relative block aspect-video w-full overflow-hidden rounded-lg bg-skeleton ${className ?? ""}`}
    >
      <Image
        src={poster}
        alt=""
        fill
        // Decorative: the button's aria-label already names the video, so
        // announcing the thumbnail as well would repeat it.
        aria-hidden
        sizes="(max-width: 768px) 100vw, 720px"
        placeholder={blurDataUrl ? "blur" : "empty"}
        blurDataURL={blurDataUrl ?? undefined}
        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />

      <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />

      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-black/70 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
          <Play className="h-7 w-7 translate-x-0.5 fill-white text-white" />
        </span>
      </span>

      {durationSeconds ? (
        <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-medium text-white text-xs tabular-nums">
          {formatDuration(durationSeconds)}
        </span>
      ) : null}
    </button>
  );
}
