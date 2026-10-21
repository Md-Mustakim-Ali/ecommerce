import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/money/format";
import { listOrdersForBuyer } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Your orders" };

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await listOrdersForBuyer(user.id);

  if (orders.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-surface-2">
          <PackageOpen className="size-6 text-tertiary-text" aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">No orders yet</p>
          <p className="text-secondary-text text-sm">
            Anything you buy from any store shows up here.
          </p>
        </div>
        <Button render={<Link href="/search" />}>Start browsing</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">Your orders</h1>

      <ul className="flex flex-col gap-px overflow-hidden rounded-xl bg-border">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/orders/${order.id}`}
              className="flex items-center justify-between gap-4 bg-surface-1 px-5 py-4 hover:bg-surface-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-mono font-medium text-sm">
                  {order.orderNumber}
                </span>
                <span className="text-tertiary-text text-xs">
                  {order.placedAt?.toLocaleDateString() ?? "—"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular text-sm">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
                <Badge
                  variant={order.status === "paid" ? "positive" : "neutral"}
                >
                  {order.status}
                </Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
