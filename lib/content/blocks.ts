import { z } from "zod";

/**
 * The block vocabulary.
 *
 * Same discipline as the permission vocabulary: block types are defined in
 * code, and each one owns a Zod schema that validates its JSONB payload.
 * Storing block content as JSONB means adding a block type is a schema file
 * rather than a migration, but it also means nothing validates the shape
 * unless we do — so every read and every write parses.
 *
 * A block whose stored data no longer matches its schema is skipped at render
 * rather than crashing the page. Content edited months ago must not be able to
 * take a storefront down.
 */

const href = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      value.startsWith("/") ||
      value.startsWith("https://") ||
      value.startsWith("mailto:"),
    // Blocks are authored by sellers. Without this, `javascript:` in a CTA is
    // stored XSS on a page we render for every buyer.
    { message: "Links must be relative, https, or mailto" },
  );

const tone = z.enum(["neutral", "accent", "positive", "critical"]);

export const blockSchemas = {
  heading: z.object({
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(2), z.literal(3)]).default(2),
  }),

  richText: z.object({
    // Plain text with paragraph breaks, deliberately not HTML. Accepting HTML
    // from a seller means sanitising it correctly forever.
    body: z.string().trim().min(1).max(8000),
  }),

  banner: z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(400).optional(),
    tone: tone.default("accent"),
    ctaLabel: z.string().trim().max(40).optional(),
    ctaHref: href.optional(),
    dismissible: z.boolean().default(false),
  }),

  offerCard: z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(400).optional(),
    /** Shown as a copyable chip when present. */
    code: z.string().trim().max(40).optional(),
    discountLabel: z.string().trim().max(40).optional(),
    ctaLabel: z.string().trim().max(40).optional(),
    ctaHref: href.optional(),
    imageUrl: z.url().optional(),
  }),

  productGrid: z.object({
    title: z.string().trim().max(120).optional(),
    source: z.enum(["newest", "category", "tag", "brand"]).default("newest"),
    /** Slug for category, tag or brand sources. Ignored for newest. */
    value: z.string().trim().max(120).optional(),
    limit: z.number().int().min(2).max(24).default(8),
  }),

  image: z.object({
    url: z.url(),
    alt: z.string().trim().max(200),
    caption: z.string().trim().max(200).optional(),
  }),

  faq: z.object({
    items: z
      .array(
        z.object({
          question: z.string().trim().min(1).max(200),
          answer: z.string().trim().min(1).max(2000),
        }),
      )
      .min(1)
      .max(20),
  }),

  spacer: z.object({
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
} as const;

export type BlockType = keyof typeof blockSchemas;

export const BLOCK_TYPES = Object.keys(blockSchemas) as BlockType[];

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  richText: "Text",
  banner: "Banner",
  offerCard: "Offer card",
  productGrid: "Product grid",
  image: "Image",
  faq: "FAQ",
  spacer: "Spacer",
};

/** Block types that make sense as a placement injected into an existing page. */
export const PLACEMENT_BLOCK_TYPES: BlockType[] = [
  "banner",
  "offerCard",
  "image",
  "productGrid",
];

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && value in blockSchemas;
}

export type ParsedBlock = {
  id: string;
  type: BlockType;
  data: Record<string, unknown>;
};

/**
 * Validates stored block data.
 *
 * Returns null rather than throwing when the payload no longer matches, so a
 * page with one stale block still renders the rest. The alternative is a whole
 * storefront page 500ing because somebody renamed a field.
 */
export function parseBlock(input: {
  id: string;
  type: string;
  data: unknown;
}): ParsedBlock | null {
  if (!isBlockType(input.type)) return null;
  const result = blockSchemas[input.type].safeParse(input.data ?? {});
  if (!result.success) return null;
  return {
    id: input.id,
    type: input.type,
    data: result.data as Record<string, unknown>,
  };
}

/** Validates a block on the way in. Errors are surfaced to the editor. */
export function validateBlockInput(
  type: string,
  data: unknown,
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string } {
  if (!isBlockType(type))
    return { ok: false, message: `Unknown block: ${type}` };
  const result = blockSchemas[type].safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      message: `${issue.path.join(".") || type}: ${issue.message}`,
    };
  }
  return { ok: true, data: result.data as Record<string, unknown> };
}
