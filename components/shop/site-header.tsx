"use client";

import { Menu, Search, ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountMenu, type MenuStore } from "@/components/account-menu";
import { CartDrawer } from "@/components/shop/cart-drawer";
import { useCart } from "@/components/shop/cart-provider";
import { CategoryDrawer } from "@/components/shop/category-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CategoryNode } from "@/lib/catalog/queries";
import type { Theme } from "@/lib/theme";

/**
 * Desktop top navigation.
 *
 * Two rows that condense into one on scroll, driven by CSS scroll-driven
 * animation rather than a JavaScript scroll listener — it runs on the
 * compositor and costs nothing per frame.
 *
 * Search is always a visible field, never an icon that expands. On a
 * marketplace, search is the primary way people find anything, and hiding it
 * behind a click costs more than the space it saves.
 */
export function SiteHeader({
  tree,
  theme,
  account,
}: {
  tree: CategoryNode[];
  theme: Theme;
  /** Null when signed out, which is the only difference in this header. */
  account: {
    name: string;
    email: string;
    stores: MenuStore[];
    isStaff: boolean;
  } | null;
}) {
  const signedIn = account !== null;
  const { count, setOpen } = useCart();
  const router = useRouter();
  const params = useSearchParams();

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <header className="scroll-condense sticky top-0 z-30 border-border border-b bg-surface-0/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        {/* Mobile: the drawer trigger. Desktop gets the category row below. */}
        <div className="md:hidden">
          <CategoryDrawer
            tree={tree}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Categories">
                <Menu />
              </Button>
            }
          />
        </div>

        <Link
          href="/"
          className="shrink-0 font-semibold text-base tracking-tight sm:text-lg"
        >
          Marketplace
        </Link>

        <form
          onSubmit={search}
          className="relative mx-auto hidden max-w-xl flex-1 md:block"
        >
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-4 size-4 text-tertiary-text"
            aria-hidden
          />
          <Input
            name="q"
            type="search"
            defaultValue={params.get("q") ?? ""}
            placeholder="Search everything"
            aria-label="Search products"
            className="pl-11"
          />
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <ThemeToggle value={theme} className="hidden sm:inline-flex" />

          {/*
            A menu rather than a link, because the useful destinations differ
            per person: a seller wants their store, an admin wants the panel,
            and everyone needs a way to sign out. Sending all of them to one
            page and making them find it again is a step nobody needs.
          */}
          {account ? (
            <AccountMenu
              name={account.name}
              email={account.email}
              stores={account.stores}
              isStaff={account.isStaff}
              current={{ kind: "shop" }}
              className="hidden md:block"
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign in"
              render={<Link href="/sign-in" />}
              className="hidden md:inline-flex"
            >
              <User />
            </Button>
          )}

          <CartDrawer
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
                onClick={() => setOpen(true)}
                className="relative"
              >
                <ShoppingBag />
                {count > 0 ? (
                  <span className="tabular absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 font-semibold text-[0.6875rem] text-on-accent">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Button>
            }
          />
        </div>
      </div>

      {/* Row two: top-level categories. Hidden on mobile, where the drawer
          covers the same ground with a drill-down. */}
      <nav className="hidden border-border/60 border-t md:block">
        <ul className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-6 py-1.5">
          {tree.map((node) => (
            <li key={node.id}>
              <Link
                href={`/c/${node.slug}`}
                className="inline-flex rounded-control px-3 py-1.5 text-secondary-text text-sm transition-colors hover:bg-surface-2 hover:text-primary-text"
              >
                {node.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
