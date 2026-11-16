"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Film,
  ImagePlus,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useVideoUpload } from "@/components/editor/use-video-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteProductImageAction,
  reorderProductImagesAction,
} from "@/lib/actions/product-images";
import {
  attachMediaLinkAction,
  uploadProductImageToDriveAction,
} from "@/lib/actions/product-media";
import type { EditorAttribute } from "@/lib/catalog/product-editor";
import { TagPicker } from "./tag-picker";

/**
 * Everything attached to a product: photos, videos, ready or not.
 *
 * Showing unfinished assets is the point, not a detail. The seller is the only
 * person who can act on a video that failed to transcode or a file whose Drive
 * account was disconnected, and until they can see it the product simply
 * refuses to publish with no explanation.
 *
 * It is also load-bearing for reordering. reorderProductImagesAction validates
 * the submitted list against every row on the product, so a grid that hid
 * pending assets would submit a short list and be rejected outright — the
 * seller would find that arrows had stopped working the moment they uploaded a
 * video.
 */

export type EditorMediaItem = {
  id: string;
  kind: "image" | "video";
  provider: "managed" | "drive" | "youtube";
  url: string | null;
  alt: string | null;
  position: number;
  blurDataUrl: string | null;
  state:
    | "queued"
    | "uploading"
    | "processing"
    | "ready"
    | "failed"
    | "unavailable";
  failureReason: string | null;
  durationSeconds: number | null;
  /** attributeId -> valueId. Empty when the asset is not option-specific. */
  tags: Record<string, string>;
};

const SETTLING = new Set(["queued", "uploading", "processing"]);

