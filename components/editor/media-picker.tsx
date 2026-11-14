"use client";

import { Film, Loader2, Upload } from "lucide-react";
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

/**
 * Choosing what to embed in a description.
 *
 * Two routes, and the order matters: pasting a YouTube link is first because
 * it is the one that costs a single quota unit instead of 1,600. A seller who
 * uploads through the app burns a sixth of their day's allowance per video,
 * and most of them already have the clip on their channel.
 *
 * Both routes end in the same product_images row, so whichever they pick, the
 * asset is gated, swept and deleted identically.
 */

export type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadImage: (
    file: File,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  onAttachVideo: (
    url: string,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  onInserted: (mediaId: string) => void;
};

export function MediaPicker({
  open,
  onOpenChange,
  onUploadImage,
  onAttachVideo,
  onInserted,
}: MediaPickerProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setVideoUrl("");
    setError(null);
  }

  function handleFile(file: File) {
    setError(null);
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

  function handleVideo() {
    const trimmed = videoUrl.trim();
    if (!trimmed) {
      setError("Paste a YouTube link first.");
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

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="video-url" className="flex items-center gap-1.5">
              <Film className="h-4 w-4" />
              Paste a YouTube link
            </Label>
            <div className="flex gap-2">
              <Input
                id="video-url"
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleVideo();
                  }
                }}
                placeholder="https://youtu.be/…"
                disabled={pending}
              />
              <Button type="button" onClick={handleVideo} disabled={pending}>
                Add
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Set the video to <strong>unlisted</strong> on YouTube — private
              videos cannot be embedded.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-xs">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="media-file" className="flex items-center gap-1.5">
              <Upload className="h-4 w-4" />
              Upload a photo
            </Label>
            <input
              ref={fileInput}
              id="media-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
                // Cleared so choosing the same file twice still fires change.
                event.target.value = "";
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-sm hover:file:bg-secondary/80"
            />
            <p className="text-muted-foreground text-xs">
              JPEG, PNG, WebP or AVIF, up to 8 MB.
            </p>
          </div>

          {pending ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working…
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
