"use client";

import { Loader2, Plus, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  findSimilarValuesAction,
  proposeAttributeValueAction,
  saveVariantsAction,
  setProductAttributesAction,
  setProductStatusAction,
  updateProductDetailsAction,
} from "@/lib/actions/product-editor";
import type {
  EditorAttribute,
  EditorVariant,
} from "@/lib/catalog/product-editor";

type AvailableAttribute = {
  id: string;
  name: string;
  slug: string;
  kind: "select" | "color" | "number" | "text";
  unit: string | null;
  isFilterable: boolean;
  values: {
    id: string;
    value: string;
    slug: string;
    meta: Record<string, unknown>;
  }[];
};

type Row = {
  key: string;
  id?: string;
  sku: string;
  price: string;
  compareAtPrice: string;
  stock: string;
  combination: Record<string, string>;
};

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * The product editor.
 *
 * Three separately-saved sections rather than one giant form. Attributes and
 * the variant matrix are different shapes of change — picking a new colour
 * regenerates rows, editing a price does not — and forcing them through one
 * submit means a typo in a price blocks an attribute change.
 *
 * The matrix is the important part. There is no table of allowed combinations
 * in the schema: the set of variants IS that set. So deleting a row here is
 * how "12 GB does not come in Navy" gets expressed, and the storefront shows
 * that pairing as unavailable because no SKU matches it.
 */
