import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allOrdersAction } from "@/lib/actions/moderation";
import { requirePlatformPermission } from "@/lib/auth/access";
import { formatMoney } from "@/lib/money/format";

export const metadata: Metadata = { title: "Orders" };

/**
 * Every order, for support.
 *
 * Search is a GET form so the result is a URL — a support person can paste it
 * into a ticket and whoever picks it up lands on the same order.
 */
export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  await requirePlatformPermission("platform.order.view");
  const query = await searchParams;
  const q = Array.isArray(query.q) ? query.q[0] : (query.q ?? "");

  const orders = await allOrdersAction({ query: q || undefined });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Orders</h1>
        <p className="text-muted-foreground text-sm">
          {orders.length} shown{q ? ` matching "${q}"` : ""}.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Order number or buyer email"
          className="max-w-sm"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          No orders match that.
        </p>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-background px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={`/orders/${order.id}`}
                  className="font-mono font-medium text-sm hover:underline"
                >
                  {order.orderNumber}
                </Link>
                <span className="truncate text-muted-foreground text-xs">
                  {order.email} · {order.storeCount}{" "}
                  {order.storeCount === 1 ? "seller" : "sellers"}
                  {order.placedAt
                    ? ` · ${order.placedAt.toLocaleDateString()}`
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-sm">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
                <Badge
                  variant={
                    order.status === "cancelled" || order.status === "refunded"
                      ? "critical"
                      : order.status === "pending"
                        ? "neutral"
                        : "positive"
                  }
                >
                  {order.status}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
