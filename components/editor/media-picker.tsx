"use client";

import { Film, ImagePlus, Link2, Loader2, Upload, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVideoUpload } from "./use-video-upload";

/**
 * Choosing what to embed in a description.
 *
 * Two routes, and the order is not cosmetic. A pasted link comes first because
 * for video it costs a single quota unit against a project's ten thousand,
 * where uploading costs 1,600 — a sixth of a seller's day for one clip they
 * very likely already have on their channel.
 *
 * Each route takes both kinds. The link field sends a YouTube address to the
 * seller's channel and any other image address into their Drive; the drop zone
 * routes on the file's own type. "Insert media" is one intention, and which
 * kind it is is a question the address or the file already answers.
 *
 * Whichever route is taken the result is the same product_images row, gated,
 * swept and deleted identically.
 */

export type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  productId: string;
  onUploadImage: (
    file: File,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  onAttachVideo: (
    url: string,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  onInserted: (mediaId: string) => void;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function MediaPicker({
  open,
  onOpenChange,
  storeId,
  productId,
  onUploadImage,
  onAttachVideo,
  onInserted,
}: MediaPickerProps) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const videoUpload = useVideoUpload({
    storeId,
    productId,
    placement: "description",
    onComplete: (mediaId) => {
      reset();
      onInserted(mediaId);
    },
  });

  const busy =
    pending ||
    videoUpload.state.status === "uploading" ||
    videoUpload.state.status === "preparing";

  function reset() {
    setLink("");
    setError(null);
    setDragging(false);
  }

  /** Routes on the file's own type, so one zone serves both. */
  function accept(file: File) {
    setError(null);

    if (file.type.startsWith("video/")) {
      videoUpload.upload(file);
      return;
    }

    if (!IMAGE_TYPES.includes(file.type)) {
      setError("That file is neither an image nor a video.");
      return;
    }

    startTransition(async () => {
      const result = await onUploadImage(file);
      if (result.ok && result.mediaId) {
        reset();
        onInserted(result.mediaId);
      } else {
        setError(result.message);
      }
    });
  }

  function attachLink() {
    const trimmed = link.trim();
    if (!trimmed) {
      setError("Paste a link first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onAttachVideo(trimmed);
      if (result.ok && result.mediaId) {
        reset();
        onInserted(result.mediaId);
      } else {
        setError(result.message);
      }
    });
  }

  const uploading = videoUpload.state;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Insert media</DialogTitle>
          <DialogDescription>
            Photos go to your connected Google Drive. Videos are hosted on your
            YouTube channel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label
              htmlFor="media-link"
              className="flex items-center gap-1.5 text-xs"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Paste a link
            </Label>
            <div className="flex gap-2">
              <Input
                id="media-link"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    attachLink();
                  }
                }}
                placeholder="YouTube link or image address"
                disabled={busy}
              />
              <Button type="button" onClick={attachLink} disabled={busy}>
                Add
              </Button>
            </div>
            <p className="text-tertiary-text text-xs">
              A YouTube link costs 1 quota unit — set the video to{" "}
              <strong>unlisted</strong>, since private ones cannot be embedded.
              An image address is copied into your Drive rather than linked, so
              it cannot break if the original moves.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-tertiary-text text-xs">or upload</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {uploading.status === "uploading" ||
          uploading.status === "preparing" ? (
            <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {uploading.status === "preparing"
                    ? "Preparing upload…"
                    : uploading.retrying
                      ? `Connection dropped — resuming at ${uploading.percent}%`
                      : `Uploading to YouTube… ${uploading.percent}%`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={videoUpload.cancel}
                  aria-label="Cancel upload"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuenow={
                  uploading.status === "uploading" ? uploading.percent : 0
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Video upload progress"
              >
                <div
                  className="h-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${uploading.status === "uploading" ? uploading.percent : 0}%`,
                  }}
                />
              </div>
              <p className="text-tertiary-text text-xs">
                Going straight to YouTube — keep this tab open.
              </p>
            </div>
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                accept={[...IMAGE_TYPES, "video/*"].join(",")}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) accept(file);
                  // Cleared so choosing the same file twice still fires change.
                  event.target.value = "";
                }}
              />

              {/*
                A real drop target rather than a bare file input. Dragging a
                photo in is what people try first, and the native control both
                refuses it and looks like nothing else in this interface.
              */}
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) accept(file);
                }}
                className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors disabled:opacity-50 ${
                  dragging
                    ? "border-accent bg-accent-muted/40"
                    : "border-border-strong hover:border-accent hover:bg-surface-2"
                }`}
              >
                {pending ? (
                  <Loader2
                    className="h-5 w-5 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <ImagePlus className="h-5 w-5" aria-hidden />
                    <Film className="h-5 w-5" aria-hidden />
                  </span>
                )}
                <span className="font-medium text-sm">
                  {pending ? "Uploading…" : "Drop a photo or video here"}
                </span>
                <span className="flex items-center gap-1 text-tertiary-text text-xs">
                  <Upload className="h-3 w-3" aria-hidden />
                  or click to choose a file
                </span>
                <span className="text-tertiary-text text-xs">
                  JPEG, PNG, WebP or AVIF up to 8 MB · video of any length
                </span>
              </button>
            </>
          )}

          {uploading.status === "error" ? (
            <p role="alert" className="text-critical text-sm">
              {uploading.message}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
