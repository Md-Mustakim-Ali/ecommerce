import { z } from "zod";

/**
 * The product description document.
 *
 * Stored as JSON rather than HTML, for two reasons that both matter.
 *
 * The first is the readiness gate. A description can embed a Drive image or a
 * YouTube video, and those are subject to exactly the same rule as the gallery
 * — a product must not publish while one of them is still transcoding. That is
 * only checkable if an embed is a node holding a media id, so the gate can
 * join. An `<iframe>` inside an HTML blob is opaque, and the product would go
 * live with a "processing" box in the middle of its description.
 *
 * The second is that seller-supplied HTML is an XSS vector, and sanitising it
 * correctly is a permanent arms race. A closed node vocabulary validated on
 * write has no such problem: anything not in this schema is rejected at the
 * door, and rendering never goes near dangerouslySetInnerHTML.
 *
 * The shape is ProseMirror's, which is what TipTap reads and writes natively,
 * so the editor needs no translation layer. It is a deliberately small subset
 * of ProseMirror rather than whatever the editor happens to emit.
 */

/**
 * Links are the one place a document can carry a URL, so this is the one place
 * an injection can enter. `javascript:` and `data:` are the classic payloads.
 */
const safeHref = z.string().refine(
  (value) => {
    try {
      const url = new URL(value, "https://placeholder.invalid");
      return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
      return false;
    }
  },
  { message: "Links must be http, https or mailto." },
);

/**
 * Text colours are semantic names, never hex.
 *
 * A seller picking `#1a1a1a` because it looked right in the light editor has
 * just made their description unreadable for every buyer browsing in dark
 * mode, and they will never see it happen. There is no way to store a raw
 * colour that does not have that failure.
 *
 * Every token here resolves through app/globals.css, where each is declared
 * with light-dark() and therefore carries both values already. The seller
 * picks a meaning — "this is a warning" — and both themes are correct by
 * construction rather than by the seller checking.
 */
export const TEXT_COLORS = [
  "default",
  "muted",
  "accent",
  "positive",
  "critical",
] as const;

export type TextColor = (typeof TEXT_COLORS)[number];

/** token -> the CSS custom property it renders as. */
export const TEXT_COLOR_VARS: Record<TextColor, string> = {
  default: "var(--color-foreground)",
  muted: "var(--color-muted-foreground)",
  accent: "var(--color-accent-text)",
  positive: "var(--color-positive)",
  critical: "var(--color-critical)",
};

export const HIGHLIGHTS = ["accent", "positive", "critical"] as const;

export type Highlight = (typeof HIGHLIGHTS)[number];

/** Muted variants, so text on top of them stays legible in both themes. */
export const HIGHLIGHT_VARS: Record<Highlight, string> = {
  accent: "var(--color-accent-muted)",
  positive: "var(--color-positive-muted)",
  critical: "var(--color-critical-muted)",
};

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({
    type: z.literal("textColor"),
    attrs: z.object({ color: z.enum(TEXT_COLORS) }),
  }),
  z.object({
    type: z.literal("highlight"),
    attrs: z.object({ color: z.enum(HIGHLIGHTS) }),
  }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({ href: safeHref }),
  }),
]);

export type Mark = z.infer<typeof markSchema>;

const inlineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    marks: z.array(markSchema).max(8).optional(),
  }),
  z.object({ type: z.literal("hardBreak") }),
]);

export type Inline = z.infer<typeof inlineSchema>;

/**
 * Headings start at 2.
 *
 * The product title is the page's h1. A description that can emit its own h1
 * produces two, which is a real accessibility defect rather than a stylistic
 * preference — screen-reader users navigate by heading level.
 */
const headingLevel = z.union([z.literal(2), z.literal(3), z.literal(4)]);

/**
 * An embedded asset, as a reference to a row rather than a URL.
 *
 * This is the single most important decision in the document format, and it is
 * what makes "everything uses the same media pipeline" true rather than
 * aspirational. A description embed is a product_images row exactly like a
 * gallery photo: same upload path through the project/account picker, same
 * readiness states, same failover, same deletion-by-owning-account. Changing
 * how media is stored later changes descriptions along with everything else,
 * because there is only one thing to change.
 *
 * It also covers pasted links without a second mechanism. A seller who pastes
 * a YouTube URL gets a row with provider 'youtube' and the video id, created
 * by a different action but living in the same table and subject to the same
 * gate — so a link to a video that is still processing holds publication
 * exactly as an upload would. An external image URL is ingested through the
 * storage pipeline rather than hotlinked, which keeps next.config.ts's
 * remotePatterns allowlist from having to trust arbitrary hosts.
 */
const mediaNodeSchema = z.object({
  type: z.literal("media"),
  attrs: z.object({
    mediaId: z.uuid(),
    /** Author's caption. Not the alt text — that lives on the media row. */
    caption: z.string().max(300).nullish(),
  }),
});

export type MediaNode = z.infer<typeof mediaNodeSchema>;

