import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
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
 */
export default async function SellerLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const [user, theme] = await Promise.all([requireUser(), getTheme()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-border border-b bg-surface-1/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link
            href="/dashboard"
            className="font-semibold text-sm tracking-tight"
          >
            Seller dashboard
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-secondary-text text-xs sm:inline">
              {user.email}
            </span>
            <ThemeToggle value={theme} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
