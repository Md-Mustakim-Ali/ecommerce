import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartProvider } from "@/components/shop/cart-provider";
import { ProductCard } from "@/components/shop/product-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ProductCardSkeleton,
  ProductDetailSkeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";
import type { ProductListItem } from "@/lib/catalog/queries";
import { getTheme } from "@/lib/theme.server";

export const metadata: Metadata = { title: "Tokens" };

/**
 * Internal reference surface. Every token and every component state on one
 * page, so inconsistency is caught here rather than discovered across eight
 * screens later.
 *
 * Check it in light, dark, and system, and at 320px width.
 */

const DEMO_PRODUCTS: ProductListItem[] = [
  {
    id: "demo-1",
    slug: "merino-overshirt",
    title: "Merino wool overshirt, unlined",
    storeName: "Northmark Supply",
    storeSlug: "northmark-supply",
    brandName: "Northmark",
    priceCents: 18900,
    maxPriceCents: 24900,
    compareAtCents: 24900,
    compareAtMaxCents: 28900,
    stock: 12,
    imageUrl: null,
    blurDataUrl: null,
    variantCount: 1,
    defaultVariantId: null,
    ratingAverage: 4.6,
    ratingCount: 24,
    stockDisplay: "when_low" as const,
    lowStockThreshold: 5,
  },
  {
    id: "demo-2",
    slug: "walnut-desk-tray",
    title: "Walnut desk tray",
    storeName: "Oakline",
    storeSlug: "oakline",
    brandName: "Oakline",
    priceCents: 6400,
    maxPriceCents: 6400,
    compareAtCents: null,
    compareAtMaxCents: null,
    stock: 3,
    imageUrl: null,
    blurDataUrl: null,
    variantCount: 1,
    defaultVariantId: null,
    ratingAverage: 4.6,
    ratingCount: 24,
    stockDisplay: "when_low" as const,
    lowStockThreshold: 5,
  },
  {
    id: "demo-3",
    slug: "field-notebook",
    title: "Field notebook, dot grid, 3-pack",
    storeName: "Paper & Press",
    storeSlug: "paper-and-press",
    brandName: null,
    priceCents: 2200,
    maxPriceCents: 2200,
    compareAtCents: null,
    compareAtMaxCents: null,
    stock: 0,
    imageUrl: null,
    blurDataUrl: null,
    variantCount: 1,
    defaultVariantId: null,
    ratingAverage: 4.6,
    ratingCount: 24,
    stockDisplay: "when_low" as const,
    lowStockThreshold: 5,
  },
  {
    id: "demo-4",
    slug: "linen-cushion",
    title: "Washed linen cushion cover",
    storeName: "Halden Home",
    storeSlug: "halden-home",
    brandName: "Halden",
    priceCents: 4500,
    maxPriceCents: 4500,
    compareAtCents: 5900,
    compareAtMaxCents: 5900,
    stock: 28,
    imageUrl: null,
    blurDataUrl: null,
    variantCount: 1,
    defaultVariantId: null,
    ratingAverage: 4.6,
    ratingCount: 24,
    stockDisplay: "when_low" as const,
    lowStockThreshold: 5,
  },
];

const SURFACES = [
  ["surface-sunken", "bg-surface-sunken"],
  ["surface-0", "bg-surface-0"],
  ["surface-1", "bg-surface-1"],
  ["surface-2", "bg-surface-2"],
  ["surface-3", "bg-surface-3"],
] as const;

const TEXT = [
  ["text-primary", "text-primary-text"],
  ["text-secondary", "text-secondary-text"],
  ["text-tertiary", "text-tertiary-text"],
  ["accent-text", "text-accent-text"],
] as const;

const STATUS = [
  ["accent", "bg-accent", "text-on-accent"],
  ["accent-muted", "bg-accent-muted", "text-accent-text"],
  ["positive", "bg-positive", "text-surface-1"],
  ["positive-muted", "bg-positive-muted", "text-positive"],
  ["critical", "bg-critical", "text-surface-1"],
  ["critical-muted", "bg-critical-muted", "text-critical"],
] as const;

const ELEVATION = ["shadow-e1", "shadow-e2", "shadow-e3", "shadow-e4"] as const;

const RADIUS = [
  ["xs", "rounded-xs"],
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
  ["2xl", "rounded-2xl"],
] as const;

const BUTTON_VARIANTS = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const BADGE_VARIANTS = [
  "default",
  "muted",
  "neutral",
  "outline",
  "positive",
  "critical",
] as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
        {note ? <p className="text-secondary-text text-sm">{note}</p> : null}
      </div>
      {children}
      <Separator className="mt-2" />
    </section>
  );
}

