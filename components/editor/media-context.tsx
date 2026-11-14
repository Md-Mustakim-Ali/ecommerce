"use client";

import { createContext, useContext } from "react";

/**
 * What the editor knows about a product's media.
 *
 * The document stores only ids, so the node view needs somewhere to resolve
 * them. React context rather than a prop because the node view is mounted by
 * ProseMirror, not by us — there is no JSX call site to thread a prop through.
 */

export type EditorMedia = {
  id: string;
  kind: "image" | "video";
  provider: "managed" | "drive" | "youtube";
  url: string | null;
  providerRef: string | null;
  alt: string | null;
  state:
    | "queued"
    | "uploading"
    | "processing"
    | "ready"
    | "failed"
    | "unavailable";
  failureReason: string | null;
};

const MediaContext = createContext<ReadonlyMap<string, EditorMedia>>(new Map());

export const MediaProvider = MediaContext.Provider;

export function useEditorMedia(mediaId: string | null): EditorMedia | null {
  const media = useContext(MediaContext);
  if (!mediaId) return null;
  return media.get(mediaId) ?? null;
}
