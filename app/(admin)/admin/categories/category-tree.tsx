"use client";

import { ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteCategoryAction,
  saveCategoryAction,
} from "@/lib/actions/moderation";

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  position: number;
  productCount: number;
};

/**
 * The category tree.
 *
 * Rendered from a flat list rather than a nested one, because the table is
 * flat and reconstructing the nesting here keeps the query simple and the
 * depth unbounded.
 *
 * Deletion refuses while a category still holds products or children. Removing
 * one out from under them silently strands listings nobody can navigate to,
 * and there is no cheap way to notice afterwards.
 */
export function CategoryTree({ categories }: { categories: CategoryNode[] }) {
  const [adding, setAdding] = useState<string | null | "root">(null);
  const [editing, setEditing] = useState<string | null>(null);

  const childrenOf = (parentId: string | null) =>
    categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  function render(parentId: string | null, depth: number) {
    return childrenOf(parentId).map((category) => (
      <li key={category.id} className="bg-background">
        {editing === category.id ? (
          <div className="p-3" style={{ paddingLeft: 12 + depth * 20 }}>
            <CategoryForm
              category={category}
              categories={categories}
              onDone={() => setEditing(null)}
            />
          </div>
        ) : (
          <Row
            category={category}
            depth={depth}
            onEdit={() => setEditing(category.id)}
            onAddChild={() => setAdding(category.id)}
          />
        )}

        {adding === category.id ? (
          <div className="p-3" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>
            <CategoryForm
              parentId={category.id}
              categories={categories}
              onDone={() => setAdding(null)}
            />
          </div>
        ) : null}

        {childrenOf(category.id).length > 0 ? (
          <ul className="flex flex-col gap-px bg-border">
            {render(category.id, depth + 1)}
          </ul>
        ) : null}
      </li>
    ));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {categories.length} categories. Products sit on a leaf; parents are
          for navigation and filtering.
        </p>
        {adding !== "root" ? (
          <Button size="sm" variant="outline" onClick={() => setAdding("root")}>
            <Plus aria-hidden />
            Top-level category
          </Button>
        ) : null}
      </div>

      {adding === "root" ? (
        <CategoryForm
          parentId={null}
          categories={categories}
          onDone={() => setAdding(null)}
        />
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
        {render(null, 0)}
      </ul>
    </div>
  );
}

function Row({
  category,
  depth,
  onEdit,
  onAddChild,
}: {
  category: CategoryNode;
  depth: number;
  onEdit: () => void;
  onAddChild: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
      style={{ paddingLeft: 12 + depth * 20 }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {depth > 0 ? (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{category.name}</span>
          <span className="text-muted-foreground text-xs">
            /{category.slug}
          </span>
          {category.productCount > 0 ? (
            <Badge variant="outline">{category.productCount}</Badge>
          ) : null}
        </span>
        {error ? (
          <span role="alert" className="text-destructive text-xs">
            {error}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onAddChild}>
          Add child
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>

        {confirming ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteCategoryAction({
                    categoryId: category.id,
                  });
                  if (!result.ok) setError(result.message);
                  setConfirming(false);
                })
              }
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </span>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${category.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function CategoryForm({
  category,
  parentId,
  categories,
  onDone,
}: {
  category?: CategoryNode;
  parentId?: string | null;
  categories: CategoryNode[];
  onDone: () => void;
}) {
  const [parent, setParent] = useState<string | null>(
    category?.parentId ?? parentId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A category cannot be its own parent or its own descendant. The server
  // checks this too — walking the tree is the only reliable test — but
  // removing the obvious cases from the list keeps the form honest.
  const descendants = new Set<string>();
  if (category) {
    const collect = (id: string) => {
      descendants.add(id);
      for (const child of categories.filter((c) => c.parentId === id)) {
        collect(child.id);
      }
    };
    collect(category.id);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const name = String(
          new FormData(event.currentTarget).get("name") ?? "",
        );
        startTransition(async () => {
          const result = await saveCategoryAction({
            id: category?.id,
            name,
            parentId: parent,
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        });
      }}
    >
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor={`c-name-${category?.id ?? "new"}`}>Name</Label>
        <Input
          id={`c-name-${category?.id ?? "new"}`}
          name="name"
          defaultValue={category?.name ?? ""}
          required
          maxLength={80}
          autoFocus
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`c-parent-${category?.id ?? "new"}`}>Parent</Label>
        <select
          id={`c-parent-${category?.id ?? "new"}`}
          value={parent ?? ""}
          onChange={(event) => setParent(event.target.value || null)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Top level</option>
          {categories
            .filter((c) => !descendants.has(c.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {category ? "Save" : "Add"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>

      {error ? (
        <p role="alert" className="w-full text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </form>
  );
}
