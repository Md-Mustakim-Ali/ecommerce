import { eq, sql } from "drizzle-orm";
import {
  ArrowRight,
  Heart,
  LayoutDashboard,
  MapPin,
  Package,
  Shield,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getPlatformAccess, getUserStores } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime/format";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { listOrdersForBuyer } from "@/lib/orders/queries";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Your profile" };

const ORDER_BADGE: Record<
  string,
  "default" | "muted" | "neutral" | "positive" | "critical"
> = {
  pending: "neutral",
  paid: "positive",
  partially_fulfilled: "muted",
  fulfilled: "positive",
  cancelled: "critical",
  refunded: "critical",
};

/**
 * The signed-in person's profile.
 *
 * Previously a narrow centred card that read as a modal: a name, an email and
 * four links, vertically centred in an empty viewport. It looked like a
 * placeholder because it behaved like one — nothing about the account was
 * actually on it, and every real answer ("where is my order?") was one more
 * click away behind a link that did not say.
 *
 * Now it answers the question people come here with. Recent orders are on the
 * page, with their status and total, because that is what an account page is
 * for on a shop. Everything else is secondary and sits beside it.
 */
export default async function AccountPage() {
  const user = await requireUser();

  const [orders, stores, platform, saved] = await Promise.all([
    listOrdersForBuyer(user.id),
    getUserStores(),
    getPlatformAccess(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, user.id)),
  ]);

  const isStaff = (platform?.permissions.size ?? 0) > 0;
  const savedCount = saved[0]?.count ?? 0;
  const recent = orders.slice(0, 5);

  // Lifetime, from what the buyer actually paid. Cancelled and refunded orders
  // are excluded: counting money that came back would be a number nobody
  // recognises.
  const spent = orders
    .filter(
      (order) => order.status !== "cancelled" && order.status !== "refunded",
    )
    .reduce((sum, order) => sum + order.totalCents, 0);

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || user.email[0]?.toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-lg"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-2xl tracking-tight">
            {user.name}
          </h1>
          <p className="truncate text-secondary-text text-sm">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      {/*
        Three numbers rather than a wall of them. Orders, spend and saved items
        are the only facts a shopper recognises about their own account.
      */}
      <dl className="grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-3">
        <Stat label="Orders" value={String(orders.length)} />
        <Stat label="Spent" value={formatMoney(spent, PLATFORM_CURRENCY)} />
        <Stat label="Saved" value={String(savedCount)} />
      </dl>

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium text-sm">Recent orders</h2>
            {orders.length > recent.length ? (
              <Link
                href="/account/orders"
                className="inline-flex items-center gap-1 text-accent-text text-sm underline-offset-4 hover:underline"
              >
                All {orders.length}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>

          {recent.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-border border-dashed px-5 py-8">
              <p className="text-secondary-text text-sm">
                Nothing ordered yet. When you do, it shows up here with its
                status and tracking.
              </p>
              <Button size="sm" render={<Link href="/search" />}>
                Start browsing
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-px overflow-hidden rounded-xl bg-border">
              {recent.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface-1 px-4 py-3.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-medium text-sm">
                        {order.orderNumber}
                      </span>
                      <span className="block text-tertiary-text text-xs">
                        {order.placedAt
                          ? formatDateTime(order.placedAt)
                          : "Not placed"}
                      </span>
                    </span>
                    <span className="tabular shrink-0 font-medium text-sm">
                      {formatMoney(order.totalCents, order.currency)}
                    </span>
                    <Badge variant={ORDER_BADGE[order.status] ?? "neutral"}>
                      {order.status.replace(/_/g, " ")}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <h2 className="font-medium text-sm">Shortcuts</h2>

          <nav className="flex flex-col gap-2">
            <Shortcut
              href="/account/orders"
              icon={Package}
              label="Order history"
              hint={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
            />
            <Shortcut
              href="/account/saved"
              icon={Heart}
              label="Saved items"
              hint={`${savedCount} saved`}
            />
            <Shortcut
              href="/account/addresses"
              icon={MapPin}
              label="Addresses"
              hint="For checkout"
            />
          </nav>

          {stores.length > 0 || isStaff ? (
            <>
              <Separator />
              <h2 className="font-medium text-sm">Managing</h2>
              <nav className="flex flex-col gap-2">
                {/*
                  Every store, not just the first. Someone with access to more
                  than one had no way to pick between them from here.
                */}
                {stores.map((store) => (
                  <Shortcut
                    key={store.id}
                    href={`/dashboard/${store.id}`}
                    icon={LayoutDashboard}
                    label={store.name}
                    hint="Seller dashboard"
                  />
                ))}
                {isStaff ? (
                  <Shortcut
                    href="/admin"
                    icon={Shield}
                    label="Admin panel"
                    hint="Platform staff"
                  />
                ) : null}
              </nav>
            </>
          ) : null}

          {/*
            No "unverified" badge. Transactional email is configurable but not
            configured here, so showing a state nobody can resolve reads as a
            problem with the account rather than with the deployment.
          */}
          <p className="text-tertiary-text text-xs leading-relaxed">
            Email delivery is not configured in this environment, so no receipts
            or verification messages are sent.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-1 px-5 py-4">
      <dt className="text-secondary-text text-xs">{label}</dt>
      <dd className="tabular font-semibold text-xl">{value}</dd>
    </div>
  );
}

function Shortcut({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: typeof Package;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-2"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-secondary-text" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        <span className="block truncate text-tertiary-text text-xs">
          {hint}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-3.5 shrink-0 text-tertiary-text"
      />
    </Link>
  );
}
