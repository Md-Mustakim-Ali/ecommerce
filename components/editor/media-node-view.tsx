"use client";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, Loader2, Play, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEditorMedia } from "./media-context";

/**
 * How an embedded asset looks while the seller is writing.
 *
 * Unlike the storefront renderer, this one shows assets that are NOT ready.
 * That is the whole reason the states exist: the seller needs to see that
 * their video is still transcoding and that the product is waiting on it. The
 * buyer never sees any of this — the storefront is passed only ready assets
 * and silently skips the rest.
 */
export function MediaNodeView({
  node,
  deleteNode,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const mediaId = node.attrs.mediaId as string | null;
  const caption = node.attrs.caption as string | null;
  const asset = useEditorMedia(mediaId);

  const frame = `relative overflow-hidden rounded-lg border transition-colors ${
    selected ? "border-accent ring-2 ring-accent/30" : "border-border"
  }`;

  // The row is gone: deleted from the product, or the account holding it was
  // disconnected. Saying so beats an empty box the seller cannot explain.
  if (!asset) {
    return (
      <NodeViewWrapper className="my-4">
        <div
          className={`${frame} flex items-center justify-between gap-3 bg-muted p-4`}
        >
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <AlertTriangle className="h-4 w-4" />
            This file is no longer attached to the product.
          </span>
          <button
            type="button"
            onClick={deleteNode}
            className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="Remove from description"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  const settling =
    asset.state === "queued" ||
    asset.state === "uploading" ||
    asset.state === "processing";

  const broken = asset.state === "failed" || asset.state === "unavailable";

  return (
    <NodeViewWrapper className="my-4">
      <div className={frame}>
        <div className="relative aspect-video bg-skeleton">
          {asset.url ? (
            <Image
              src={asset.url}
              alt={asset.alt ?? ""}
              fill
              sizes="640px"
              className={`object-cover ${settling ? "opacity-40" : ""}`}
            />
          ) : null}

          {asset.kind === "video" && !settling && !broken ? (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70">
                <Play className="h-5 w-5 translate-x-0.5 fill-white text-white" />
              </span>
            </span>
          ) : null}

          {settling ? (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <span className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {asset.state === "processing"
                  ? "Processing on YouTube…"
                  : "Uploading…"}
              </span>
            </span>
          ) : null}

          {broken ? (
            <span className="absolute inset-0 grid place-items-center bg-critical-muted/80 p-4 text-center">
              <span className="flex flex-col items-center gap-1 text-sm">
                <AlertTriangle className="h-5 w-5" />
                {asset.failureReason ??
                  "This file is not available and will not be shown."}
              </span>
            </span>
          ) : null}

          <button
            type="button"
            onClick={deleteNode}
            className="absolute top-2 right-2 rounded bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-critical"
            aria-label="Remove from description"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <input
          value={caption ?? ""}
          onChange={(event) =>
            updateAttributes({ caption: event.target.value || null })
          }
          placeholder="Add a caption (optional)"
          maxLength={300}
          className="w-full border-border border-t bg-transparent px-3 py-2 text-center text-muted-foreground text-sm outline-none placeholder:text-tertiary-text focus:text-foreground"
        />
      </div>
    </NodeViewWrapper>
  );
}
