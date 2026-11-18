import { Tracker } from "@/components/analytics/tracker";
import { BottomBar } from "@/components/shop/bottom-bar";
import { CartProvider } from "@/components/shop/cart-provider";
import { SiteHeader } from "@/components/shop/site-header";
import { getPlatformAccess, getUserStores } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { getCart } from "@/lib/cart";
import { getCategoryTree } from "@/lib/catalog/queries";
import { getTheme } from "@/lib/theme.server";

/**
 * Storefront shell.
 *
 * Different navigation shape per breakpoint over one information
 * architecture: a two-row top nav on desktop, a bottom bar plus a drill-down
 * drawer on mobile. See docs/ui-brief.md.
 *
 * The bottom padding on <main> clears the fixed bottom bar. Without it the
 * last row of any list sits underneath it and looks like a rendering bug.
 */
export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const [tree, theme, session, cart, stores, platform] = await Promise.all([
    getCategoryTree(),
    getTheme(),
    getSession(),
    getCart(),
    getUserStores(),
    getPlatformAccess(),
  ]);

  return (
    <CartProvider initialCount={cart.itemCount}>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader
          tree={tree}
          theme={theme}
          account={
            session
              ? {
                  name: session.user.name,
                  email: session.user.email,
                  stores,
                  isStaff: (platform?.permissions.size ?? 0) > 0,
                }
              : null
          }
        />

        <main className="flex-1 pb-24 md:pb-12">{children}</main>
        {/*
          Once, at the root. Page views have to be recorded on client-side
          navigations too, and a per-page effect would miss every one of them
          after the first load.
        */}
        <Tracker />

        <footer
          data-print-hide
          className="hidden border-border border-t px-6 py-8 md:block"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 text-secondary-text text-sm">
            <span>Marketplace</span>
            <span className="text-tertiary-text text-xs">
              Items from several sellers, one cart, one payment.
            </span>
          </div>
        </footer>

        <BottomBar tree={tree} signedIn={Boolean(session)} />
      </div>
    </CartProvider>
  );
}
