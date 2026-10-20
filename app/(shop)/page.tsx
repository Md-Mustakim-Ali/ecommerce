import Link from "next/link";
import { getSession } from "@/lib/auth/guards";

// PLACEHOLDER. The storefront home page is Phase 2/3 work. This exists only so
// Phase 0 has a runnable entry point that proves the session round-trips.

export default async function HomePage() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Marketplace</h1>
      <p className="text-sm opacity-70">
        Phase 0 scaffold. Nothing here is designed yet.
      </p>

      {session ? (
        <Link href="/account" className="text-sm underline">
          Signed in as {session.user.email} — go to account
        </Link>
      ) : (
        <div className="flex gap-4 text-sm">
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
          <Link href="/sign-up" className="underline">
            Create an account
          </Link>
        </div>
      )}
    </main>
  );
}
