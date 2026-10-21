import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PlacementSlot } from "@/components/content/placement-slot";
import { ProductGrid } from "@/components/shop/product-grid";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/guards";
import {
  getCategoryTree,
  getSavedProductIds,
  listProducts,
} from "@/lib/catalog/queries";

export default async function HomePage() {
  const [newest, tree, session] = await Promise.all([
    listProducts({ sort: "newest", perPage: 8 }),
    getCategoryTree(),
    getSession(),
  ]);

  const savedIds = await getSavedProductIds(
    session?.user.id ?? null,
    newest.items.map((p) => p.id),
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
      <PlacementSlot route={{ kind: "home" }} slot="above_content" />
      {/*
        The one deliberate non-user-triggered moment on the site, per
        AGENTS.md. An ambient wash rather than an entrance animation.
      */}
      <section className="ambient relative overflow-hidden rounded-2xl border border-border px-6 py-14 sm:px-12 sm:py-20">
        <div className="flex max-w-xl flex-col gap-5">
          <h1 className="font-semibold text-3xl leading-tight tracking-tight sm:text-5xl">
            Everything, from every seller, in one cart.
          </h1>
          <p className="text-lg text-secondary-text">
            Independent stores, one checkout. Buy from four of them at once and
            pay once.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" render={<Link href="/search" />}>
              Start browsing
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={<Link href="/dashboard" />}
            >
              Sell here
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-semibold text-xl tracking-tight">
            Browse by category
          </h2>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tree.map((node) => (
            <li key={node.id}>
              <Link
                href={`/c/${node.slug}`}
                className="elevate flex h-full flex-col justify-between gap-6 rounded-xl bg-surface-1 p-5"
              >
                <span className="font-medium">{node.name}</span>
                <span className="text-secondary-text text-xs">
                  {node.children.length} sections
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-semibold text-xl tracking-tight">Just listed</h2>
          <Link
            href="/search?sort=newest"
            className="inline-flex items-center gap-1 text-accent-text text-sm underline-offset-4 hover:underline"
          >
            See all
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <ProductGrid products={newest.items} savedIds={savedIds} />
      </section>

      <PlacementSlot route={{ kind: "home" }} slot="below_content" />
    </div>
  );
}
