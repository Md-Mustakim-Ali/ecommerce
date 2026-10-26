"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addBlockAction,
  deleteBlockAction,
  reorderBlocksAction,
  updateBlockAction,
} from "@/lib/actions/content";
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  type BlockType,
} from "@/lib/content/blocks";

/**
 * The page builder.
 *
 * The blocks, their schemas and their renderer all existed; nothing could
 * author them. A page created through the interface came out empty and stayed
 * empty, which the seeded pages hid completely — they had blocks, so the
 * storefront looked finished.
 *
 * Every field here is derived from the Zod schema in lib/content/blocks.ts
 * rather than invented, so a block type added there gets a form here without
 * anyone remembering to add one. The alternative — a hand-written form per
 * type — is eight forms that drift from eight schemas.
 */

type Scope = { scope: "platform" } | { scope: "store"; storeId: string };

export type EditorBlock = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

/**
 * What each block type asks for.
 *
 * Kept beside the schemas rather than generated from them: Zod can say a field
 * is an optional string, but not that it is a URL the author pastes, a tone
 * they pick from four, or a body that needs six rows rather than one. Those
 * are presentation decisions and they belong in the presentation layer.
 */
type Field = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "select" | "number" | "checkbox";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
};

const TONES = [
  { value: "accent", label: "Accent" },
  { value: "neutral", label: "Neutral" },
  { value: "positive", label: "Positive" },
  { value: "critical", label: "Critical" },
];

const FIELDS: Record<BlockType, Field[]> = {
  heading: [
    { name: "text", label: "Text", kind: "text" },
    {
      name: "level",
      label: "Level",
      kind: "select",
      options: [
        { value: "2", label: "Section (h2)" },
        { value: "3", label: "Sub-section (h3)" },
      ],
      hint: "Levels cannot skip. A page's own title is the h1.",
    },
  ],
  richText: [
    {
      name: "body",
      label: "Text",
      kind: "textarea",
      hint: "Plain text. Blank lines start a new paragraph; HTML is not accepted.",
    },
  ],
  banner: [
    { name: "title", label: "Title", kind: "text" },
    { name: "body", label: "Body", kind: "textarea" },
    { name: "tone", label: "Tone", kind: "select", options: TONES },
    { name: "ctaLabel", label: "Button label", kind: "text" },
    {
      name: "ctaHref",
      label: "Button link",
      kind: "text",
      placeholder: "/search",
      hint: "Relative, https, or mailto.",
    },
    { name: "dismissible", label: "Can be dismissed", kind: "checkbox" },
  ],
  offerCard: [
    { name: "title", label: "Title", kind: "text" },
    { name: "body", label: "Body", kind: "textarea" },
    {
      name: "code",
      label: "Discount code",
      kind: "text",
      hint: "Shown as a chip the shopper can copy.",
    },
    {
      name: "discountLabel",
      label: "Badge",
      kind: "text",
      placeholder: "15% off",
    },
    { name: "ctaLabel", label: "Button label", kind: "text" },
    {
      name: "ctaHref",
      label: "Button link",
      kind: "text",
      placeholder: "/search",
    },
    { name: "imageUrl", label: "Image URL", kind: "text" },
  ],
  productGrid: [
    { name: "title", label: "Heading", kind: "text" },
    {
      name: "source",
      label: "Products",
      kind: "select",
      options: [
        { value: "newest", label: "Newest" },
        { value: "category", label: "From a category" },
        { value: "tag", label: "With a tag" },
        { value: "brand", label: "From a brand" },
      ],
    },
    {
      name: "value",
      label: "Slug",
      kind: "text",
      hint: "The category, tag or brand slug. Ignored when showing newest.",
    },
    { name: "limit", label: "How many", kind: "number" },
  ],
  image: [
    { name: "url", label: "Image URL", kind: "text" },
    {
      name: "alt",
      label: "Alt text",
      kind: "text",
      hint: "What the image shows, for anyone who cannot see it. Required.",
    },
    { name: "caption", label: "Caption", kind: "text" },
  ],
  faq: [
    {
      name: "items",
      label: "Questions",
      kind: "textarea",
      hint: "One per line as: Question | Answer",
    },
  ],
  spacer: [
    {
      name: "size",
      label: "Size",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
  ],
};

/** FAQ items are stored structured but edited as lines, so both directions. */
function faqToText(data: Record<string, unknown>): string {
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((item) => {
      const entry = item as { question?: string; answer?: string };
      return `${entry.question ?? ""} | ${entry.answer ?? ""}`;
    })
    .join("\n");
}

function textToFaq(value: string) {
  return value
    .split("\n")
    .map((line) => line.split("|"))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      question: parts[0].trim(),
      // Re-joined, so an answer containing a pipe survives the round trip.
      answer: parts.slice(1).join("|").trim(),
    }))
    .filter((item) => item.question && item.answer);
}

export function readBlockForm(
  type: BlockType,
  form: FormData,
): Record<string, unknown> {
  if (type === "faq") {
    return { items: textToFaq(String(form.get("items") ?? "")) };
  }

  const out: Record<string, unknown> = {};
  for (const field of FIELDS[type]) {
    const raw = form.get(field.name);
    if (field.kind === "checkbox") {
      out[field.name] = raw === "on";
      continue;
    }
    const value = String(raw ?? "").trim();
    // Omitted rather than sent as "". The schemas mark these optional, and an
    // empty string fails a url() or a min(1) that undefined would skip.
    if (value === "") continue;
    out[field.name] = field.kind === "number" ? Number(value) : value;
  }
  return out;
}

