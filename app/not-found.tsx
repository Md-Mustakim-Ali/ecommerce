import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The 404.
 *
 * Every notFound() in the application lands here — a deleted product, a store
 * that closed, a mistyped slug — so it offers a way onward rather than only
 * stating the problem. A dead end at the moment someone was looking for
 * something to buy is a lost sale for no reason.
 *
 * Deliberately vague about why. "Product not found" and "you are not allowed
 * to see this product" have to be indistinguishable, or the 404 becomes a way
 * to enumerate what exists.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-tertiary-text text-sm">404</p>
        <h1 className="font-semibold text-xl tracking-tight">Nothing here</h1>
        <p className="text-secondary-text text-sm leading-relaxed">
          This page may have moved, or the seller may have taken it down.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link href="/search" />}>
          <Search aria-hidden />
          Browse everything
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          Home
        </Button>
      </div>
    </div>
  );
}
