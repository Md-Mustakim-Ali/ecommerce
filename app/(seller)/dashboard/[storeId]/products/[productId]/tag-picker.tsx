"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { tagProductImageAction } from "@/lib/actions/product-images";
import type { EditorAttribute } from "@/lib/catalog/product-editor";

/**
 * Which options this photo is of.
 *
 * One value per attribute, enforced by the primary key on the join table as
 * well as here: a photo tagged both Navy and Charcoal could never be shown,
 * because no single selection satisfies both.
 */
export function TagPicker({
  storeId,
  productId,
  image,
  attributes,
}: {
  storeId: string;
  productId: string;
  /** Only the two fields the picker touches, so any media row satisfies it. */
  image: { id: string; tags: Record<string, string> };
  attributes: EditorAttribute[];
}) {
  const [tags, setTags] = useState<Record<string, string>>(image.tags);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(attributeId: string, valueId: string) {
    const next = { ...tags };
    if (next[attributeId] === valueId) delete next[attributeId];
    else next[attributeId] = valueId;
    setTags(next);
    setSaved(null);
    setError(null);

    startTransition(async () => {
      const result = await tagProductImageAction({
        storeId,
        productId,
        imageId: image.id,
        valueIds: Object.values(next),
      });
      if (!result.ok) {
        setError(result.message);
        setTags(tags);
        return;
      }
      setSaved(result.message);
    });
  }

  const count = Object.keys(tags).length;

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-tertiary-text text-xs">
        {count === 0 ? "Shows for every option" : "Shows when picked"}
      </Label>

      {attributes.map((attribute) => (
        <div key={attribute.attributeId} className="flex flex-wrap gap-1">
          {attribute.values.map((value) => {
            const active = tags[attribute.attributeId] === value.id;
            const hex =
              typeof value.meta.hex === "string" ? value.meta.hex : null;
            return (
              <button
                key={value.id}
                type="button"
                disabled={pending}
                onClick={() => pick(attribute.attributeId, value.id)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  active
                    ? "border-accent bg-accent-muted text-accent-text"
                    : "border-border text-secondary-text hover:bg-surface-3"
                }`}
              >
                {hex ? (
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full border border-border-strong"
                    style={{ backgroundColor: hex }}
                  />
                ) : null}
                {value.value}
              </button>
            );
          })}
        </div>
      ))}

      {error ? (
        <span role="alert" className="text-critical text-xs">
          {error}
        </span>
      ) : saved ? (
        <span className="text-positive text-xs">{saved}</span>
      ) : null}
    </div>
  );
}
