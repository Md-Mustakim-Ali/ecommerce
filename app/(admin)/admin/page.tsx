import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformPermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { brands, products, stores, tags } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Admin" };

function Stat({
  label,
  value,
  href,
  emphasis,
}: {
  label: string;
  value: number;
  href?: string;
  emphasis?: boolean;
}) {
  const body = (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-1 p-4">
      <span className="text-secondary-text text-xs">{label}</span>
      <span
        className={`tabular font-semibold text-2xl ${emphasis && value > 0 ? "text-critical" : ""}`}
      >
        {value}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function AdminOverviewPage() {
  await requirePlatformPermission("platform.store.view");

  // One round trip rather than six. At admin volumes it barely matters, but
  // the pattern is worth keeping once these become real aggregates.
  const [row] = await db
    .select({
      stores: sql<number>`(select count(*) from ${stores})::int`,
      pendingStores: sql<number>`(select count(*) from ${stores} where status = 'pending')::int`,
      products: sql<number>`(select count(*) from ${products})::int`,
      activeProducts: sql<number>`(select count(*) from ${products} where status = 'active')::int`,
      pendingBrands: sql<number>`(select count(*) from ${brands} where status = 'pending')::int`,
      pendingTags: sql<number>`(select count(*) from ${tags} where status = 'pending')::int`,
    })
    .from(sql`(select 1) as _`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-semibold text-xl">Overview</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Stores" value={row.stores} href="/admin/stores" />
        <Stat label="Products" value={row.products} />
        <Stat label="Live products" value={row.activeProducts} />
        <Stat
          label="Stores awaiting approval"
          value={row.pendingStores}
          href="/admin/stores"
          emphasis
        />
        <Stat
          label="Brands awaiting review"
          value={row.pendingBrands}
          href="/admin/catalog"
          emphasis
        />
        <Stat
          label="Tags awaiting review"
          value={row.pendingTags}
          href="/admin/catalog"
          emphasis
        />
      </div>

      <p className="text-secondary-text text-sm">
        Revenue, commission and forecasts are on{" "}
        <Link href="/admin/analytics" className="underline underline-offset-4">
          Analytics
        </Link>
        ; money owed to sellers is on{" "}
        <Link href="/admin/payouts" className="underline underline-offset-4">
          Payouts
        </Link>
        .
      </p>
    </div>
  );
}
