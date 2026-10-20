import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/guards";
import { getTheme } from "@/lib/theme.server";

// Placeholder. The storefront home page is Phase 2/3 work; this exists so the
// app has a runnable entry point.

export default async function HomePage() {
  const [session, theme] = await Promise.all([getSession(), getTheme()]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-3xl tracking-tight">Marketplace</h1>
          <p className="text-secondary-text text-sm">
            The design system is in place. The storefront is not built yet.
          </p>
        </div>
        <ThemeToggle value={theme} />
      </div>

      {session ? (
        <div className="flex flex-col gap-3">
          <p className="text-secondary-text text-sm">
            Signed in as{" "}
            <span className="text-primary-text">{session.user.email}</span>
          </p>
          <Button render={<Link href="/account" />}>Go to account</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" block render={<Link href="/sign-up" />}>
            Create an account
          </Button>
          <Button
            size="lg"
            block
            variant="outline"
            render={<Link href="/sign-in" />}
          >
            Sign in
          </Button>
        </div>
      )}

      <Link
        href="/dev/tokens"
        className="text-center text-sm text-tertiary-text underline underline-offset-4"
      >
        Design tokens
      </Link>
    </main>
  );
}
