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
 * Text colour comes in two forms, and the difference is who guarantees
 * legibility in dark mode.
 *
 * A NAMED colour is a meaning — "this is a warning" — and resolves through
 * app/globals.css, where every token is declared with light-dark() and so
 * already carries a light value and a corrected dark one. The seller picks
 * once and both themes are right by construction. This is the default because
 * it is the option that cannot go wrong.
 *
 * A CUSTOM colour is two hex values, one per theme, and the seller owns the
 * outcome. Storing a single hex would be the trap: `#1a1a1a` looks right in
 * the light editor and is invisible to every dark-mode buyer, and the seller
 * would never see it happen. Requiring both is what makes "choose anything"
 * safe to offer — the choice is still explicit for each theme, it is simply
 * theirs to make rather than the design system's.
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

/**
 * Six-digit hex only.
 *
 * Deliberately narrow. These values end up in a `style` attribute, and CSS
 * accepts a great deal more than colours there — `url(...)` among them. React
 * does not sanitise style values, so this pattern is the actual boundary
 * rather than a formatting preference.
 */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const hexColor = z
  .string()
  .regex(HEX_COLOR, "Use a 6-digit hex colour such as #1a2b3c.");

export type CustomColor = { light: string; dark: string };

/**
 * What a textColor mark carries.
 *
 * Flat rather than a nested union because TipTap attributes are flat, and a
 * shape the editor cannot express is a shape that silently fails to save.
 * Exactly one of the two forms is populated; the refine below enforces it.
 */
export type TextColorAttrs =
  | { color: TextColor; light?: null; dark?: null }
  | { color?: null; light: string; dark: string };

/** The CSS value a mark renders as, whichever form it took. */
export function textColorValue(attrs: {
  color?: TextColor | null;
  light?: string | null;
  dark?: string | null;
}): string | null {
  if (attrs.light && attrs.dark) {
    // The same mechanism the design tokens use, so a custom colour responds to
    // the theme exactly as a named one does.
    return `light-dark(${attrs.light}, ${attrs.dark})`;
  }
  if (attrs.color && TEXT_COLORS.includes(attrs.color)) {
    return TEXT_COLOR_VARS[attrs.color];
  }
  return null;
}

export const HIGHLIGHTS = ["accent", "positive", "critical", "muted"] as const;

export type Highlight = (typeof HIGHLIGHTS)[number];

/** Muted variants, so text on top of them stays legible in both themes. */
export const HIGHLIGHT_VARS: Record<Highlight, string> = {
  accent: "var(--color-accent-muted)",
  positive: "var(--color-positive-muted)",
  critical: "var(--color-critical-muted)",
  muted: "var(--color-muted)",
};

/** The CSS background a highlight renders as, named or custom. */
export function highlightValue(attrs: {
  color?: Highlight | null;
  light?: string | null;
  dark?: string | null;
}): string | null {
  if (attrs.light && attrs.dark) {
    return `light-dark(${attrs.light}, ${attrs.dark})`;
  }
  if (attrs.color && HIGHLIGHTS.includes(attrs.color)) {
    return HIGHLIGHT_VARS[attrs.color];
  }
  return null;
}

/**
 * The type families a seller may choose from.
 *
 * A closed catalogue rather than a free-text font name. See
 * lib/rich-text/fonts.ts for what that buys and what it costs — the short of
 * it is that a typed-in name either loads an arbitrary web font for every
 * buyer or silently falls back to something the seller cannot see is wrong.
 *
 * `default` and `serif` cost nothing: the first is the store's own face, the
 * second the reader's system serif. Everything else is fetched only when a
 * description actually uses it.
 */
