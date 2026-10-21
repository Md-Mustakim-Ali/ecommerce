import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/shop/product-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listProducts } from "@/lib/catalog/queries";
import { type ParsedBlock, parseBlock } from "@/lib/content/blocks";
import { cn } from "@/lib/utils";

/**
 * Renders a stored block.
 *
 * Data is re-validated on the way out as well as on the way in. Content
 * written months ago against an older schema is skipped rather than allowed to
 * throw — a stale block must not be able to take a storefront page down.
 *
 * Same component renders page blocks and placements, so a banner looks
 * identical whether it was placed on a custom page or injected into the home
 * page.
 */
export async function BlockRenderer({
  blocks,
}: {
  blocks: { id: string; type: string; data: unknown }[];
}) {
  const parsed = blocks
    .map(parseBlock)
    .filter((block): block is ParsedBlock => block !== null);

  if (parsed.length === 0) return null;

  return (
    <>
      {parsed.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </>
  );
}

async function Block({ block }: { block: ParsedBlock }) {
  const data = block.data as Record<string, never>;

  switch (block.type) {
    case "heading": {
      const level = data.level as unknown as 2 | 3;
      const Tag = level === 3 ? "h3" : "h2";
      return (
        <Tag
          className={cn(
            "font-semibold tracking-tight",
            level === 3 ? "text-lg" : "text-2xl",
          )}
        >
          {data.text}
        </Tag>
      );
    }

    case "richText":
      return (
        <div className="flex max-w-2xl flex-col gap-3 text-secondary-text leading-relaxed">
          {String(data.body)
            .split(/\n{2,}/)
            .map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
        </div>
      );

    case "banner":
      return <BannerBlock data={data} />;

    case "offerCard":
      return <OfferCardBlock data={data} />;

    case "image":
      return (
        <figure className="flex flex-col gap-2">
          <div className="relative aspect-[16/7] overflow-hidden rounded-xl bg-surface-sunken">
            <Image
              src={String(data.url)}
              alt={String(data.alt)}
              fill
              sizes="(max-width: 1024px) 100vw, 1024px"
              className="object-cover"
            />
          </div>
          {data.caption ? (
            <figcaption className="text-secondary-text text-sm">
              {String(data.caption)}
            </figcaption>
          ) : null}
        </figure>
      );

    case "faq":
      return (
        <div className="flex max-w-2xl flex-col gap-3">
          {(
            data.items as unknown as { question: string; answer: string }[]
          ).map((item) => (
            <details
              key={item.question}
              className="rounded-lg border border-border bg-surface-1 p-4"
            >
              <summary className="cursor-pointer font-medium text-sm">
                {item.question}
              </summary>
              <p className="mt-2 text-secondary-text text-sm leading-relaxed">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      );

    case "productGrid":
      return <ProductGridBlock data={data} />;

    case "spacer": {
      const size = String(data.size);
      return (
        <div
          aria-hidden
          className={size === "lg" ? "h-16" : size === "sm" ? "h-4" : "h-8"}
        />
      );
    }

    default:
      return null;
  }
}

function BannerBlock({ data }: { data: Record<string, never> }) {
  const tone = String(data.tone);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4",
        tone === "accent" && "bg-accent-muted text-accent-text",
        tone === "positive" && "bg-positive-muted text-positive",
        tone === "critical" && "bg-critical-muted text-critical",
        tone === "neutral" && "bg-surface-2 text-primary-text",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{String(data.title)}</p>
        {data.body ? (
          <p className="text-sm opacity-90">{String(data.body)}</p>
        ) : null}
      </div>
      {data.ctaLabel && data.ctaHref ? (
        <Button
          size="sm"
          variant="outline"
          render={<Link href={String(data.ctaHref)} />}
        >
          {String(data.ctaLabel)}
        </Button>
      ) : null}
    </div>
  );
}

function OfferCardBlock({ data }: { data: Record<string, never> }) {
  return (
    <div className="ambient flex flex-col gap-3 overflow-hidden rounded-xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-lg">{String(data.title)}</p>
          {data.discountLabel ? (
            <Badge variant="default">{String(data.discountLabel)}</Badge>
          ) : null}
        </div>
        {data.body ? (
          <p className="max-w-prose text-secondary-text text-sm">
            {String(data.body)}
          </p>
        ) : null}
        {data.code ? (
          <p className="mt-1 font-mono text-sm">
            Code{" "}
            <span className="rounded bg-surface-2 px-2 py-0.5">
              {String(data.code)}
            </span>
          </p>
        ) : null}
      </div>
      {data.ctaLabel && data.ctaHref ? (
        <Button render={<Link href={String(data.ctaHref)} />}>
          {String(data.ctaLabel)}
        </Button>
      ) : null}
    </div>
  );
}

async function ProductGridBlock({ data }: { data: Record<string, never> }) {
  const source = String(data.source);
  const value = data.value ? String(data.value) : undefined;
  const limit = Number(data.limit ?? 8);

  const result = await listProducts({
    perPage: limit,
    sort: "newest",
    categorySlug: source === "category" ? value : undefined,
    tagSlugs: source === "tag" && value ? [value] : undefined,
    brandSlugs: source === "brand" && value ? [value] : undefined,
  });

  return (
    <section className="flex flex-col gap-4">
      {data.title ? (
        <h2 className="font-semibold text-xl tracking-tight">
          {String(data.title)}
        </h2>
      ) : null}
      <ProductGrid products={result.items} />
    </section>
  );
}