// Recursive: a list item holds blocks, and one of those can be a list.
type BlockInput =
  | { type: "paragraph"; content?: unknown[] }
  | { type: "heading"; attrs: { level: number }; content?: unknown[] }
  | { type: "bulletList"; content: unknown[] }
  | { type: "orderedList"; content: unknown[] }
  | { type: "blockquote"; content: unknown[] }
  | { type: "horizontalRule" }
  | { type: "media"; attrs: { mediaId: string; caption?: string | null } };

const blockSchema: z.ZodType<Block, BlockInput> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("paragraph"),
      content: z.array(inlineSchema).optional(),
    }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({ level: headingLevel }),
      content: z.array(inlineSchema).optional(),
    }),
    z.object({
      type: z.literal("bulletList"),
      content: z.array(listItemSchema),
    }),
    z.object({
      type: z.literal("orderedList"),
      content: z.array(listItemSchema),
    }),
    z.object({ type: z.literal("blockquote"), content: z.array(blockSchema) }),
    z.object({ type: z.literal("horizontalRule") }),
    mediaNodeSchema,
  ]),
) as z.ZodType<Block, BlockInput>;

const listItemSchema: z.ZodType<ListItem> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    content: z.array(blockSchema),
  }),
) as z.ZodType<ListItem>;

export type ListItem = { type: "listItem"; content: Block[] };

export type Block =
  | { type: "paragraph"; content?: Inline[] }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content?: Inline[] }
  | { type: "bulletList"; content: ListItem[] }
  | { type: "orderedList"; content: ListItem[] }
  | { type: "blockquote"; content: Block[] }
  | { type: "horizontalRule" }
  | MediaNode;

export const descriptionDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(blockSchema).max(500),
});

export type DescriptionDoc = z.infer<typeof descriptionDocSchema>;

export const EMPTY_DOC: DescriptionDoc = { type: "doc", content: [] };

/**
 * Nesting depth is capped separately from the schema.
 *
 * zod will happily validate a document nested ten thousand deep and then the
 * renderer blows the stack. The limit is generous — a blockquote holding a
 * list holding a paragraph is depth 3 — and anything beyond it is a
 * pathological paste rather than a description someone wrote.
 */
const MAX_DEPTH = 8;

function depthOf(blocks: readonly Block[], current = 1): number {
  let deepest = current;
  for (const block of blocks) {
    if (block.type === "blockquote") {
      deepest = Math.max(deepest, depthOf(block.content, current + 1));
    } else if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.content) {
        deepest = Math.max(deepest, depthOf(item.content, current + 1));
      }
    }
  }
  return deepest;
}

export type ParseResult =
  | { ok: true; doc: DescriptionDoc }
  | { ok: false; error: string };

/**
 * Validates a document coming from a seller.
 *
 * Never trust the editor to have produced something well-formed — the payload
 * arrives over the wire and a request can be crafted by hand.
 */
export function parseDescriptionDoc(value: unknown): ParseResult {
  const parsed = descriptionDocSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid description.",
    };
  }

  if (depthOf(parsed.data.content) > MAX_DEPTH) {
    return { ok: false, error: "Description is nested too deeply." };
  }

  return { ok: true, doc: parsed.data };
}

/**
 * Every media id the document embeds, in order, without duplicates.
 *
 * This is what makes the readiness gate work over descriptions: the publish
 * check unions these with the gallery's assets and refuses while any of them
 * is still settling.
 */
export function extractMediaIds(doc: DescriptionDoc): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (block.type === "media") {
        if (!seen.has(block.attrs.mediaId)) {
          seen.add(block.attrs.mediaId);
          found.push(block.attrs.mediaId);
        }
      } else if (block.type === "blockquote") {
        walk(block.content);
      } else if (block.type === "bulletList" || block.type === "orderedList") {
        for (const item of block.content) walk(item.content);
      }
    }
  };

  walk(doc.content);
  return found;
}

/**
 * Flattens to plain text.
 *
 * products.description stays a real text column because products.search_vector
 * is a generated column over it, and a generated column cannot reach into
 * jsonb. Keeping a flattened mirror in sync on every write is what stops rich
 * descriptions from silently disappearing out of search results.
 */
export function flattenToText(doc: DescriptionDoc): string {
  const parts: string[] = [];

  const inline = (nodes: readonly Inline[] | undefined): string =>
    (nodes ?? [])
      .map((node) => (node.type === "text" ? node.text : " "))
      .join("");

  const walk = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      switch (block.type) {
        case "paragraph":
        case "heading":
          parts.push(inline(block.content));
          break;
        case "blockquote":
          walk(block.content);
          break;
        case "bulletList":
        case "orderedList":
          for (const item of block.content) walk(item.content);
          break;
        case "media":
          if (block.attrs.caption) parts.push(block.attrs.caption);
          break;
        case "horizontalRule":
          break;
      }
    }
  };

  walk(doc.content);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** True when the document has no text and no media — an untouched editor. */
export function isEmptyDoc(doc: DescriptionDoc): boolean {
  return flattenToText(doc).length === 0 && extractMediaIds(doc).length === 0;
}
