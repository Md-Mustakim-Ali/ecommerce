"use client";

import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
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
  HighlightMark,
  MediaNodeExtension,
  TextColorMark,
} from "@/lib/rich-text/extensions";
import {
  type DescriptionDoc,
  parseDescriptionDoc,
  TEXT_COLOR_VARS,
  TEXT_COLORS,
} from "@/lib/rich-text/schema";
import { type EditorMedia, MediaProvider } from "./media-context";
import { MediaNodeView } from "./media-node-view";
import { MediaPicker } from "./media-picker";

/**
 * The product description editor.
 *
 * Constrained on purpose. The toolbar offers exactly what
 * lib/rich-text/schema.ts will accept and nothing else, because a button that
 * produces a node the server rejects is a save that fails with no way for the
 * seller to find the offending character.
 *
 * The two notable absences are colour pickers and font controls. Colour is a
 * short list of semantic names rather than a wheel, so a description cannot be
 * made unreadable in dark mode; typography belongs to the storefront's design
 * system, not to whoever is writing the copy.
 */

export type RichTextEditorProps = {
  value: DescriptionDoc | null;
  onChange: (doc: DescriptionDoc) => void;
  media: ReadonlyMap<string, EditorMedia>;
  /** Uploads a file and returns the new row's id. */
  onUploadImage: (
    file: File,
  ) => Promise<{ ok: boolean; mediaId?: string; message: string }>;
  /** Attaches a YouTube link and returns the new row's id. */
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
  onUploadImage,
  onAttachVideo,
  disabled = false,
}: RichTextEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

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
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Inline code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>

          <span className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            label="Heading"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Subheading"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bulleted list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Quote"
            active={editor.isActive("blockquote")}
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
            active={editor.isActive("link")}
            onClick={insertLink}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>

          <span className="mx-1 h-5 w-px bg-border" />

          {/*
            A fixed palette of meanings, not a colour wheel. Each swatch is a
            CSS variable declared with light-dark(), so whatever the seller
            picks is legible in both themes — which a hex value never is.
          */}
          {/* A fieldset rather than role="group": the swatches are announced
              as one labelled set instead of five unrelated buttons, and the
              native element carries that meaning without an ARIA attribute. */}
          <fieldset className="flex items-center gap-0.5 border-0 p-0">
            <legend className="sr-only">Text colour</legend>
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  editor.chain().focus().setTextColor(color).run();
                }}
                aria-label={`${color} text`}
                title={`${color} text`}
                aria-pressed={editor.isActive("textColor", { color })}
                className={`h-6 w-6 rounded border transition-transform hover:scale-110 ${
                  editor.isActive("textColor", { color })
                    ? "border-accent ring-1 ring-accent"
                    : "border-border"
                }`}
                style={{ backgroundColor: TEXT_COLOR_VARS[color] }}
              />
            ))}
          </fieldset>

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
        onUploadImage={onUploadImage}
        onAttachVideo={onAttachVideo}
        onInserted={handleInserted}
      />
    </MediaProvider>
  );
}