export default async function TokensPage() {
  // Internal only. Shipping a design-system dump to production is free recon
  // for anyone probing the site.
  if (process.env.NODE_ENV === "production") notFound();

  const theme = await getTheme();

  return (
    // The cards use quick-add, which needs the cart context the shop layout
    // normally provides. This page sits outside that layout.
    <CartProvider initialCount={0}>
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-2xl tracking-tight">
              Design tokens
            </h1>
            <p className="text-secondary-text text-sm">
              Check every section in light, dark, and system.
            </p>
          </div>
          <ThemeToggle value={theme} />
        </header>

        <Section
          title="Feel"
          note="Scroll for parallax on the imagery and the settle as cards arrive. The card's hover lift sits on the inner article rather than the element the grid animates on scroll: two systems on one transform means one of them silently loses."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {DEMO_PRODUCTS.map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                className="scroll-settle"
              />
            ))}
          </div>
        </Section>

        <Section
          title="Surfaces"
          note="Elevation ascends toward the viewer. In dark mode this is carried by lightness, not shadow."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SURFACES.map(([name, className]) => (
              <div
                key={name}
                className={`${className} flex h-24 flex-col justify-end rounded-lg border border-border p-3`}
              >
                <span className="font-mono text-[0.6875rem] text-secondary-text">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Text"
          note="Primary and secondary clear 4.5:1 on every surface. Tertiary is for de-emphasised metadata and clears 3:1."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {SURFACES.slice(1).map(([surface, bg]) => (
              <div
                key={surface}
                className={`${bg} flex flex-col gap-1.5 rounded-lg border border-border p-4`}
              >
                <span className="font-mono text-[0.6875rem] text-tertiary-text">
                  on {surface}
                </span>
                {TEXT.map(([name, cls]) => (
                  <p key={name} className={`${cls} text-sm`}>
                    {name} — The quick brown fox jumps over the lazy dog
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Status"
          note="Each pairs a muted tint with its full-strength colour as text."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STATUS.map(([name, bg, fg]) => (
              <div
                key={name}
                className={`${bg} ${fg} flex h-20 flex-col justify-end rounded-lg p-3`}
              >
                <span className="font-mono text-[0.6875rem]">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Elevation"
          note="Hover the first tile to see the pointer-reactive lift."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="elevate grid h-24 place-items-center rounded-lg bg-surface-1">
              <span className="font-mono text-[0.6875rem] text-secondary-text">
                .elevate
              </span>
            </div>
            {ELEVATION.map((shadow) => (
              <div
                key={shadow}
                className={`${shadow} grid h-24 place-items-center rounded-lg bg-surface-1`}
              >
                <span className="font-mono text-[0.6875rem] text-secondary-text">
                  {shadow}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radius">
          <div className="flex flex-wrap gap-3">
            {RADIUS.map(([name, cls]) => (
              <div
                key={name}
                className={`${cls} grid size-20 place-items-center border border-border-strong bg-surface-1`}
              >
                <span className="font-mono text-[0.6875rem] text-secondary-text">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Buttons"
          note="Default is 44px — a comfortable touch target. sm (36px) is the dense variant for the seller dashboard."
        >
          <div className="flex flex-col gap-4">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-3">
                <span className="w-24 font-mono text-[0.6875rem] text-tertiary-text">
                  {variant}
                </span>
                <Button variant={variant} size="sm">
                  Small
                </Button>
                <Button variant={variant}>Default</Button>
                <Button variant={variant} size="lg">
                  Large
                </Button>
                <Button variant={variant} disabled>
                  Disabled
                </Button>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Inputs"
          note="Sunken wells. 16px text on mobile so iOS Safari does not zoom on focus."
        >
          <div className="grid max-w-md gap-4">
            <div className="grid gap-2">
              <Label htmlFor="t-default">Default</Label>
              <Input id="t-default" placeholder="Search products" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-filled">Filled</Label>
              <Input id="t-filled" defaultValue="Merino wool overshirt" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-invalid">Invalid</Label>
              <Input id="t-invalid" aria-invalid defaultValue="not-an-email" />
              <p role="alert" className="text-critical text-sm">
                Enter a valid email address.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-disabled">Disabled</Label>
              <Input id="t-disabled" disabled defaultValue="Locked" />
            </div>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
        </Section>

        <Section
          title="Loading"
          note="Layout-shaped, not grey blocks. The skeleton is pixel-identical to the real card beside it, so nothing moves when content arrives."
        >
          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ProductCard product={DEMO_PRODUCTS[0]} />
              <ProductCardSkeleton />
              <ProductCardSkeleton />
              <ProductCardSkeleton />
            </div>
            <ProductDetailSkeleton />
            <TableSkeleton rows={4} />
          </div>
        </Section>

        <Section
          title="Numerals"
          note="Prices and SKUs use tabular figures so digits do not reflow as values change."
        >
          <div className="flex flex-col gap-1 text-sm">
            <span className="tabular">1,240.00 — tabular</span>
            <span className="tabular">9,999.99 — tabular</span>
            <span>1,240.00 — proportional</span>
            <span>9,999.99 — proportional</span>
            <span className="font-mono text-secondary-text">
              SKU-8842-NVY-M
            </span>
          </div>
        </Section>

        <Section
          title="Admin scope"
          note="The same components under .theme-admin: stock shadcn, monochrome, flat. Never seen by customers."
        >
          <div className="theme-admin flex flex-col gap-4 rounded-lg border border-border bg-surface-0 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Primary</Button>
              <Button size="sm" variant="outline">
                Outline
              </Button>
              <Button size="sm" variant="secondary">
                Secondary
              </Button>
              <Button size="sm" variant="ghost">
                Ghost
              </Button>
            </div>
            <Input placeholder="Search orders" />
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">default</Badge>
              <Badge variant="neutral">neutral</Badge>
              <Badge variant="outline">outline</Badge>
              <Badge variant="positive">positive</Badge>
              <Badge variant="critical">critical</Badge>
            </div>
            <p className="text-secondary-text text-sm">
              Status colours stay coloured here on purpose — a failed payout has
              to read as failed.
            </p>
          </div>
        </Section>
      </div>
    </CartProvider>
  );
}