export const FONT_CATALOGUE = [
  {
    id: "default",
    label: "Store default",
    category: "Sans",
    stack: "var(--font-sans)",
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    category: "Sans",
    stack: "var(--font-dm-sans)",
  },
  {
    id: "work-sans",
    label: "Work Sans",
    category: "Sans",
    stack: "var(--font-work-sans)",
  },
  {
    id: "poppins",
    label: "Poppins",
    category: "Sans",
    stack: "var(--font-poppins)",
  },
  {
    id: "montserrat",
    label: "Montserrat",
    category: "Sans",
    stack: "var(--font-montserrat)",
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    category: "Sans",
    stack: "var(--font-space-grotesk)",
  },
  {
    id: "hind-siliguri",
    label: "Hind Siliguri",
    category: "Bengali",
    stack: "var(--font-hind-siliguri)",
  },
  {
    id: "serif",
    label: "System serif",
    category: "Serif",
    stack: "ui-serif, Georgia, Cambria, serif",
  },
  {
    id: "playfair",
    label: "Playfair Display",
    category: "Serif",
    stack: "var(--font-playfair)",
  },
  {
    id: "merriweather",
    label: "Merriweather",
    category: "Serif",
    stack: "var(--font-merriweather)",
  },
  { id: "lora", label: "Lora", category: "Serif", stack: "var(--font-lora)" },
  {
    id: "source-serif",
    label: "Source Serif",
    category: "Serif",
    stack: "var(--font-source-serif)",
  },
  {
    id: "bebas",
    label: "Bebas Neue",
    category: "Display",
    stack: "var(--font-bebas)",
  },
  {
    id: "caveat",
    label: "Caveat",
    category: "Handwriting",
    stack: "var(--font-caveat)",
  },
  {
    id: "mono",
    label: "JetBrains Mono",
    category: "Mono",
    stack: "var(--font-mono)",
  },
] as const;

export const FONT_FAMILIES = FONT_CATALOGUE.map(
  (font) => font.id,
) as unknown as readonly FontFamily[];

export type FontFamily = (typeof FONT_CATALOGUE)[number]["id"];

export const FONT_FAMILY_VARS = Object.fromEntries(
  FONT_CATALOGUE.map((font) => [font.id, font.stack]),
) as Record<FontFamily, string>;

export const FONT_FAMILY_LABELS = Object.fromEntries(
  FONT_CATALOGUE.map((font) => [font.id, font.label]),
) as Record<FontFamily, string>;

/**
 * Text size, in pixels.
 *
 * Pixels because that is the unit sellers think in, and a description is
 * authored against a fixed body size rather than nested inside something that
 * rescales. Stored as a plain number so the renderer decides the unit, not the
 * document.
 *
 * Bounded on both ends. Below 10px text is unreadable on a phone, and above 72
 * a "description" is really a banner and will overflow the column it sits in —
 * neither is a choice worth letting a seller make by accident in a field they
 * cannot preview at buyer width.
 */
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 72;

/** The sizes offered as one click, spanning body copy to a section opener. */
export const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 30, 36, 48] as const;

/** The size a description renders at when no mark says otherwise. */
export const BASE_FONT_SIZE = 14;

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({
    type: z.literal("textColor"),
    attrs: z
      .object({
        color: z.enum(TEXT_COLORS).nullish(),
        light: hexColor.nullish(),
        dark: hexColor.nullish(),
      })
      // One form or the other, never both and never neither. A mark carrying
      // both a token and a hex pair has no defined meaning, and one carrying
      // neither is a span that colours nothing.
      .refine(
        (attrs) => {
          const named = Boolean(attrs.color);
          const custom = Boolean(attrs.light) && Boolean(attrs.dark);
          return named !== custom;
        },
        {
          message:
            "A colour is either a named one or a light/dark pair, not both.",
        },
      ),
  }),
  z.object({
    type: z.literal("highlight"),
    // Same two forms as textColor: a token, or the seller's own pair.
    attrs: z
      .object({
        color: z.enum(HIGHLIGHTS).nullish(),
        light: hexColor.nullish(),
        dark: hexColor.nullish(),
      })
      .refine(
        (attrs) =>
          Boolean(attrs.color) !==
          (Boolean(attrs.light) && Boolean(attrs.dark)),
        {
          message:
            "A highlight is either a named colour or a light/dark pair, not both.",
        },
      ),
  }),
  z.object({
    type: z.literal("fontSize"),
    attrs: z.object({
      size: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE),
    }),
  }),
  z.object({
    type: z.literal("fontFamily"),
    attrs: z.object({
      family: z.enum(
        FONT_CATALOGUE.map((font) => font.id) as unknown as [
          FontFamily,
          ...FontFamily[],
        ],
      ),
    }),
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
