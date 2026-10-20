import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/auth/guards";
import { getTheme } from "@/lib/theme.server";
import { SignOutButton } from "./sign-out-button";

// Placeholder. This proves the auth loop end to end; the real account area
// arrives with orders and addresses.

export default async function AccountPage() {
  const [user, theme] = await Promise.all([requireUser(), getTheme()]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6 shadow-e2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-semibold text-2xl tracking-tight">Account</h1>
          <ThemeToggle value={theme} />
        </div>

        <Separator />

        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-secondary-text">Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-secondary-text">Email</dt>
            <dd className="truncate">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-secondary-text">Email verified</dt>
            <dd>
              <Badge variant={user.emailVerified ? "positive" : "neutral"}>
                {user.emailVerified ? "Verified" : "Not verified"}
              </Badge>
            </dd>
          </div>
        </dl>

        <SignOutButton />
      </div>

      <Link
        href="/"
        className="text-center text-secondary-text text-sm underline underline-offset-4"
      >
        Back to store
      </Link>
    </main>
  );
}
