"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  mergeAttributeValueAction,
  reviewAttributeAction,
} from "@/lib/actions/moderation";

type PendingAttribute = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  unit: string | null;
  usage: number;
};

type Value = {
  id: string;
  value: string;
  slug: string;
  attributeName: string;
  usage: number;
  similar: { id: string; value: string }[];
};

/**
 * Attribute review.
 *
 * Merge-first rather than gatekeeping. Sellers add values inline while editing
 * a product — blocking a listing behind moderation for a colour name is how
 * the field stops being used and the colour ends up in the title instead — so
 * values arrive already in use and the job here is spotting duplicates.
 *
 * Only values with a near-match are shown. A list of every value a seller ever
 * added is not a queue anybody clears.
 */
export function AttributeQueue({
  attributes,
  values,
}: {
  attributes: PendingAttribute[];
  values: Value[];
}) {
  const duplicates = values.filter((v) => v.similar.length > 0);

  if (attributes.length === 0 && duplicates.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Attributes</h2>
        <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          Nothing to review. No pending attributes and no near-duplicate values.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {attributes.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium text-sm">Proposed attributes</h2>
            <p className="text-muted-foreground text-xs">
              A new attribute affects every store's filters, so these are
              reviewed before they become selectable.
            </p>
          </div>
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {attributes.map((attribute) => (
              <li key={attribute.id} className="bg-background">
                <AttributeRow attribute={attribute} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {duplicates.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium text-sm">Possible duplicate values</h2>
            <p className="text-muted-foreground text-xs">
              Values a seller added that look like one already in the
              vocabulary. Merging repoints every product and variant, and keeps
              the old id resolving.
            </p>
          </div>
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {duplicates.map((value) => (
              <li key={value.id} className="bg-background">
                <ValueRow value={value} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AttributeRow({ attribute }: { attribute: PendingAttribute }) {
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected", reason?: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await reviewAttributeAction({
        attributeId: attribute.id,
        decision,
        reason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      setRejecting(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-sm">
            {attribute.name}
            {attribute.unit ? (
              <span className="text-muted-foreground">({attribute.unit})</span>
            ) : null}
            <Badge variant="outline">{attribute.kind}</Badge>
          </span>
          <span className="text-muted-foreground text-xs">
            /{attribute.slug} ·{" "}
            {attribute.usage === 0
              ? "not used yet"
              : `used by ${attribute.usage} ${attribute.usage === 1 ? "product" : "products"}`}
          </span>
        </div>

        {!rejecting ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => decide("approved")}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>

      {rejecting ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            decide(
              "rejected",
              String(new FormData(event.currentTarget).get("reason") ?? ""),
            );
          }}
        >
          <div className="flex-1">
            <Input
              name="reason"
              required
              maxLength={300}
              placeholder="Why is this being rejected?"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRejecting(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}

function ValueRow({ value }: { value: Value }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-sm">
            {value.value}
            <Badge variant="outline">{value.attributeName}</Badge>
          </span>
          <span className="text-muted-foreground text-xs">
            {value.usage === 0
              ? "not used yet"
              : `used by ${value.usage} ${value.usage === 1 ? "product" : "products"}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <TriangleAlert aria-hidden className="size-3" />
          Looks like
        </span>
        {value.similar.map((other) => (
          <Button
            key={other.id}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              setMessage(null);
              startTransition(async () => {
                const result = await mergeAttributeValueAction({
                  valueId: value.id,
                  intoValueId: other.id,
                });
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setMessage(result.message);
              });
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Merge into {other.value}
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}
