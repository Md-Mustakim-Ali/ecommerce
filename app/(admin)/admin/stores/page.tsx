import type { Metadata } from "next";
import { listStoresForAdminAction } from "@/lib/actions/admin-stores";
import { requirePlatformPermission } from "@/lib/auth/access";
import { StoreQueue } from "./store-queue";

export const metadata: Metadata = { title: "Stores" };

export default async function AdminStoresPage() {
  const access = await requirePlatformPermission("platform.store.view");
  const stores = await listStoresForAdminAction();

  const pending = stores.filter((s) => s.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Stores</h1>
        <p className="text-muted-foreground text-sm">
          {stores.length} total
          {pending > 0
            ? ` · ${pending} awaiting a decision`
            : " · nothing awaiting a decision"}
        </p>
      </div>

      <StoreQueue
        stores={stores}
        canApprove={access.permissions.has("platform.store.approve")}
        canSuspend={access.permissions.has("platform.store.suspend")}
      />
    </div>
  );
}
