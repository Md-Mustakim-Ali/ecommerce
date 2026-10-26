import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPlatformAccess, getUserStores } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/guards";
import { getTheme } from "@/lib/theme.server";

/**
 * Seller dashboard shell.
 *
 * Deliberately plain — AGENTS.md puts the design effort on the storefront and
 * says boring is correct here. Dense, fast, legible.
 *
 * This is the real auth gate. proxy.ts only does an optimistic cookie check to
 * keep signed-out visitors off the route; a forged cookie gets past it and
 * fails here. Per-store permission checks happen further in, because access is
 * per store rather than per user.
 *
 * The header carries the account menu, which is the way out. Before it, this
 * shell showed an email address as plain text and offered no sign-out and no
 * route back to the storefront — so the only exit from the dashboard was
 * editing the URL.
 */
export default async function SellerLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const [user, theme, stores, platform] = await Promise.all([
    requireUser(),
    getTheme(),
    getUserStores(),
    getPlatformAccess(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-border border-b bg-surface-1/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          {/*
            A breadcrumb rather than a bare title, because /dashboard is the
            store list and someone with more than one store needs a way back to
            it. The store's own name is added by the page below.
          */}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
            <Link
              href="/dashboard"
              className="shrink-0 font-semibold text-sm tracking-tight hover:underline"
            >
              Seller dashboard
            </Link>
            {stores.length > 1 ? (
              <>
                <ChevronRight
                  aria-hidden
                  className="mx-1 size-3.5 shrink-0 text-tertiary-text"
                />
                <span className="truncate text-secondary-text text-xs">
                  {stores.length} stores
                </span>
              </>
            ) : null}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle value={theme} />
            <AccountMenu
              name={user.name}
              email={user.email}
              stores={stores}
              isStaff={(platform?.permissions.size ?? 0) > 0}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
