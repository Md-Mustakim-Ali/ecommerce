"use client";

import { LayoutList, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  createPageAction,
  createPlacementAction,
  deletePageAction,
  deletePlacementAction,
  setPagePublishedAction,
  setPlacementStatusAction,
  updatePageAction,
} from "@/lib/actions/content";
import { PLACEMENT_BLOCK_TYPES } from "@/lib/content/blocks";

/**
 * Pages and placements, for a store owner or platform staff.
 *
 * One component for both scopes. The scope prop decides which permission the
 * server action checks, and the server derives everything else from it — a
 * seller cannot reach platform content by editing the payload, because the
 * scope is what gets authorised, not trusted.
 */

type Scope = { scope: "platform" } | { scope: "store"; storeId: string };

export type PageRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Shown beside the Content button, so an empty page is visible at a glance. */
  blockCount: number;
};

export type PlacementRow = {
  id: string;
  type: string;
  slot: string;
  data: Record<string, unknown>;
  status: string;
  priority: number;
  targets: {
    targetType: string;
    targetValue: string | null;
    isExclusion: boolean;
  }[];
};

const TARGET_TYPES = [
  { value: "everywhere", label: "Every page", needsValue: false },
  { value: "home", label: "Home page", needsValue: false },
  { value: "search", label: "Search and category listings", needsValue: false },
  { value: "cart", label: "Cart and checkout", needsValue: false },
  {
    value: "category",
    label: "A category (and everything under it)",
    needsValue: true,
  },
  { value: "product", label: "Product pages", needsValue: true },
  { value: "store", label: "A store's pages", needsValue: true },
  { value: "page", label: "A custom page", needsValue: true },
];

