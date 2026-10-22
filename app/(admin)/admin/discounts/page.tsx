import type { Metadata } from "next";
import { DiscountManager } from "@/components/dashboard/discount-manager";
import { listDiscountsAction } from "@/lib/actions/discount-admin";
import { requirePlatformPermission } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Discounts" };

export default async function AdminDiscountsPage() {
  await requirePlatformPermission("platform.settings.manage");
  const discounts = await listDiscountsAction({ scope: "platform" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Discounts</h1>
        <p className="text-muted-foreground text-sm">
          Marketplace-wide codes. These come off every seller's sale, so the
          commission split absorbs them proportionally.
        </p>
      </div>

      <DiscountManager
        scope={{ scope: "platform" }}
        discounts={discounts}
        canCreate
      />
    </div>
  );
}
