import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiscountManager } from "@/components/dashboard/discount-manager";
import { listDiscountsAction } from "@/lib/actions/discount-admin";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Discounts" };

export default async function StoreDiscountsPage({
  params,
}: PageProps<"/dashboard/[storeId]/discounts">) {
  const { storeId } = await params;
  await requireStorePermission(storeId, "placement.manage");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const discounts = await listDiscountsAction({ scope: "store", storeId });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Discounts</h1>
          <p className="text-secondary-text text-sm">{store.name}</p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      <DiscountManager
        scope={{ scope: "store", storeId }}
        discounts={discounts}
        canCreate
      />
    </div>
  );
}
