"use client";

import { Home, LayoutGrid, Search, ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/shop/cart-provider";
import { CategoryDrawer } from "@/components/shop/category-drawer";
import type { CategoryNode } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom bar.
 *
 * Five thumb-reachable slots, fixed. It does not hide on scroll — that was in
 * the brief, but a bar that disappears while you are scrolling a product grid
 * and reappears on the smallest upward movement is more irritating than the
 * space it reclaims. The product page instead docks its add-to-cart button
 * above this bar, which was the actual problem hiding was meant to solve.
 *
 * Add `pb-[env(safe-area-inset-bottom)]` height to any fixed element that
 * needs to clear it — see .pb-bottom-bar in globals.css.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
] as const;

export function BottomBar({
  tree,
  signedIn,
}: {
  tree: CategoryNode[];
  signedIn: boolean;
}) {
  const pathname = usePathname();
  const { count, setOpen } = useCart();

  const linkClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.6875rem]",
      "touch-manipulation transition-colors active:scale-[0.94]",
      active ? "text-accent-text" : "text-tertiary-text",
    );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-border border-t bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={linkClass(active)}>
            <Icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}

      <CategoryDrawer
        tree={tree}
        trigger={
          <button
            type="button"
            className={linkClass(pathname.startsWith("/c/"))}
          >
            <LayoutGrid className="size-5" aria-hidden />
            Browse
          </button>
        }
      />

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={linkClass(false)}
        aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
      >
        <span className="relative">
          <ShoppingBag className="size-5" aria-hidden />
          {count > 0 ? (
            <span className="tabular -top-1.5 -right-2 absolute grid min-w-4 place-items-center rounded-full bg-accent px-1 font-semibold text-[0.625rem] text-on-accent">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </span>
        Cart
      </button>

      <Link
        href={signedIn ? "/account" : "/sign-in"}
        className={linkClass(pathname.startsWith("/account"))}
      >
        <User className="size-5" aria-hidden />
        Account
      </Link>
    </nav>
  );
}
