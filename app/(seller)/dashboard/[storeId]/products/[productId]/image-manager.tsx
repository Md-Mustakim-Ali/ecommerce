"use client";

import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  deleteProductImageAction,
  reorderProductImagesAction,
  tagProductImageAction,
  uploadProductImageAction,
} from "@/lib/actions/product-images";
import type { EditorAttribute } from "@/lib/catalog/product-editor";

export type EditorImage = {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  blurDataUrl: string | null;
  /** attributeId -> valueId. Empty when the photo is not option-specific. */
  tags: Record<string, string>;
};

/**
 * Product images, and what each one is a photo of.
 *
 * Tagging is the part that matters. An image pinned to Navy shows the moment a
 * shopper picks Navy, and one pinned to Navy + Large takes over from it when
 * both are chosen — most specific wins. An untagged image is a general product
 * photo and always eligible.
 *
 * Ordering is arrows rather than drag. Drag-and-drop needs a pointer, a
 * keyboard path and a screen-reader path to be usable by everyone, and two
 * buttons are all three at once.
 */
export function ImageManager({
  storeId,
  productId,
  images,
  attributes,
  canEdit,
}: {
  storeId: string;
  productId: string;
  images: EditorImage[];
  attributes: EditorAttribute[];
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState(images);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Only attributes with values are taggable; a spec with nothing chosen
  // cannot narrow a photo to anything.
  const taggable = attributes.filter((a) => a.values.length > 0);

  function upload(file: File) {
    setError(null);
    setMessage(null);
    const data = new FormData();
    data.set("storeId", storeId);
    data.set("productId", productId);
    data.set("file", file);

    startTransition(async () => {
      const result = await uploadProductImageAction(data);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage("Uploaded. Reload to tag it.");
    });
  }

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);

    startTransition(async () => {
      const result = await reorderProductImagesAction({
        storeId,
        productId,
        imageIds: next.map((image) => image.id),
      });
      if (!result.ok) {
        setError(result.message);
        setOrder(order);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Images</h2>
          <p className="text-tertiary-text text-xs">
            The first is the one shoppers see in listings. Tag a photo with an
            option and the gallery jumps to it when that option is picked.
          </p>
        </div>

        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
                // Cleared so choosing the same file twice still fires change.
                event.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ImagePlus aria-hidden />
              )}
              Upload
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      {order.length === 0 ? (
        <div className="rounded-md border border-border border-dashed px-4 py-8 text-center">
          <p className="text-secondary-text text-sm">
            No images yet. A listing without one rarely sells.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {order.map((image, index) => (
            <li
              key={image.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
            >
              <div className="relative aspect-square overflow-hidden rounded-md bg-surface-3">
                <Image
                  src={image.url}
                  alt={image.alt ?? ""}
                  fill
                  sizes="(max-width: 640px) 100vw, 300px"
                  className="object-cover"
                  placeholder={image.blurDataUrl ? "blur" : "empty"}
                  blurDataURL={image.blurDataUrl ?? undefined}
                />
                {index === 0 ? (
                  <span className="absolute top-2 left-2">
                    <Badge variant="default">Cover</Badge>
                  </span>
                ) : null}
              </div>

              {canEdit ? (
                <>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move earlier"
                      disabled={index === 0 || pending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowLeft aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move later"
                      disabled={index === order.length - 1 || pending}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowRight aria-hidden />
                    </Button>
                    <span className="flex-1" />
                    <DeleteImage
                      storeId={storeId}
                      productId={productId}
                      imageId={image.id}
                      onDone={() =>
                        setOrder((current) =>
                          current.filter((row) => row.id !== image.id),
                        )
                      }
                    />
                  </div>

                  {taggable.length > 0 ? (
                    <TagPicker
                      storeId={storeId}
                      productId={productId}
                      image={image}
                      attributes={taggable}
                    />
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeleteImage({
  storeId,
  productId,
  imageId,
  onDone,
}: {
  storeId: string;
  productId: string;
  imageId: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Remove image"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden />
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteProductImageAction({
              storeId,
              productId,
              imageId,
            });
            if (result.ok) onDone();
            setConfirming(false);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Remove
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

/**
 * Which options this photo is of.
 *
 * One value per attribute, enforced by the primary key on the join table as
 * well as here: a photo tagged both Navy and Charcoal could never be shown,
 * because no single selection satisfies both.
 */
function TagPicker({
  storeId,
  productId,
  image,
  attributes,
}: {
  storeId: string;
  productId: string;
  image: EditorImage;
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
