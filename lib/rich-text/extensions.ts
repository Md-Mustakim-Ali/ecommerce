import { Mark, mergeAttributes, Node } from "@tiptap/core";
import {
  HIGHLIGHT_VARS,
  HIGHLIGHTS,
  type Highlight,
  TEXT_COLOR_VARS,
  TEXT_COLORS,
  type TextColor,
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
      unsetTextColor: () => ReturnType;
    };
    highlight: {
      setHighlight: (color: Highlight) => ReturnType;
      unsetHighlight: () => ReturnType;
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
 * Semantic text colour.
 *
 * The stored attribute is a name — "critical", not "#b3261e" — and the CSS
 * variable it maps to carries both light and dark values via light-dark(). A
 * seller therefore cannot pick a colour that is legible in the editor and
 * invisible to half their buyers, which is the failure any hex-based colour
 * picker has by construction.
 */
export const TextColorMark = Mark.create({
  name: "textColor",

  addAttributes() {
    return {
      color: {
        default: "default" as TextColor,
        parseHTML: (element) => element.getAttribute("data-color"),
        renderHTML: (attributes) => {
          const color = attributes.color as TextColor;
          if (!TEXT_COLORS.includes(color)) return {};
          return {
            "data-color": color,
            style: `color: ${TEXT_COLOR_VARS[color]}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-color]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
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
          return commands.setMark(this.name, { color });
        },
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const HighlightMark = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: {
        default: "accent" as Highlight,
        parseHTML: (element) => element.getAttribute("data-highlight"),
        renderHTML: (attributes) => {
          const color = attributes.color as Highlight;
          if (!HIGHLIGHTS.includes(color)) return {};
          return {
            "data-highlight": color,
            style: `background-color: ${HIGHLIGHT_VARS[color]}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark[data-highlight]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) => {
          if (!HIGHLIGHTS.includes(color)) return false;
          return commands.setMark(this.name, { color });
        },
      unsetHighlight:
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
