import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { SignOutButton } from "./sign-out-button";

// PLACEHOLDER STYLING. This page exists to prove the Phase 0 auth loop works:
// sign up -> session -> server-rendered identity. Phase 2 builds the real thing.

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Account</h1>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="opacity-70">Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="opacity-70">Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="opacity-70">Verified</dt>
          <dd>{user.emailVerified ? "yes" : "no"}</dd>
        </div>
      </dl>

      <SignOutButton />

      <Link href="/" className="text-sm underline">
        Back to store
      </Link>
    </main>
  );
}
