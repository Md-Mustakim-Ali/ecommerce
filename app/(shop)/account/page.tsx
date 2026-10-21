import { LayoutDashboard, Package, Shield } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { getPlatformAccess, getUserStores } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/guards";
import { getTheme } from "@/lib/theme.server";
import { SignOutButton } from "./sign-out-button";

/**
 * The signed-in person's home.
 *
 * Its main job is getting somebody to the surface they actually came for.
 * Landing here with no route onward to the admin panel or a store dashboard is
 * a dead end, and it is not obvious from the URL that either exists.
 */
export default async function AccountPage() {
  const [user, theme, stores, platform] = await Promise.all([
    requireUser(),
    getTheme(),
    getUserStores(),
    getPlatformAccess(),
  ]);

  const isStaff = (platform?.permissions.size ?? 0) > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6 shadow-e2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-semibold text-2xl tracking-tight">Account</h1>
          <ThemeToggle value={theme} />
        </div>

        <Separator />

        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-secondary-text">Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-secondary-text">Email</dt>
            <dd className="truncate">{user.email}</dd>
          </div>
        </dl>

        <Separator />

        <nav className="flex flex-col gap-2">
          <Link
            href="/account/orders"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-surface-2"
          >
            <Package aria-hidden className="size-4 text-secondary-text" />
            Your orders
          </Link>

          {stores.length > 0 ? (
            <Link
              href={
                stores.length === 1
                  ? `/dashboard/${stores[0].id}`
                  : "/dashboard"
              }
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-surface-2"
            >
              <LayoutDashboard
                aria-hidden
                className="size-4 text-secondary-text"
              />
              <span className="min-w-0 flex-1">
                Seller dashboard
                <span className="block truncate text-tertiary-text text-xs">
                  {stores.length === 1
                    ? stores[0].name
                    : `${stores.length} stores`}
                </span>
              </span>
            </Link>
          ) : null}

          {isStaff ? (
            <Link
              href="/admin"
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-surface-2"
            >
              <Shield aria-hidden className="size-4 text-secondary-text" />
              Admin panel
            </Link>
          ) : null}
        </nav>

        {/*
          No "Not verified" badge. Transactional email is not wired up yet, so
          nothing can ever verify an address — showing an unverified state that
          the product gives you no way to resolve reads as a problem with the
          account rather than a feature that has not been built.
        */}
        <p className="text-tertiary-text text-xs">
          Email delivery is not configured yet, so no receipts or verification
          messages are sent.
        </p>

        <SignOutButton />
      </div>

      <Link
        href="/"
        className="text-center text-secondary-text text-sm underline underline-offset-4"
      >
        Back to store
      </Link>
    </main>
  );
}
