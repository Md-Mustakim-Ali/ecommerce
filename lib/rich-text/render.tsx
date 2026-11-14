import Image from "next/image";
import type { ReactNode } from "react";
import { VideoEmbed } from "@/components/shop/video-embed";
import {
  type Block,
  type DescriptionDoc,
  HIGHLIGHT_VARS,
  type Inline,
  type ListItem,
  type Mark,
  TEXT_COLOR_VARS,
} from "./schema";

/**
 * Renders a description document to React.
 *
 * Node by node, never through dangerouslySetInnerHTML. The document was
 * validated on write against a closed vocabulary, and rendering it
 * structurally means a node type that somehow got past that still cannot
 * become markup — it just does not render. Two independent defences rather
 * than one.
 *
 * Media is resolved from rows passed in rather than fetched here, so the page
 * makes one query for a product's assets and both the gallery and the
 * description read from it.
 */

export type RenderableMedia = {
  id: string;
  kind: "image" | "video";
  provider: "managed" | "drive" | "youtube";
  url: string | null;
  providerRef: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  durationSeconds: number | null;
};

/** One mark, wrapped around whatever it applies to. */
function wrapMark(wrapped: ReactNode, mark: Mark): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong>{wrapped}</strong>;
    case "italic":
      return <em>{wrapped}</em>;
    case "strike":
      return <s>{wrapped}</s>;
    case "code":
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {wrapped}
        </code>
      );
    case "textColor":
      // A CSS variable, so the value is whatever the active theme resolves it
      // to. Storing a literal here is what breaks dark mode.
      return (
        <span style={{ color: TEXT_COLOR_VARS[mark.attrs.color] }}>
          {wrapped}
        </span>
      );
    case "highlight":
      return (
        <mark
          className="rounded px-0.5"
          style={{
            backgroundColor: HIGHLIGHT_VARS[mark.attrs.color],
            color: "inherit",
          }}
        >
          {wrapped}
        </mark>
      );
    case "link":
      return (
        <a
          href={mark.attrs.href}
          // Seller-authored links point off-site. noopener stops the target
          // reaching back through window.opener; nofollow keeps the store from
          // vouching for wherever it goes.
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline decoration-accent-text/50 underline-offset-2 transition-colors hover:decoration-accent-text"
        >
          {wrapped}
        </a>
      );
  }
}

function applyMarks(
  node: ReactNode,
  marks: readonly Mark[] | undefined,
): ReactNode {
  if (!marks || marks.length === 0) return node;

  // Backwards, so the first mark in the array ends up outermost.
  let wrapped = node;
  for (let i = marks.length - 1; i >= 0; i--) {
    wrapped = wrapMark(wrapped, marks[i]);
  }
  return wrapped;
}

function renderInline(nodes: readonly Inline[] | undefined): ReactNode[] {
  const out: ReactNode[] = [];

  for (const [index, node] of (nodes ?? []).entries()) {
    // Index keys: the document is immutable within a render and has no stable
    // per-node identity to use instead.
    const key = `${node.type}-${index}`;
    out.push(
      node.type === "hardBreak" ? (
        <br key={key} />
      ) : (
        <span key={key}>{applyMarks(node.text, node.marks)}</span>
      ),
    );
  }

  return out;
}

function MediaBlock({
  node,
  media,
}: {
  node: Extract<Block, { type: "media" }>;
  media: ReadonlyMap<string, RenderableMedia>;
}) {
  const asset = media.get(node.attrs.mediaId);

  // Absent means the row was not ready, or was deleted. Rendering nothing is
  // deliberate: the caller only passes assets a buyer may see, so an embed
  // that is still transcoding leaves a gap rather than a broken box. The
  // publish gate is what stops a product reaching a buyer in that state at
  // all; this is the second line of defence for an asset that broke later.
  if (!asset) return null;

  const caption = node.attrs.caption?.trim();

  let body: ReactNode = null;
  if (asset.kind === "video" && asset.provider === "youtube") {
    if (asset.providerRef) {
      body = (
        <VideoEmbed
          videoId={asset.providerRef}
          title={asset.alt ?? caption ?? "Product video"}
          posterUrl={asset.url}
          blurDataUrl={asset.blurDataUrl}
          durationSeconds={asset.durationSeconds}
        />
      );
    }
  } else if (asset.url) {
    body = (
      <Image
        src={asset.url}
        alt={asset.alt ?? ""}
        width={asset.width ?? 1200}
        height={asset.height ?? 800}
        sizes="(max-width: 768px) 100vw, 720px"
        placeholder={asset.blurDataUrl ? "blur" : "empty"}
        blurDataURL={asset.blurDataUrl ?? undefined}
        className="h-auto w-full rounded-lg"
      />
    );
  }

  if (!body) return null;

  return (
    <figure className="my-6">
      {body}
      {caption ? (
        <figcaption className="mt-2 text-center text-muted-foreground text-sm">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function renderBlock(
  block: Block,
  key: string,
  media: ReadonlyMap<string, RenderableMedia>,
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} className="my-4 leading-relaxed">
          {renderInline(block.content)}
        </p>
      );

    case "heading": {
      // Starts at h2 — the product title owns the page's h1, and a second one
      // breaks heading navigation for screen-reader users.
      const Tag = (["h2", "h3", "h4"] as const)[block.attrs.level - 2];
      const size = ["text-xl", "text-lg", "text-base"][block.attrs.level - 2];
      return (
        <Tag key={key} className={`mt-8 mb-3 font-semibold ${size}`}>
          {renderInline(block.content)}
        </Tag>
      );
    }

    case "bulletList":
      return (
        <ul key={key} className="my-4 list-disc space-y-1 pl-6">
          {renderListItems(block.content, media, key)}
        </ul>
      );

    case "orderedList":
      return (
        <ol key={key} className="my-4 list-decimal space-y-1 pl-6">
          {renderListItems(block.content, media, key)}
        </ol>
      );

    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-4 border-accent-muted border-l-2 pl-4 text-muted-foreground italic"
        >
          {renderBlocks(block.content, media, key)}
        </blockquote>
      );

    case "horizontalRule":
      return <hr key={key} className="my-8 border-border" />;

    case "media":
      return <MediaBlock key={key} node={block} media={media} />;
  }
}

function renderBlocks(
  blocks: readonly Block[],
  media: ReadonlyMap<string, RenderableMedia>,
  keyPrefix = "b",
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [index, block] of blocks.entries()) {
    out.push(renderBlock(block, `${keyPrefix}-${block.type}-${index}`, media));
  }
  return out;
}

function renderListItems(
  items: readonly ListItem[],
  media: ReadonlyMap<string, RenderableMedia>,
  keyPrefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [index, item] of items.entries()) {
    const key = `${keyPrefix}-li-${index}`;
    out.push(
      <li key={key} className="[&>p]:my-0">
        {renderBlocks(item.content, media, key)}
      </li>,
    );
  }
  return out;
}

export function RichText({
  doc,
  media,
  className,
}: {
  doc: DescriptionDoc;
  /** Only assets a buyer may see. Anything absent renders as nothing. */
  media: ReadonlyMap<string, RenderableMedia>;
  className?: string;
}) {
  if (doc.content.length === 0) return null;

  return <div className={className}>{renderBlocks(doc.content, media)}</div>;
}
