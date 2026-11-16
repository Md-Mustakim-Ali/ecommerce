import { Mark, mergeAttributes, Node } from "@tiptap/core";
import {
  FONT_FAMILIES,
  FONT_FAMILY_VARS,
  type FontFamily,
  HEX_COLOR,
  HIGHLIGHTS,
  type Highlight,
  highlightValue,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TEXT_COLORS,
  type TextColor,
  textColorValue,
} from "./schema";

/**
 * TipTap extensions matching the stored document schema.
 *
 * The editor's output is validated on the server against
 * lib/rich-text/schema.ts, so these definitions and that zod schema have to
 * describe the same vocabulary. Anything the editor can produce that the schema
 * rejects becomes a save that fails with no way for the seller to find the
 * offending character — which is why the colour options are read from the same
 * constants the validator uses rather than restated here.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      /** Two hex values, one per theme. */
      setCustomTextColor: (light: string, dark: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    highlight: {
      setHighlight: (color: Highlight) => ReturnType;
      setCustomHighlight: (light: string, dark: string) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
    fontFamily: {
      setFontFamily: (family: FontFamily) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
    fontSize: {
      setFontSize: (size: number) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    media: {
      insertMedia: (attrs: {
        mediaId: string;
        caption?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * Text colour, named or custom.
 *
 * A named colour stores a token — "critical", not "#b3261e" — and resolves to
 * a CSS variable that already carries both a light and a dark value. It is the
 * default because the seller cannot get it wrong.
 *
 * A custom colour stores two hex values and renders light-dark(), the same
 * mechanism the tokens use. Asking for both is what keeps the escape hatch
 * safe: a single hex would look right in the editor and disappear for
 * dark-mode buyers, and the seller would never find out.
 */
export const TextColorMark = Mark.create({
  name: "textColor",

  addAttributes() {
    return {
      // A named token. Null when the seller chose their own pair.
      color: {
        default: null as TextColor | null,
        parseHTML: (element) => element.getAttribute("data-color"),
        renderHTML: () => ({}),
      },
      light: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-light"),
        renderHTML: () => ({}),
      },
      dark: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-dark"),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-color]" }, { tag: "span[data-light]" }];
  },

  /**
   * Built here rather than per-attribute, because the inline style depends on
   * the combination: a token renders a CSS variable, a pair renders
   * light-dark(). Splitting that across three renderHTML callbacks would emit
   * a half-formed style for whichever attribute ran last.
   */
  renderHTML({ mark }) {
    // mark.attrs, not HTMLAttributes. The latter holds what the per-attribute
    // renderHTML callbacks contributed, and those deliberately contribute
    // nothing because the style depends on the combination — reading it here
    // yields an empty object and a span with no colour at all.
    const attrs = mark.attrs as {
      color?: TextColor | null;
      light?: string | null;
      dark?: string | null;
    };

    const style = textColorValue(attrs);
    if (!style) return ["span", {}, 0];

    const marker =
      attrs.light && attrs.dark
        ? { "data-light": attrs.light, "data-dark": attrs.dark }
        : { "data-color": attrs.color as string };

    return ["span", mergeAttributes(marker, { style: `color: ${style}` }), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) => {
          if (!TEXT_COLORS.includes(color)) return false;
          // "default" is the absence of a colour, not a colour. Storing it as
          // a mark would litter the document with spans that do nothing.
          if (color === "default") return commands.unsetMark(this.name);
          return commands.setMark(this.name, {
            color,
            light: null,
            dark: null,
          });
        },
      setCustomTextColor:
        (light, dark) =>
        ({ commands }) => {
          // Validated here as well as on the server: the editor is the last
          // place a malformed value can be caught while the seller is still
          // looking at the field that produced it.
          if (!HEX_COLOR.test(light) || !HEX_COLOR.test(dark)) return false;
          return commands.setMark(this.name, { color: null, light, dark });
        },
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/**
 * Text background, named or custom.
 *
 * The named ones are the muted halves of the design tokens, chosen so ordinary
 * body text stays legible on top of them in both themes. A custom pair is the
 * seller's own, and the picker previews text on it for the same reason the
 * text-colour one does.
 */
export const HighlightMark = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: {
        default: null as Highlight | null,
        parseHTML: (element) => element.getAttribute("data-highlight"),
        renderHTML: () => ({}),
      },
      light: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-light"),
        renderHTML: () => ({}),
      },
      dark: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-dark"),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark[data-highlight]" }, { tag: "mark[data-light]" }];
  },

  // mark.attrs, not HTMLAttributes — see TextColorMark for why.
  renderHTML({ mark }) {
    const attrs = mark.attrs as {
      color?: Highlight | null;
      light?: string | null;
      dark?: string | null;
    };

    const background = highlightValue(attrs);
    if (!background) return ["mark", {}, 0];

    const marker =
      attrs.light && attrs.dark
        ? { "data-light": attrs.light, "data-dark": attrs.dark }
        : { "data-highlight": attrs.color as string };

    return [
      "mark",
      mergeAttributes(marker, {
        style: `background-color: ${background}; color: inherit`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) => {
          if (!HIGHLIGHTS.includes(color)) return false;
          return commands.setMark(this.name, {
            color,
            light: null,
            dark: null,
          });
        },
      setCustomHighlight:
        (light, dark) =>
        ({ commands }) => {
          if (!HEX_COLOR.test(light) || !HEX_COLOR.test(dark)) return false;
          return commands.setMark(this.name, { color: null, light, dark });
        },
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/**
 * Type family.
 *
 * Three options, all already loaded or system-provided. See
 * lib/rich-text/schema.ts for why this is not a free-text font name.
 */
export const FontFamilyMark = Mark.create({
  name: "fontFamily",

  addAttributes() {
    return {
      family: {
        default: "default" as FontFamily,
        parseHTML: (element) => element.getAttribute("data-font"),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-font]" }];
  },

  renderHTML({ mark }) {
    const family = mark.attrs.family as FontFamily;
    if (!FONT_FAMILIES.includes(family) || family === "default") {
      return ["span", {}, 0];
    }
    return [
      "span",
      mergeAttributes(
        { "data-font": family },
        { style: `font-family: ${FONT_FAMILY_VARS[family]}` },
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setFontFamily:
        (family) =>
        ({ commands }) => {
          if (!FONT_FAMILIES.includes(family)) return false;
          // "default" is the absence of a font, not a font.
          if (family === "default") return commands.unsetMark(this.name);
          return commands.setMark(this.name, { family });
        },
      unsetFontFamily:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/**
 * Text size.
 *
 * Clamped rather than rejected when out of range: a seller dragging a slider
 * or holding an arrow key should hit the end and stop, not have the command
 * quietly fail and leave them wondering which keystroke did nothing.
 */
export const FontSizeMark = Mark.create({
  name: "fontSize",

  addAttributes() {
    return {
      size: {
        default: null as number | null,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-size");
          return raw ? Number(raw) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-size]" }];
  },

  renderHTML({ mark }) {
    const size = mark.attrs.size as number | null;
    if (!size || !Number.isFinite(size)) return ["span", {}, 0];
    return [
      "span",
      mergeAttributes(
        { "data-size": String(size) },
        { style: `font-size: ${size}px` },
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ commands }) => {
          if (!Number.isFinite(size)) return false;
          const clamped = Math.min(
            MAX_FONT_SIZE,
            Math.max(MIN_FONT_SIZE, Math.round(size)),
          );
          return commands.setMark(this.name, { size: clamped });
        },
      unsetFontSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/**
 * An embedded asset, stored as a reference to a product_images row.
 *
 * `atom: true` because the node has no editable content — the seller
 * manipulates the asset, not its innards. That also makes it a single
 * backspace to delete, which is what anyone expects of a block they inserted
 * as one thing.
 *
 * The node deliberately carries no URL. Resolving the id at render time is
 * what keeps an embed subject to the same readiness rules as a gallery photo:
 * an asset that is still transcoding, or has since been deleted at Google,
 * simply does not resolve and does not render.
 */
export const MediaNodeExtension = Node.create({
  name: "media",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-media-id"),
        renderHTML: (attributes) => ({
          "data-media-id": attributes.mediaId,
        }),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-media-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      insertMedia:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { mediaId: attrs.mediaId, caption: attrs.caption ?? null },
          }),
    };
  },
});