export function ProductEditor({
  storeId,
  product,
  available,
  permissions,
}: {
  storeId: string;
  product: {
    id: string;
    title: string;
    description: string | null;
    status: "draft" | "active" | "archived";
    stockDisplay: "never" | "always" | "when_low";
    lowStockThreshold: number;
    attributes: EditorAttribute[];
    variants: EditorVariant[];
  };
  available: AvailableAttribute[];
  permissions: {
    manageVariants: boolean;
    publish: boolean;
    archive: boolean;
    proposeAttribute: boolean;
  };
}) {
  return (
    <div className="flex flex-col gap-6">
      <DetailsSection storeId={storeId} product={product} />

      {permissions.manageVariants ? (
        <>
          <AttributeSection
            storeId={storeId}
            productId={product.id}
            chosen={product.attributes}
            available={available}
            canPropose={permissions.proposeAttribute}
          />
          <VariantSection
            storeId={storeId}
            productId={product.id}
            attributes={product.attributes}
            variants={product.variants}
          />
        </>
      ) : (
        <p className="rounded-md border border-border bg-surface-2 px-4 py-3 text-secondary-text text-sm">
          Your role can edit the listing but not its options or prices.
        </p>
      )}

      <StatusSection
        storeId={storeId}
        productId={product.id}
        status={product.status}
        variantCount={product.variants.length}
        permissions={permissions}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetailsSection({
  storeId,
  product,
}: {
  storeId: string;
  product: {
    id: string;
    title: string;
    description: string | null;
    stockDisplay: "never" | "always" | "when_low";
    lowStockThreshold: number;
  };
}) {
  const [display, setDisplay] = useState(product.stockDisplay);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updateProductDetailsAction({
            storeId,
            productId: product.id,
            title: String(data.get("title") ?? ""),
            description: String(data.get("description") ?? ""),
            stockDisplay: display,
            lowStockThreshold: Number(data.get("lowStockThreshold") ?? 5),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
        });
      }}
    >
      <h2 className="font-medium text-sm">Details</h2>

      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={product.title}
          required
          maxLength={140}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={5}
          maxLength={8000}
          defaultValue={product.description ?? ""}
          className="w-full rounded-lg border border-border-strong bg-surface-sunken px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </div>

      <Separator />

      {/*
        Stock display is a seller decision, not a platform one. Showing "3 left"
        creates urgency and also tells a competitor your exact inventory, and
        which of those matters more depends on what is being sold.
      */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-sm">
          Stock on the product page
        </legend>
        <p className="mb-1 text-tertiary-text text-xs">
          What shoppers see about how many you have left.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["never", "Never show it", "Only in stock or sold out."],
              [
                "when_low",
                "Only when low",
                "Creates urgency without publishing your inventory.",
              ],
              ["always", "Always show it", "The exact count, at every level."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 ${
                display === value
                  ? "border-accent bg-accent-muted"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="stockDisplay"
                  className="size-4 accent-accent"
                  checked={display === value}
                  onChange={() => setDisplay(value)}
                />
                <span className="font-medium text-xs">{label}</span>
              </span>
              <span className="text-secondary-text text-xs">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {display === "when_low" ? (
        <div className="grid gap-2 sm:max-w-56">
          <Label htmlFor="lowStockThreshold">Show the count at or below</Label>
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            min={0}
            max={10000}
            defaultValue={product.lowStockThreshold}
          />
        </div>
      ) : (
        <input
          type="hidden"
          name="lowStockThreshold"
          value={product.lowStockThreshold}
        />
      )}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save details
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function AttributeSection({
  storeId,
  productId,
  chosen,
  available,
  canPropose,
}: {
  storeId: string;
  productId: string;
  chosen: EditorAttribute[];
  available: AvailableAttribute[];
  canPropose: boolean;
}) {
  const [selection, setSelection] = useState<
    Record<string, { role: "variant" | "spec"; valueIds: Set<string> }>
  >(() =>
    Object.fromEntries(
      chosen.map((attribute) => [
        attribute.attributeId,
        {
          role: attribute.role,
          valueIds: new Set(attribute.values.map((v) => v.id)),
        },
      ]),
    ),
  );
  // Values proposed in this session, merged into the pickers without a reload.
  const [extraValues, setExtraValues] = useState<
    Record<
      string,
      {
        id: string;
        value: string;
        slug: string;
        meta: Record<string, unknown>;
      }[]
    >
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleAttribute(id: string) {
    setSelection((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = { role: "variant", valueIds: new Set() };
      return next;
    });
  }

  function toggleValue(attributeId: string, valueId: string) {
    setSelection((current) => {
      const entry = current[attributeId];
      if (!entry) return current;
      const valueIds = new Set(entry.valueIds);
      if (valueIds.has(valueId)) valueIds.delete(valueId);
      else valueIds.add(valueId);
      return { ...current, [attributeId]: { ...entry, valueIds } };
    });
  }

  const chosenIds = Object.keys(selection);

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5">
      <div>
        <h2 className="font-medium text-sm">Options and specifications</h2>
        <p className="text-tertiary-text text-xs">
          Attributes are shared across the whole marketplace, so shoppers can
          filter on colour once rather than on four spellings of it. Pick the
          ones this product uses, then which values it comes in.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {available.map((attribute) => (
          <button
            key={attribute.id}
            type="button"
            onClick={() => toggleAttribute(attribute.id)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              selection[attribute.id]
                ? "border-accent bg-accent-muted text-accent-text"
                : "border-border text-secondary-text hover:bg-surface-2"
            }`}
          >
            {attribute.name}
            {attribute.unit ? ` (${attribute.unit})` : ""}
          </button>
        ))}
      </div>

      {chosenIds.length === 0 ? (
        <p className="text-secondary-text text-sm">
          No options yet. This product will have a single variant with one price
          and one stock level.
        </p>
      ) : null}

      {chosenIds.map((attributeId) => {
        const attribute = available.find((a) => a.id === attributeId);
        if (!attribute) return null;
        const entry = selection[attributeId];
        const values = [
          ...attribute.values,
          ...(extraValues[attributeId] ?? []),
        ];

        return (
          <div
            key={attributeId}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium text-sm">{attribute.name}</span>

              {/*
                A variant attribute splits the product into SKUs; a spec only
                describes and filters it. Storing them in one table with a role
                is what lets a shopper filter on screen size without every
                screen size becoming a separate variant.
              */}
              <div className="flex gap-1">
                {(["variant", "spec"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() =>
                      setSelection((current) => ({
                        ...current,
                        [attributeId]: { ...entry, role },
                      }))
                    }
                    className={`rounded-full px-3 py-1 text-xs ${
                      entry.role === role
                        ? "bg-surface-3 font-medium text-primary-text"
                        : "text-secondary-text hover:bg-surface-3"
                    }`}
                  >
                    {role === "variant" ? "Own price & stock" : "Just a spec"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {values.map((value) => {
                const checked = entry.valueIds.has(value.id);
                const hex =
                  typeof value.meta.hex === "string" ? value.meta.hex : null;
                return (
                  <button
                    key={value.id}
                    type="button"
                    onClick={() => toggleValue(attributeId, value.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
                      checked
                        ? "border-accent bg-accent-muted text-accent-text"
                        : "border-border text-secondary-text hover:bg-surface-3"
                    }`}
                  >
                    {hex ? (
                      <span
                        aria-hidden
                        className="size-3 rounded-full border border-border-strong"
                        style={{ backgroundColor: hex }}
                      />
                    ) : null}
                    {value.value}
                  </button>
                );
              })}

              {canPropose ? (
                <AddValue
                  storeId={storeId}
                  attributeId={attributeId}
                  attributeName={attribute.name}
                  onAdded={(value) => {
                    setExtraValues((current) => ({
                      ...current,
                      [attributeId]: [...(current[attributeId] ?? []), value],
                    }));
                    toggleValue(attributeId, value.id);
                  }}
                />
              ) : null}
            </div>

            {entry.valueIds.size === 0 ? (
              <p className="text-tertiary-text text-xs">
                Pick at least one value, or this attribute does nothing.
              </p>
            ) : null}
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await setProductAttributesAction({
                storeId,
                productId,
                attributes: Object.entries(selection).map(([id, entry]) => ({
                  attributeId: id,
                  role: entry.role,
                  valueIds: [...entry.valueIds],
                })),
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(`${result.message} Reload to rebuild the matrix.`);
            });
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save options
        </Button>
      </div>
    </section>
  );
}

/** Adds a value to a global attribute, warning about near-duplicates first. */
function AddValue({
  storeId,
  attributeId,
  attributeName,
  onAdded,
}: {
  storeId: string;
  attributeId: string;
  attributeName: string;
  onAdded: (value: {
    id: string;
    value: string;
    slug: string;
    meta: Record<string, unknown>;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [similar, setSimilar] = useState<{ id: string; value: string }[]>([]);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-full border border-border border-dashed px-3 py-1.5 text-secondary-text text-xs hover:bg-surface-3"
      >
        <Plus aria-hidden className="size-3" />
        Add a {attributeName.toLowerCase()}
      </button>
    );
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5">
        <Input
          value={text}
          autoFocus
          placeholder={`New ${attributeName.toLowerCase()}`}
          className="h-8 w-44 text-xs"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // Near-match check as they type, so a duplicate is caught before
            // it is created rather than merged afterwards.
            startTransition(async () => {
              setSimilar(
                await findSimilarValuesAction({
                  storeId,
                  attributeId,
                  query: next,
                }),
              );
            });
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || text.trim().length === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await proposeAttributeValueAction({
                storeId,
                attributeId,
                value: text,
              });
              if (!result.ok) return;
              onAdded({ ...result.value, meta: {} });
              setText("");
              setSimilar([]);
              setOpen(false);
            })
          }
        >
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setText("");
            setSimilar([]);
          }}
        >
          Cancel
        </Button>
      </span>

      {similar.length > 0 ? (
        <span className="flex items-center gap-1.5 text-tertiary-text text-xs">
          <TriangleAlert aria-hidden className="size-3 text-[#fab219]" />
          Already exists: {similar.map((s) => s.value).join(", ")}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------

function VariantSection({
  storeId,
  productId,
  attributes,
  variants,
}: {
  storeId: string;
  productId: string;
  attributes: EditorAttribute[];
  variants: EditorVariant[];
}) {
  const variantAttributes = useMemo(
    () => attributes.filter((a) => a.role === "variant" && a.values.length > 0),
    [attributes],
  );

  const [rows, setRows] = useState<Row[]>(() =>
    variants.map((variant) => ({
      key: variant.id,
      id: variant.id,
      sku: variant.sku ?? "",
      price: money(variant.priceCents),
      compareAtPrice:
        variant.compareAtPriceCents === null
          ? ""
          : money(variant.compareAtPriceCents),
      stock: String(variant.stock),
      combination: variant.combination,
    })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valueName = (attributeId: string, valueId: string) =>
    variantAttributes
      .find((a) => a.attributeId === attributeId)
      ?.values.find((v) => v.id === valueId)?.value ?? "—";

  /**
   * Fills in every combination the chosen values allow.
   *
   * Existing rows are kept as they are: regenerating must never reset a price
   * somebody has already set or throw away stock. Only missing combinations
   * are added, and nothing is removed — deleting is a deliberate act, because
   * that is what marks a combination invalid.
   */
  function generate() {
    if (variantAttributes.length === 0) return;

    let combinations: Record<string, string>[] = [{}];
    for (const attribute of variantAttributes) {
      const next: Record<string, string>[] = [];
      for (const partial of combinations) {
        for (const value of attribute.values) {
          next.push({ ...partial, [attribute.attributeId]: value.id });
        }
      }
      combinations = next;
    }

    const keyOf = (combination: Record<string, string>) =>
      Object.entries(combination)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("|");

    const existing = new Set(rows.map((row) => keyOf(row.combination)));
    const template = rows[0];

    // A product created before it had any options carries one variant with an
    // empty combination. Left alone it would sit in the matrix forever as an
    // unlabelled row that matches nothing. Absorbing it into the first real
    // combination keeps its id — and therefore its stock and its link from any
    // past order — instead of stranding it.
    const orphan = rows.find(
      (row) => Object.keys(row.combination).length === 0,
    );

    const missing = combinations.filter(
      (combination) => !existing.has(keyOf(combination)),
    );

    const absorbed = orphan && missing.length > 0 ? missing[0] : null;
    const additions = missing
      .slice(absorbed ? 1 : 0)
      .map((combination, index) => ({
        key: `new-${Date.now()}-${index}`,
        sku: "",
        // Seeded from the first row so a 40-row matrix is not 40 blank prices.
        price: template?.price ?? "0.00",
        compareAtPrice: template?.compareAtPrice ?? "",
        stock: "0",
        combination,
      }));

    setRows((current) => [
      ...current.map((row) =>
        absorbed && row.key === orphan?.key
          ? { ...row, combination: absorbed }
          : row,
      ),
      ...additions,
    ]);

    setMessage(
      missing.length === 0
        ? "Every combination already has a row."
        : `Added ${missing.length} ${missing.length === 1 ? "combination" : "combinations"}. Set prices, then save.`,
    );
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  const possible = variantAttributes.reduce(
    (total, attribute) => total * Math.max(1, attribute.values.length),
    1,
  );

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Variants and prices</h2>
          <p className="text-tertiary-text text-xs">
            {variantAttributes.length === 0
              ? "No option attributes, so this product has one variant."
              : `${rows.length} of ${possible} possible combinations. Delete a row to say that pairing does not exist — the storefront then shows it as unavailable.`}
          </p>
        </div>

        {variantAttributes.length > 0 ? (
          <Button size="sm" variant="outline" onClick={generate}>
            <Wand2 aria-hidden />
            Fill in missing
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-border border-b bg-surface-2 text-left">
            <tr>
              {variantAttributes.map((attribute) => (
                <th
                  key={attribute.attributeId}
                  className="px-3 py-2 font-medium text-xs"
                >
                  {attribute.name}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-xs">SKU</th>
              <th className="px-3 py-2 font-medium text-xs">Price</th>
              <th className="px-3 py-2 font-medium text-xs">Compare at</th>
              <th className="px-3 py-2 font-medium text-xs">Stock</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-border border-b last:border-0"
              >
                {variantAttributes.map((attribute) => (
                  <td
                    key={attribute.attributeId}
                    className="whitespace-nowrap px-3 py-2 text-xs"
                  >
                    {valueName(
                      attribute.attributeId,
                      row.combination[attribute.attributeId],
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5">
                  <Input
                    value={row.sku}
                    onChange={(e) => update(row.key, { sku: e.target.value })}
                    className="h-8 w-32 text-xs"
                    placeholder="optional"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    value={row.price}
                    onChange={(e) => update(row.key, { price: e.target.value })}
                    className="h-8 w-24 text-xs"
                    inputMode="decimal"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    value={row.compareAtPrice}
                    onChange={(e) =>
                      update(row.key, { compareAtPrice: e.target.value })
                    }
                    className="h-8 w-24 text-xs"
                    inputMode="decimal"
                    placeholder="—"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    value={row.stock}
                    onChange={(e) => update(row.key, { stock: e.target.value })}
                    className="h-8 w-20 text-xs"
                    inputMode="numeric"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove this combination"
                    disabled={rows.length === 1}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((r) => r.key !== row.key),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some((row) => !row.id) ? (
        <p className="text-tertiary-text text-xs">
          <Badge variant="muted">Unsaved</Badge> New rows are not live until you
          save.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await saveVariantsAction({
                storeId,
                productId,
                variants: rows.map((row) => ({
                  id: row.id,
                  sku: row.sku || undefined,
                  price: row.price,
                  compareAtPrice: row.compareAtPrice || "",
                  stock: Number(row.stock) || 0,
                  combination: row.combination,
                })),
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(`${result.message} Reload to see saved ids.`);
            });
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save variants
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function StatusSection({
  storeId,
  productId,
  status,
  variantCount,
  permissions,
}: {
  storeId: string;
  productId: string;
  status: "draft" | "active" | "archived";
  variantCount: number;
  permissions: { publish: boolean; archive: boolean };
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(next: "draft" | "active" | "archived") {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setProductStatusAction({
        storeId,
        productId,
        status: next,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
    });
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-1 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-sm">Visibility</h2>
        <p className="text-tertiary-text text-xs">
          {status === "active"
            ? "Live on the storefront."
            : status === "archived"
              ? "Hidden. Past orders keep working."
              : `Draft, ${variantCount} ${variantCount === 1 ? "variant" : "variants"}.`}
        </p>
        {error ? (
          <p role="alert" className="text-critical text-xs">
            {error}
          </p>
        ) : null}
        {message ? (
          <output className="block text-positive text-xs">{message}</output>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status !== "active" && permissions.publish ? (
          <Button size="sm" disabled={pending} onClick={() => move("active")}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Publish
          </Button>
        ) : null}
        {status === "active" && permissions.publish ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => move("draft")}
          >
            Unpublish
          </Button>
        ) : null}
        {status !== "archived" && permissions.archive ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => move("archived")}
          >
            Archive
          </Button>
        ) : null}
        {status === "archived" && permissions.archive ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => move("draft")}
          >
            Restore to draft
          </Button>
        ) : null}
      </div>
    </section>
  );
}