export function PageEditor({
  scope,
  pageId,
  title,
  slug,
  status,
  blocks,
  publicPath,
}: {
  scope: Scope;
  pageId: string;
  title: string;
  slug: string;
  status: string;
  blocks: EditorBlock[];
  publicPath: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState<BlockType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      router.refresh();
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...blocks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() =>
      reorderBlocksAction({
        ...scope,
        pageId,
        blockIds: next.map((block) => block.id),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
            <Badge variant={status === "published" ? "positive" : "neutral"}>
              {status}
            </Badge>
          </div>
          <p className="font-mono text-tertiary-text text-xs">
            {publicPath}/{slug}
          </p>
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-md border border-border border-dashed bg-surface-1 px-4 py-8 text-center text-secondary-text text-sm">
          This page is empty. Add a block below and it appears on the page in
          the order you put them.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {blocks.map((block, index) => (
            <li key={block.id}>
              <BlockCard
                scope={scope}
                block={block}
                index={index}
                total={blocks.length}
                pending={pending}
                onMove={move}
                onRun={run}
              />
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-4">
        <h2 className="font-medium text-sm">Add a block</h2>
        <div className="flex flex-wrap gap-2">
          {BLOCK_TYPES.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={adding === type ? "default" : "outline"}
              onClick={() => setAdding(adding === type ? null : type)}
            >
              <Plus aria-hidden />
              {BLOCK_LABELS[type]}
            </Button>
          ))}
        </div>

        {adding ? (
          <form
            className="flex flex-col gap-3 rounded-md bg-surface-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const type = adding;
              run(async () => {
                const result = await addBlockAction({
                  ...scope,
                  pageId,
                  type,
                  data: readBlockForm(type, form),
                });
                if (result.ok) setAdding(null);
                return result;
              });
            }}
          >
            <p className="font-medium text-sm">{BLOCK_LABELS[adding]}</p>
            <BlockFields type={adding} data={{}} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Adding…" : "Add to page"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function BlockCard({
  scope,
  block,
  index,
  total,
  pending,
  onMove,
  onRun,
}: {
  scope: Scope;
  block: EditorBlock;
  index: number;
  total: number;
  pending: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRun: (work: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const type = block.type as BlockType;
  const known = type in BLOCK_LABELS;

  return (
    <div className="rounded-md border border-border bg-surface-1">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-tertiary-text text-xs tabular">{index + 1}</span>
        <span className="flex-1 font-medium text-sm">
          {known ? BLOCK_LABELS[type] : block.type}
          {/*
            A stored block whose type is no longer in the vocabulary renders as
            nothing on the storefront, by design. Saying so here is the only
            way anyone finds out.
          */}
          {!known ? (
            <span className="ml-2 text-critical text-xs">
              unknown type — not rendered
            </span>
          ) : null}
          <span className="ml-2 font-normal text-secondary-text text-xs">
            {summarise(block)}
          </span>
        </span>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Move up"
            disabled={pending || index === 0}
            onClick={() => onMove(index, -1)}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Move down"
            disabled={pending || index === total - 1}
            onClick={() => onMove(index, 1)}
          >
            <ChevronDown aria-hidden />
          </Button>
          {known ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Close" : "Edit"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove block"
            className="text-critical"
            disabled={pending}
            onClick={() =>
              onRun(() => deleteBlockAction({ ...scope, blockId: block.id }))
            }
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {open && known ? (
        <form
          className="flex flex-col gap-3 border-border border-t bg-surface-2 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onRun(async () => {
              const result = await updateBlockAction({
                ...scope,
                blockId: block.id,
                data: readBlockForm(type, form),
              });
              if (result.ok) setOpen(false);
              return result;
            });
          }}
        >
          <BlockFields type={type} data={block.data} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save block"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** A one-line preview, so the list is scannable without opening every block. */
function summarise(block: EditorBlock): string {
  const data = block.data;
  const first =
    (typeof data.text === "string" && data.text) ||
    (typeof data.title === "string" && data.title) ||
    (typeof data.body === "string" && data.body) ||
    (typeof data.alt === "string" && data.alt) ||
    (typeof data.size === "string" && data.size) ||
    (Array.isArray(data.items) ? `${data.items.length} questions` : "") ||
    "";
  return first ? `· ${String(first).slice(0, 60)}` : "";
}

export function BlockFields({
  type,
  data,
}: {
  type: BlockType;
  data: Record<string, unknown>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {FIELDS[type].map((field) => {
        const id = `${type}-${field.name}`;
        const current =
          type === "faq" && field.name === "items"
            ? faqToText(data)
            : data[field.name] === undefined
              ? ""
              : String(data[field.name]);

        return (
          <div key={field.name} className="grid gap-1.5">
            <Label htmlFor={id}>{field.label}</Label>

            {field.kind === "textarea" ? (
              <textarea
                id={id}
                name={field.name}
                defaultValue={current}
                rows={field.name === "body" || field.name === "items" ? 5 : 3}
                placeholder={field.placeholder}
                className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none placeholder:text-tertiary-text focus-visible:border-accent"
              />
            ) : field.kind === "select" ? (
              <select
                id={id}
                name={field.name}
                defaultValue={current || field.options?.[0]?.value}
                className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm"
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  name={field.name}
                  type="checkbox"
                  defaultChecked={data[field.name] === true}
                  className="size-4 accent-[var(--color-accent)]"
                />
                Yes
              </label>
            ) : (
              <Input
                id={id}
                name={field.name}
                type={field.kind === "number" ? "number" : "text"}
                defaultValue={current}
                placeholder={field.placeholder}
              />
            )}

            {field.hint ? (
              <p className="text-tertiary-text text-xs">{field.hint}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