export function ContentManager({
  scope,
  pages,
  placements,
  publicPathPrefix,
  editorPathPrefix,
}: {
  scope: Scope;
  pages: PageRow[];
  placements: PlacementRow[];
  /** Where a published page lives publicly, e.g. /pages or /store/oakline. */
  publicPathPrefix: string;
  /** Where the block editor lives, e.g. /admin/content or /dashboard/x/content. */
  editorPathPrefix: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function run(work: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm">Pages</h2>
          <p className="text-secondary-text text-xs">
            Custom pages. Drafts are a 404 to the public until published.
          </p>
        </div>

        {pages.length === 0 ? (
          <p className="rounded-md border border-border border-dashed bg-surface-1 px-4 py-6 text-center text-secondary-text text-sm">
            No pages yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
            {pages.map((page) => (
              <li key={page.id} className="flex flex-col bg-surface-1">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{page.title}</span>
                    <span className="font-mono text-tertiary-text text-xs">
                      {publicPathPrefix}/{page.slug}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        page.status === "published" ? "positive" : "neutral"
                      }
                    >
                      {page.status}
                    </Badge>
                    {page.status === "published" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        render={
                          <Link href={`${publicPathPrefix}/${page.slug}`} />
                        }
                      >
                        View
                      </Button>
                    ) : null}
                    {/*
                      Two different edits, and they are genuinely different
                      jobs: the title and slug are a small form that belongs
                      inline, while the page's content is a builder that needs
                      the whole screen.
                    */}
                    <Button
                      size="sm"
                      variant="ghost"
                      render={<Link href={`${editorPathPrefix}/${page.id}`} />}
                    >
                      <LayoutList aria-hidden />
                      Content
                      <span className="ml-1 text-tertiary-text">
                        {page.blockCount}
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        setEditing(editing === page.id ? null : page.id)
                      }
                    >
                      <Pencil aria-hidden />
                      Details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          setPagePublishedAction({
                            ...scope,
                            pageId: page.id,
                            publish: page.status !== "published",
                          }),
                        )
                      }
                    >
                      {page.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </div>

                {editing === page.id ? (
                  <EditPageForm
                    scope={scope}
                    page={page}
                    onDone={() => {
                      setEditing(null);
                      router.refresh();
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <NewPageForm scope={scope} onDone={() => router.refresh()} />
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm">Banners and offers</h2>
          <p className="text-secondary-text text-xs">
            These appear on pages that already exist. Target one page, a whole
            category including everything under it, or everywhere — and exclude
            the places you do not want.
          </p>
        </div>

        {placements.length === 0 ? (
          <p className="rounded-md border border-border border-dashed bg-surface-1 px-4 py-6 text-center text-secondary-text text-sm">
            Nothing placed yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
            {placements.map((placement) => (
              <li
                key={placement.id}
                className="flex flex-col gap-2 bg-surface-1 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">
                      {String(placement.data.title ?? placement.type)}
                    </span>
                    <span className="text-tertiary-text text-xs">
                      {placement.type} · {placement.slot} · priority{" "}
                      {placement.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        placement.status === "published"
                          ? "positive"
                          : "neutral"
                      }
                    >
                      {placement.status === "published"
                        ? "Live"
                        : placement.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          setPlacementStatusAction({
                            ...scope,
                            placementId: placement.id,
                            publish: placement.status !== "published",
                          }),
                        )
                      }
                    >
                      {placement.status === "published" ? "Pause" : "Go live"}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete placement"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          deletePlacementAction({
                            ...scope,
                            placementId: placement.id,
                          }),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <ul className="flex flex-wrap gap-1.5">
                  {placement.targets.map((target) => (
                    <li key={`${target.targetType}-${target.targetValue}`}>
                      <Badge
                        variant={target.isExclusion ? "critical" : "muted"}
                      >
                        {target.isExclusion ? "except " : ""}
                        {target.targetType}
                        {target.targetValue ? `: ${target.targetValue}` : ""}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <NewPlacementForm scope={scope} onDone={() => router.refresh()} />
      </section>

      {message ? (
        <output className="text-secondary-text text-sm">{message}</output>
      ) : null}
    </div>
  );
}

/**
 * Editing an existing page, inline under its row.
 *
 * Delete sits inside this form rather than in the row, because it should cost
 * a click to reach. Rows are scanned; a destructive button in a list of them
 * is a button somebody hits while looking for Publish.
 */
function EditPageForm({
  scope,
  page,
  onDone,
}: {
  scope: Scope;
  page: PageRow;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 border-border border-t bg-surface-2 px-4 py-4">
      <form
        id={`edit-page-${page.id}`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const data = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await updatePageAction({
              ...scope,
              pageId: page.id,
              title: String(data.get("title") ?? ""),
              slug: String(data.get("slug") ?? ""),
              excerpt: String(data.get("excerpt") ?? ""),
              seoTitle: String(data.get("seoTitle") ?? ""),
              seoDescription: String(data.get("seoDescription") ?? ""),
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            onDone();
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`title-${page.id}`}>Title</Label>
            <Input
              id={`title-${page.id}`}
              name="title"
              defaultValue={page.title}
              required
              maxLength={200}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`slug-${page.id}`}>Slug</Label>
            <Input
              id={`slug-${page.id}`}
              name="slug"
              defaultValue={page.slug}
              maxLength={200}
            />
            {/*
              Worth saying plainly. Changing this breaks anything already
              linking here, and nothing in the interface would otherwise
              suggest that.
            */}
            <p className="text-tertiary-text text-xs">
              Changing this breaks existing links to the page.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`excerpt-${page.id}`}>Summary</Label>
          <Input
            id={`excerpt-${page.id}`}
            name="excerpt"
            defaultValue={page.excerpt ?? ""}
            maxLength={400}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`seo-title-${page.id}`}>SEO title</Label>
            <Input
              id={`seo-title-${page.id}`}
              name="seoTitle"
              defaultValue={page.seoTitle ?? ""}
              placeholder={page.title}
              maxLength={200}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`seo-desc-${page.id}`}>SEO description</Label>
            <Input
              id={`seo-desc-${page.id}`}
              name="seoDescription"
              defaultValue={page.seoDescription ?? ""}
              maxLength={400}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          form={`edit-page-${page.id}`}
          size="sm"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>

        {!confirming ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-critical"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden />
            Delete
          </Button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-secondary-text text-xs">
              Delete this page and its blocks?
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await deletePageAction({
                    ...scope,
                    pageId: page.id,
                  });
                  if (!result.ok) {
                    setError(result.message);
                    setConfirming(false);
                    return;
                  }
                  onDone();
                });
              }}
            >
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPageForm({ scope, onDone }: { scope: Scope; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <Plus />
        New page
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createPageAction({
            ...scope,
            title: String(data.get("title") ?? ""),
            slug: String(data.get("slug") ?? ""),
            excerpt: String(data.get("excerpt") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setOpen(false);
          onDone();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="page-title">Title</Label>
        <Input id="page-title" name="title" required maxLength={200} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="page-slug">Slug (optional)</Label>
        <Input
          id="page-slug"
          name="slug"
          placeholder="derived from the title"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="page-excerpt">Summary</Label>
        <Input id="page-excerpt" name="excerpt" maxLength={400} />
      </div>
      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create"}
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
  );
}

function NewPlacementForm({
  scope,
  onDone,
}: {
  scope: Scope;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [targets, setTargets] = useState([
    { targetType: "everywhere", targetValue: "", isExclusion: false },
  ]);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <Plus />
        New banner or offer
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const type = String(data.get("type") ?? "banner");

        startTransition(async () => {
          const result = await createPlacementAction({
            ...scope,
            type,
            slot: String(data.get("slot") ?? "above_content") as
              | "announcement_bar"
              | "above_content"
              | "below_content"
              | "in_grid",
            priority: Number(data.get("priority") ?? 0),
            publish: data.get("publish") === "on",
            data: {
              title: String(data.get("title") ?? ""),
              body: String(data.get("body") ?? "") || undefined,
              tone: String(data.get("tone") ?? "accent"),
              ctaLabel: String(data.get("ctaLabel") ?? "") || undefined,
              ctaHref: String(data.get("ctaHref") ?? "") || undefined,
              code: String(data.get("code") ?? "") || undefined,
            },
            targets: targets
              .filter((t) => t.targetType)
              .map((t) => ({
                targetType: t.targetType as "everywhere",
                targetValue: t.targetValue.trim() || null,
                isExclusion: t.isExclusion,
              })),
          });

          if (!result.ok) {
            setError(result.message);
            return;
          }
          setOpen(false);
          setTargets([
            { targetType: "everywhere", targetValue: "", isExclusion: false },
          ]);
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="p-type">Kind</Label>
          <select
            id="p-type"
            name="type"
            defaultValue="banner"
            className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm"
          >
            {PLACEMENT_BLOCK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-slot">Position</Label>
          <select
            id="p-slot"
            name="slot"
            defaultValue={
              scope.scope === "store" ? "product_top" : "above_content"
            }
            className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm"
          >
            {/*
              A store only gets the positions inside its own listing. The
              announcement bar and the page bands wrap pages the store does not
              own, so offering them would be offering something the server will
              refuse.
            */}
            {scope.scope === "platform" ? (
              <optgroup label="Whole page">
                <option value="announcement_bar">
                  Announcement bar (above the header)
                </option>
                <option value="above_content">Above the content</option>
                <option value="below_content">Below the content</option>
              </optgroup>
            ) : null}
            <optgroup label="On a product page">
              <option value="product_top">Top, under the breadcrumb</option>
              <option value="product_before_price">Just above the price</option>
              <option value="product_after_options">
                Under the options, by add to cart
              </option>
              <option value="product_sidebar">
                Beside the gallery, in the buy column
              </option>
              <option value="product_below_details">
                Below the description
              </option>
            </optgroup>
            <optgroup label="In a listing grid">
              <option value="in_grid">
                Among the products{" "}
                {scope.scope === "store" ? "on your store page" : ""}
              </option>
            </optgroup>
          </select>
          <p className="text-tertiary-text text-xs">
            {scope.scope === "store"
              ? "Shoppers see this labelled as an offer from your store."
              : "Shoppers see this labelled as a marketplace offer."}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="p-title">Title</Label>
        <Input id="p-title" name="title" required maxLength={120} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="p-body">Body</Label>
        <Input id="p-body" name="body" maxLength={400} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="p-tone">Tone</Label>
          <select
            id="p-tone"
            name="tone"
            defaultValue="accent"
            className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm"
          >
            <option value="accent">Accent</option>
            <option value="neutral">Neutral</option>
            <option value="positive">Positive</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-cta">Button label</Label>
          <Input id="p-cta" name="ctaLabel" maxLength={40} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-href">Button link</Label>
          <Input id="p-href" name="ctaHref" placeholder="/search" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-sm">Where it appears</legend>
        <p className="text-secondary-text text-xs">
          Add as many rules as you need. An exclusion always wins, so
          &ldquo;everywhere&rdquo; plus &ldquo;except cart&rdquo; is one
          placement.
        </p>

        {targets.map((target, index) => {
          const definition = TARGET_TYPES.find(
            (t) => t.value === target.targetType,
          );
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={target.targetType}
                onChange={(e) =>
                  setTargets((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, targetType: e.target.value }
                        : row,
                    ),
                  )
                }
                className="h-9 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm"
              >
                {TARGET_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {definition?.needsValue ? (
                <input
                  value={target.targetValue}
                  onChange={(e) =>
                    setTargets((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, targetValue: e.target.value }
                          : row,
                      ),
                    )
                  }
                  placeholder="slug (blank means all)"
                  className="h-9 w-52 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm"
                />
              ) : null}

              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={target.isExclusion}
                  onChange={(e) =>
                    setTargets((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, isExclusion: e.target.checked }
                          : row,
                      ),
                    )
                  }
                />
                Exclude
              </label>

              {targets.length > 1 ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove rule"
                  onClick={() =>
                    setTargets((rows) => rows.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          );
        })}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() =>
            setTargets((rows) => [
              ...rows,
              { targetType: "category", targetValue: "", isExclusion: false },
            ])
          }
        >
          <Plus />
          Add rule
        </Button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <div className="grid gap-2">
          <Label htmlFor="p-priority">Priority</Label>
          <Input
            id="p-priority"
            name="priority"
            defaultValue="0"
            inputMode="numeric"
            className="w-24"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" />
          Go live immediately
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Create"}
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
  );
}
