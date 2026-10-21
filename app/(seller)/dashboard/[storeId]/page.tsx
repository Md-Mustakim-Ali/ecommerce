import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getStoreAccess } from "@/lib/auth/access";
import { permissionGroups, type StorePermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { products, stores } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Store" };

/** Nav entries, each gated on the permission that its destination requires. */
const SECTIONS: {
  href: (storeId: string) => string;
  label: string;
  description: string;
  permission: StorePermission;
}[] = [
  {
    href: (id) => `/dashboard/${id}/products/new`,
    label: "Add a product",
    description: "Create a listing, pick a brand and tags.",
    permission: "product.create",
  },
  {
    href: (id) => `/dashboard/${id}/content`,
    label: "Pages and offers",
    description: "Custom pages, banners and promotions.",
    permission: "page.view",
  },
  {
    href: (id) => `/dashboard/${id}/orders`,
    label: "Orders",
    description: "Accept, ship and track.",
    permission: "order.view",
  },
  {
    href: (id) => `/dashboard/${id}/staff`,
    label: "Staff and roles",
    description: "Invite people and decide what they can do.",
    permission: "member.view",
  },
  {
    href: (id) => `/dashboard/${id}/payouts`,
    label: "Payouts",
    description: "Balance and payout history.",
    permission: "payout.view",
  },
];

export default async function StoreOverviewPage({
  params,
}: PageProps<"/dashboard/[storeId]">) {
  const { storeId } = await params;

  const access = await getStoreAccess(storeId);
  // notFound rather than forbidden: no reason to confirm the store exists to
  // somebody with no access to it.
  if (!access || access.membershipStatus === "none") notFound();

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true, slug: true, status: true },
  });
  if (!store) notFound();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.storeId, storeId));

  const visible = SECTIONS.filter((s) => access.permissions.has(s.permission));
  const groups = permissionGroups("store");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">{store.name}</h1>
          <p className="text-secondary-text text-sm">
            {count} products · /{store.slug}
          </p>
        </div>
        <Badge variant={access.isOwner ? "default" : "neutral"}>
          {access.isOwner ? "Owner" : "Staff"}
        </Badge>
      </div>

      {visible.length > 0 ? (
        <ul className="grid gap-px overflow-hidden rounded-md bg-border sm:grid-cols-2">
          {visible.map((section) => (
            <li key={section.label}>
              <Link
                href={section.href(storeId)}
                className="flex h-full flex-col gap-1 bg-surface-1 px-4 py-3 hover:bg-surface-2"
              >
                <span className="font-medium text-sm">{section.label}</span>
                <span className="text-secondary-text text-xs">
                  {section.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-secondary-text text-sm">
          Your role does not grant access to anything in this store yet.
        </p>
      )}

      <Separator />

      {/*
        Showing the actual permission set is not decoration. When someone asks
        "why can't I ship this order", this page answers it without anyone
        having to read the roles table.
      */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">What you can do here</h2>
          <p className="text-secondary-text text-xs">
            {access.isOwner
              ? "You own this store, so you hold every permission and cannot be locked out."
              : `Granted by your role${access.permissions.size === 0 ? "" : "s"}.`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const held = group.items.filter((item) =>
              access.permissions.has(item.key as StorePermission),
            );
            if (held.length === 0) return null;
            return (
              <div key={group.name} className="flex flex-col gap-1.5">
                <h3 className="font-medium text-tertiary-text text-xs">
                  {group.name}
                </h3>
                <ul className="flex flex-wrap gap-1">
                  {held.map((item) => (
                    <li key={item.key}>
                      <Badge variant="outline">{item.label}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
