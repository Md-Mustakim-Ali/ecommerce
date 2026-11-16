"use client";

import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Baseline,
  Bold,
  Code,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FontFamilyMark,
  FontSizeMark,
  HighlightMark,
  MediaNodeExtension,
  TextColorMark,
} from "@/lib/rich-text/extensions";
import {
  type DescriptionDoc,
  type FontFamily,
  HIGHLIGHT_VARS,
  HIGHLIGHTS,
  type Highlight,
  parseDescriptionDoc,
  TEXT_COLOR_VARS,
  TEXT_COLORS,
  type TextColor,
} from "@/lib/rich-text/schema";
import { CustomColorPicker } from "./color-picker";
import { FontPicker } from "./font-picker";
import { type EditorMedia, MediaProvider } from "./media-context";
import { MediaNodeView } from "./media-node-view";
import { MediaPicker } from "./media-picker";
import { FontSizePicker } from "./size-picker";

/**
 * The product description editor.
 *
 * Constrained on purpose. The toolbar offers exactly what
 * lib/rich-text/schema.ts will accept and nothing else, because a button that
 * produces a node the server rejects is a save that fails with no way for the
 * seller to find the offending character.
 *
 * Colour is one control opening one panel: the theme's named colours, a preset
 * palette, and a custom picker. Whichever route the seller takes, the result
 * carries a value for both themes — the named ones because the design tokens
 * already do, and a custom one because the picker derives its dark counterpart
 * unless the seller overrides it. A single hex chosen in the light editor is
 * exactly how a description becomes invisible to half the buyers, and no path
 * through this toolbar can produce one. Highlight works the same way, with its
 * preview flipped: what matters there is whether text stays readable ON the
 * colour, not the colour against the page.
 *
 * The font control offers a searchable catalogue with every option set in the
 * face it names, because the whole decision is what the letters look like. It
 * is a fixed list rather than a text box: a typed-in font name would load an
 * arbitrary web font for every buyer, or fall back to something the seller
 * cannot see is wrong from a machine where the font is installed.
 */

