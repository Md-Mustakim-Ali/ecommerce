"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TermCombobox } from "@/components/dashboard/term-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createProductAction } from "@/lib/actions/products";
import type { Term } from "@/lib/catalog/terms";
import { createProductSchema } from "@/lib/validation/product";

export function NewProductForm({
  storeId,
  categories,
  canPublish,
  canProposeBrand,
  canProposeTag,
}: {
  storeId: string;
  categories: { id: string; name: string }[];
  canPublish: boolean;
  canProposeBrand: boolean;
  canProposeTag: boolean;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState<Term | null>(null);
  const [selectedTags, setSelectedTags] = useState<Term[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addTag(term: Term | null) {
    if (!term) return;
    setSelectedTags((current) =>
      current.some((t) => t.id === term.id) ? current : [...current, term],
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>, publish: boolean) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const input = {
      storeId,
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""),
      brandId: brand?.id ?? null,
      tagIds: selectedTags.map((t) => t.id),
      sku: String(form.get("sku") ?? ""),
      price: String(form.get("price") ?? ""),
      stock: String(form.get("stock") ?? "0"),
      publish,
    };

    // Same schema the server action re-parses. This is for the message, not
    // for safety — the server never trusts it.
    const parsed = createProductSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    startTransition(async () => {
      const result = await createProductAction(input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Straight into the editor. Creating a listing and being returned to a
      // page that only shows a count reads as the save having failed, and the
      // options and variants are set up here anyway.
      router.push(`/dashboard/${storeId}/products/${result.productId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => submit(e, false)}
      className="flex max-w-2xl flex-col gap-6"
      noValidate
    >
      <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5">
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required maxLength={140} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            name="description"
            rows={4}
            maxLength={4000}
            className="w-full rounded-md border border-border-strong bg-surface-sunken px-4 py-3 text-sm shadow-well outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue=""
            className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            <option value="" disabled>
              Pick a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-md border border-border bg-surface-1 p-5">
        <div className="grid gap-2">
          <Label>Brand</Label>
          <p className="text-secondary-text text-xs">
            Search first. Only add a new brand if it genuinely is not listed.
          </p>
          {canProposeBrand ? (
            <TermCombobox
              kind="brand"
              storeId={storeId}
              value={brand}
              onChange={setBrand}
            />
          ) : (
            <p className="text-tertiary-text text-sm">
              Your role cannot add brands.
            </p>
          )}
        </div>

        <Separator />

        <div className="grid gap-2">
          <Label>Tags</Label>
          {selectedTags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {selectedTags.map((tag) => (
                <li key={tag.id}>
                  <Badge
                    variant={tag.status === "approved" ? "neutral" : "muted"}
                  >
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`Remove ${tag.name}`}
                      onClick={() =>
                        setSelectedTags((c) => c.filter((t) => t.id !== tag.id))
                      }
                      className="ml-0.5"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}

          {canProposeTag ? (
            <TermCombobox
              kind="tag"
              storeId={storeId}
              value={null}
              onChange={addTag}
            />
          ) : (
            <p className="text-tertiary-text text-sm">
              Your role cannot add tags.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 rounded-md border border-border bg-surface-1 p-5 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" required maxLength={64} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="price">Price</Label>
          <Input
            id="price"
            name="price"
            required
            inputMode="decimal"
            placeholder="19.99"
            className="tabular"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="stock">Stock</Label>
          <Input
            id="stock"
            name="stock"
            required
            inputMode="numeric"
            defaultValue="0"
            className="tabular"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save as draft"}
        </Button>
        {/*
          Publishing is a separate permission from creating, so a Catalog-only
          role gets the draft button and not this one.
        */}
        {canPublish ? (
          <Button
            type="button"
            disabled={pending}
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form)
                submit(
                  {
                    preventDefault: () => {},
                    currentTarget: form,
                  } as unknown as React.FormEvent<HTMLFormElement>,
                  true,
                );
            }}
          >
            {pending ? "Publishing…" : "Publish"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
