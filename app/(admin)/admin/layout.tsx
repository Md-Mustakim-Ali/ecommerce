import Link from "next/link";
import { notFound } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPlatformAccess } from "@/lib/auth/access";
import type { PlatformPermission } from "@/lib/auth/permissions";
import { getTheme } from "@/lib/theme.server";

/**
 * Admin shell.
 *
 * `theme-admin` is the whole visual difference: it overrides the token layer
 * with the stock shadcn monochrome palette and the stock radius scale, so the
 * same Button and Input that render warm and pill-shaped on the storefront
 * render square and grey in here. No second component library.
 *
 * The real gate. proxy.ts only checks for a session cookie, which proves
 * nothing about platform access.
 */

const NAV: { href: string; label: string; permission: PlatformPermission }[] = [
  { href: "/admin", label: "Overview", permission: "platform.store.view" },
  {
    href: "/admin/catalog",
    label: "Catalog review",
    permission: "platform.brand.review",
  },
  {
    href: "/admin/content",
    label: "Content",
    permission: "platform.page.manage",
  },
  { href: "/admin/stores", label: "Stores", permission: "platform.store.view" },
  {
    href: "/admin/analytics",
    label: "Analytics",
    permission: "platform.finance.report",
  },
  {
    href: "/admin/orders",
    label: "Orders",
    permission: "platform.order.view",
  },
  {
    href: "/admin/moderation",
    label: "Moderation",
    permission: "platform.product.moderate",
  },
  {
    href: "/admin/users",
    label: "Users",
    permission: "platform.user.view",
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    permission: "platform.audit.view",
  },
  {
    href: "/admin/refunds",
    label: "Refunds",
    permission: "platform.refund.approve",
  },
  {
    href: "/admin/discounts",
    label: "Discounts",
    permission: "platform.settings.manage",
  },
  {
    // Gated on the permission the page itself requires. Listing it under
    // finance.report would show the link to someone who then gets a 404.
    href: "/admin/payouts",
    label: "Payouts",
    permission: "platform.payout.initiate",
  },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const [access, theme] = await Promise.all([getPlatformAccess(), getTheme()]);

  // A buyer or seller should not be able to tell that /admin exists at all.
  if (!access || access.permissions.size === 0) notFound();

  const visible = NAV.filter((item) => access.permissions.has(item.permission));

  return (
    <div className="theme-admin flex min-h-dvh flex-col bg-surface-0 text-primary-text">
      <header className="border-border border-b bg-surface-1">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold text-sm">
              Admin
            </Link>
            {/*
              Wraps rather than overflowing. There are eleven sections now, and
              a single non-wrapping row silently hides the last few on a laptop.
            */}
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {visible.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-secondary-text text-sm hover:text-primary-text"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <ThemeToggle value={theme} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