export type RichTextEditorProps = {
  value: DescriptionDoc | null;
  onChange: (doc: DescriptionDoc) => void;
  media: ReadonlyMap<string, EditorMedia>;
  /** Needed by the media picker to start an upload of its own. */
  storeId: string;
  productId: string;
  /** Uploads a file and returns the new row's id. */
  onUploadImage: (
    file: File,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  /** Attaches a pasted link — YouTube or an image — and returns the row id. */
  onAttachVideo: (
    url: string,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  disabled?: boolean;
};

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // onMouseDown, not onClick: clicking a toolbar button would otherwise
      // blur the editor first, collapsing the selection the command is
      // supposed to act on.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded transition-colors disabled:opacity-40 ${
        active
          ? "bg-accent-muted text-accent-text"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  media,
  storeId,
  productId,
  onUploadImage,
  onAttachVideo,
  disabled = false,
}: RichTextEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);

  const editor = useEditor({
    // Next renders this on the server first; without it React logs a
    // hydration mismatch for every editor on the page.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Restricted to what the schema accepts. h1 belongs to the product
        // title, and a second one on the page breaks heading navigation.
        heading: { levels: [2, 3, 4] },
        // Not in the stored vocabulary — a seller pasting code into a product
        // description is not a case worth supporting, and allowing it here
        // would produce documents the server refuses.
        codeBlock: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          // Mirrors the server-side check in schema.ts. Belt and braces: this
          // one stops the seller creating it, that one stops it being stored.
          protocols: ["http", "https", "mailto"],
        },
      }),
      TextColorMark,
      HighlightMark,
      FontFamilyMark,
      FontSizeMark,
      MediaNodeExtension.extend({
        addNodeView() {
          return ReactNodeViewRenderer(MediaNodeView);
        },
      }),
    ],
    content: value ?? { type: "doc", content: [] },
    editorProps: {
      attributes: {
        class:
          "prose-none min-h-40 px-3 py-2 outline-none [&_p]:my-2 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-xl [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-lg [&_h4]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-2 [&_blockquote]:border-accent-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_a]:text-accent-text [&_a]:underline",
      },
    },
    onUpdate: ({ editor: instance }) => {
      // Validated before it leaves the editor. TipTap can be extended at
      // runtime and paste handlers can inject nodes, so the component that
      // owns the value should never be handed a shape the server will refuse.
      const parsed = parseDescriptionDoc(instance.getJSON());
      if (parsed.ok) onChange(parsed.doc);
    },
  });

  const insertLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link address", previous ?? "https://");

    // Cancel leaves it alone; clearing the field removes the link. Those are
    // different intents and collapsing them loses one of them.
    if (href === null) return;
    if (href === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href }).run();
  }, [editor]);

  const handleInserted = useCallback(
    (mediaId: string) => {
      editor?.chain().focus().insertMedia({ mediaId }).run();
      setPickerOpen(false);
    },
    [editor],
  );

  /**
   * Everything the toolbar reads, subscribed properly.
   *
   * TipTap v3 stopped re-rendering on every transaction, so reading
   * editor.isActive() straight from render gives whatever was true when the
   * component last happened to render. That is not a subtle staleness: every
   * pressed state, the colour swatches and the font and size labels simply
   * stop tracking the cursor, so the toolbar describes a selection the seller
   * moved away from several keystrokes ago.
   *
   * useEditorState subscribes to the selector and re-renders only when one of
   * these values actually changes, which is both correct and cheaper than the
   * legacy re-render-on-everything flag.
   */
  const toolbar = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      const color = instance.getAttributes("textColor") as {
        color?: TextColor | null;
        light?: string | null;
        dark?: string | null;
      };
      const highlight = instance.getAttributes("highlight") as {
        color?: Highlight | null;
        light?: string | null;
        dark?: string | null;
      };
      const size = instance.getAttributes("fontSize")?.size;

      return {
        bold: instance.isActive("bold"),
        italic: instance.isActive("italic"),
        strike: instance.isActive("strike"),
        code: instance.isActive("code"),
        heading2: instance.isActive("heading", { level: 2 }),
        heading3: instance.isActive("heading", { level: 3 }),
        bulletList: instance.isActive("bulletList"),
        orderedList: instance.isActive("orderedList"),
        blockquote: instance.isActive("blockquote"),
        link: instance.isActive("link"),
        highlightActive: instance.isActive("highlight"),
        textColor: color,
        highlight,
        font: (instance.getAttributes("fontFamily")?.family ??
          "default") as FontFamily,
        size: typeof size === "number" ? size : null,
      };
    },
  });

  const custom =
    toolbar?.textColor.light && toolbar?.textColor.dark
      ? { light: toolbar.textColor.light, dark: toolbar.textColor.dark }
      : null;
  const activeToken = (toolbar?.textColor.color ?? null) as TextColor | null;
  // What each trigger shows: the custom light value, the token's variable, or
  // nothing when the cursor is not inside that mark.
  const textSwatch = custom
    ? custom.light
    : activeToken
      ? TEXT_COLOR_VARS[activeToken]
      : null;

  const customHighlight =
    toolbar?.highlight.light && toolbar?.highlight.dark
      ? { light: toolbar.highlight.light, dark: toolbar.highlight.dark }
      : null;
  const activeHighlight = (toolbar?.highlight.color ??
    null) as Highlight | null;
  const highlightSwatch = customHighlight
    ? customHighlight.light
    : activeHighlight
      ? HIGHLIGHT_VARS[activeHighlight]
      : null;

  const activeFont = toolbar?.font ?? "default";
  const activeSize = toolbar?.size ?? null;

  if (!editor) {
    return (
      <div className="min-h-48 rounded-md border border-border bg-muted/30" />
    );
  }

  return (
    <MediaProvider value={media}>
      <div className="rounded-md border border-border focus-within:border-accent">
        <div className="flex flex-wrap items-center gap-0.5 border-border border-b p-1">
          <ToolbarButton
            label="Bold"
            active={Boolean(toolbar?.bold)}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={Boolean(toolbar?.italic)}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            active={Boolean(toolbar?.strike)}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Inline code"
            active={Boolean(toolbar?.code)}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>

          <span className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            label="Heading"
            active={Boolean(toolbar?.heading2)}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Subheading"
            active={Boolean(toolbar?.heading3)}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bulleted list"
            active={Boolean(toolbar?.bulletList)}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={Boolean(toolbar?.orderedList)}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Quote"
            active={Boolean(toolbar?.blockquote)}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={Boolean(toolbar?.link)}
            onClick={insertLink}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>

          <span className="mx-1 h-5 w-px bg-border" />

          {/*
            One control per mark rather than a row of swatches each. The panel
            behind them holds the theme's named colours, a preset palette and a
            custom picker — keeping swatches out here as well would be the same
            choice offered twice, in two places that could disagree.
          */}
          <span className="relative">
            <button
              type="button"
              // onClick, unlike the formatting buttons. Those apply a command
              // immediately and use onMouseDown+preventDefault to stop the
              // editor losing its selection first. This one only opens a
              // panel, and suppressing mousedown stops the panel's own fields
              // from taking focus. TipTap remembers the selection, and the
              // .focus() in each apply handler restores it.
              onClick={() => {
                setHighlightPickerOpen(false);
                setColorPickerOpen((open) => !open);
              }}
              aria-label="Text colour"
              aria-expanded={colorPickerOpen}
              title="Text colour"
              className="flex h-8 items-center gap-1.5 rounded px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Baseline className="h-4 w-4" />
              <span
                className="h-1 w-4 rounded-full ring-1 ring-foreground/20"
                style={{ background: textSwatch ?? "var(--color-foreground)" }}
              />
            </button>

            {colorPickerOpen ? (
              <CustomColorPicker
                mode="text"
                tokens={TEXT_COLORS}
                tokenVars={TEXT_COLOR_VARS}
                activeToken={activeToken}
                initialLight={custom?.light}
                initialDark={custom?.dark}
                onCancel={() => setColorPickerOpen(false)}
                onClear={() => {
                  editor.chain().focus().unsetTextColor().run();
                  setColorPickerOpen(false);
                }}
                onApplyToken={(token) => {
                  editor
                    .chain()
                    .focus()
                    .setTextColor(token as TextColor)
                    .run();
                  setColorPickerOpen(false);
                }}
                onApply={(light, dark) => {
                  editor.chain().focus().setCustomTextColor(light, dark).run();
                  setColorPickerOpen(false);
                }}
              />
            ) : null}
          </span>

          <span className="relative">
            <button
              type="button"
              onClick={() => {
                setColorPickerOpen(false);
                setHighlightPickerOpen((open) => !open);
              }}
              aria-label="Highlight"
              aria-expanded={highlightPickerOpen}
              title="Highlight"
              className={`flex h-8 items-center gap-1.5 rounded px-2 transition-colors ${
                toolbar?.highlightActive
                  ? "bg-accent-muted text-accent-text"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Highlighter className="h-4 w-4" />
              <span
                className="h-1 w-4 rounded-full ring-1 ring-foreground/20"
                style={{ background: highlightSwatch ?? "var(--color-muted)" }}
              />
            </button>

            {highlightPickerOpen ? (
              <CustomColorPicker
                mode="highlight"
                tokens={HIGHLIGHTS}
                tokenVars={HIGHLIGHT_VARS}
                activeToken={activeHighlight}
                initialLight={customHighlight?.light}
                initialDark={customHighlight?.dark}
                onCancel={() => setHighlightPickerOpen(false)}
                onClear={() => {
                  editor.chain().focus().unsetHighlight().run();
                  setHighlightPickerOpen(false);
                }}
                onApplyToken={(token) => {
                  editor
                    .chain()
                    .focus()
                    .setHighlight(token as Highlight)
                    .run();
                  setHighlightPickerOpen(false);
                }}
                onApply={(light, dark) => {
                  editor.chain().focus().setCustomHighlight(light, dark).run();
                  setHighlightPickerOpen(false);
                }}
              />
            ) : null}
          </span>

          <span className="mx-1 h-5 w-px bg-border" />

          <FontPicker
            value={activeFont}
            onChange={(family) =>
              editor.chain().focus().setFontFamily(family).run()
            }
          />

          <FontSizePicker
            value={activeSize}
            onChange={(size) => editor.chain().focus().setFontSize(size).run()}
            onClear={() => editor.chain().focus().unsetFontSize().run()}
          />

          <span className="mx-1 h-5 w-px bg-border" />

          {/*
            onClick, unlike the formatting buttons above.

            Those use onMouseDown+preventDefault to stop the editor losing its
            selection before the command runs. This one opens a dialog, which
            has to take focus — suppressing mousedown fights that, and the
            insertion point is restored by .focus() when the dialog closes
            anyway.
          */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon className="h-4 w-4" />
            Insert media
          </Button>
        </div>

        <EditorContent editor={editor} />
      </div>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        storeId={storeId}
        productId={productId}
        onUploadImage={onUploadImage}
        onAttachVideo={onAttachVideo}
        onInserted={handleInserted}
      />
    </MediaProvider>
  );
}