const STATE_LABEL: Record<EditorMediaItem["state"], string> = {
  queued: "Queued",
  uploading: "Uploading",
  processing: "Processing on YouTube",
  ready: "Ready",
  failed: "Failed",
  unavailable: "No longer available",
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function MediaManager({
  storeId,
  productId,
  media,
  attributes,
  canEdit,
}: {
  storeId: string;
  productId: string;
  media: EditorMediaItem[];
  attributes: EditorAttribute[];
  canEdit: boolean;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState(media);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const videoUpload = useVideoUpload({
    storeId,
    productId,
    placement: "gallery",
    onComplete: () => setMessage("Uploaded. YouTube is processing it now."),
  });

  // Only attributes with values are taggable; a spec with nothing chosen
  // cannot narrow a photo to anything.
  const taggable = attributes.filter((a) => a.values.length > 0);
  const settlingCount = order.filter((item) => SETTLING.has(item.state)).length;

  function uploadPhoto(file: File) {
    setError(null);
    setMessage(null);
    const data = new FormData();
    data.set("storeId", storeId);
    data.set("productId", productId);
    data.set("placement", "gallery");
    data.set("file", file);

    startTransition(async () => {
      const result = await uploadProductImageToDriveAction(data);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage("Uploaded. Reload to tag it.");
    });
  }

  function attachVideo() {
    const trimmed = videoUrl.trim();
    if (!trimmed) {
      setError("Paste a YouTube link first.");
      return;
    }
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await attachMediaLinkAction({
        storeId,
        productId,
        url: trimmed,
        placement: "gallery",
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setVideoUrl("");
      setMessage(result.message);
    });
  }

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);

    startTransition(async () => {
      // Every id, including assets that are not ready. The action checks the
      // list against all rows on the product, so omitting one fails the whole
      // reorder.
      const result = await reorderProductImagesAction({
        storeId,
        productId,
        imageIds: next.map((item) => item.id),
      });
      if (!result.ok) {
        setError(result.message);
        setOrder(order);
      }
    });
  }

  // The cover is the first READY image — not simply the first row. A
  // processing video sitting at position 0 must not be announced as the
  // picture shoppers will see, because it is not one.
  const coverId = order.find(
    (item) => item.kind === "image" && item.state === "ready",
  )?.id;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Photos and video</h2>
          <p className="text-tertiary-text text-xs">
            The first photo is the one shoppers see in listings. Tag a photo
            with an option and the gallery jumps to it when that option is
            picked.
          </p>
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadPhoto(file);
                event.target.value = "";
              }}
            />
            <input
              ref={videoInput}
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) videoUpload.upload(file);
                event.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => photoInput.current?.click()}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ImagePlus aria-hidden />
              )}
              Photo
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={videoUpload.state.status !== "idle"}
              onClick={() => videoInput.current?.click()}
            >
              <Film aria-hidden />
              Upload video
            </Button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <Label htmlFor="gallery-video-url" className="text-xs">
            Or paste a link
          </Label>
          <div className="flex gap-2">
            <Input
              id="gallery-video-url"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  attachVideo();
                }
              }}
              placeholder="YouTube link or image address"
              disabled={pending}
            />
            <Button
              type="button"
              size="sm"
              onClick={attachVideo}
              disabled={pending}
            >
              Add
            </Button>
          </div>
          <p className="text-tertiary-text text-xs">
            A YouTube link costs 1 of your project&rsquo;s daily quota units;
            uploading a video through the app costs 1,600, about a sixth of a
            day. An image address is copied into your Drive rather than linked,
            so it cannot break later.
          </p>
        </div>
      ) : null}

      <VideoUploadProgress
        state={videoUpload.state}
        onCancel={videoUpload.cancel}
      />

      {settlingCount > 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {settlingCount} file{settlingCount === 1 ? " is" : "s are"} still
          being processed. This product cannot go live until they finish.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      {order.length === 0 ? (
        <div className="rounded-md border border-border border-dashed px-4 py-8 text-center">
          <p className="text-secondary-text text-sm">
            No photos yet. A listing without one rarely sells.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {order.map((item, index) => {
            const settling = SETTLING.has(item.state);
            const broken =
              item.state === "failed" || item.state === "unavailable";

            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
              >
                <div className="relative aspect-square overflow-hidden rounded-md bg-surface-3">
                  {item.url ? (
                    <Image
                      src={item.url}
                      alt={item.alt ?? ""}
                      fill
                      sizes="(max-width: 640px) 100vw, 300px"
                      className={`object-cover ${settling ? "opacity-40" : ""}`}
                      placeholder={item.blurDataUrl ? "blur" : "empty"}
                      blurDataURL={item.blurDataUrl ?? undefined}
                    />
                  ) : null}

                  {item.kind === "video" && !settling && !broken ? (
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-black/70">
                        <Play
                          className="h-5 w-5 translate-x-0.5 fill-white text-white"
                          aria-hidden
                        />
                      </span>
                    </span>
                  ) : null}

                  {settling ? (
                    <span className="absolute inset-0 grid place-items-center bg-surface-1/70 p-2 text-center">
                      <span className="flex flex-col items-center gap-1 text-xs">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {STATE_LABEL[item.state]}
                      </span>
                    </span>
                  ) : null}

                  {broken ? (
                    <span className="absolute inset-0 grid place-items-center bg-critical-muted/85 p-3 text-center">
                      <span className="flex flex-col items-center gap-1 text-xs">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                        {item.failureReason ?? STATE_LABEL[item.state]}
                      </span>
                    </span>
                  ) : null}

                  {item.id === coverId ? (
                    <span className="absolute top-2 left-2">
                      <Badge variant="default">Cover</Badge>
                    </span>
                  ) : null}

                  {item.kind === "video" && item.durationSeconds ? (
                    <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-medium text-white text-xs tabular-nums">
                      {formatDuration(item.durationSeconds)}
                    </span>
                  ) : null}
                </div>

                {canEdit ? (
                  <>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move earlier"
                        disabled={index === 0 || pending}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowLeft aria-hidden />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move later"
                        disabled={index === order.length - 1 || pending}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowRight aria-hidden />
                      </Button>
                      <span className="flex-1" />
                      <DeleteMedia
                        storeId={storeId}
                        productId={productId}
                        mediaId={item.id}
                        onDone={() =>
                          setOrder((current) =>
                            current.filter((row) => row.id !== item.id),
                          )
                        }
                      />
                    </div>

                    {/*
                      Images only. The tag table's foreign key is to an image
                      row, and pinning a video to a colour has no storefront
                      behaviour behind it — the gallery swaps photos on an
                      option change, not clips.
                    */}
                    {taggable.length > 0 &&
                    item.kind === "image" &&
                    item.state === "ready" ? (
                      <TagPicker
                        storeId={storeId}
                        productId={productId}
                        image={item}
                        attributes={taggable}
                      />
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function VideoUploadProgress({
  state,
  onCancel,
}: {
  state: ReturnType<typeof useVideoUpload>["state"];
  onCancel: () => void;
}) {
  if (state.status === "idle") return null;

  if (state.status === "error") {
    return (
      <p role="alert" className="text-critical text-sm">
        {state.message}
      </p>
    );
  }

  if (state.status === "processing") {
    return (
      <output className="block text-positive text-sm">
        Uploaded. YouTube is processing it — it will appear here when ready.
      </output>
    );
  }

  const percent = state.status === "uploading" ? state.percent : 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {state.status === "preparing"
            ? "Preparing upload…"
            : state.retrying
              ? `Connection dropped — resuming at ${percent}%`
              : `Uploading… ${percent}%`}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Video upload progress"
      >
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-tertiary-text text-xs">
        Uploading straight to YouTube — leave this tab open until it finishes.
      </p>
    </div>
  );
}

function DeleteMedia({
  storeId,
  productId,
  mediaId,
  onDone,
}: {
  storeId: string;
  productId: string;
  mediaId: string;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Remove"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await deleteProductImageAction({
            storeId,
            productId,
            imageId: mediaId,
          });
          if (result.ok) onDone();
        });
      }}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Trash2 aria-hidden />
      )}
    </Button>
  );
}
