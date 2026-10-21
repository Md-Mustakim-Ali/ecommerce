import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getUserStores } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/guards";
import { listPendingInvitations } from "@/lib/rbac/queries";
import { PendingInvitations } from "./pending-invitations";

export const metadata: Metadata = { title: "Your stores" };

export default async function DashboardIndexPage() {
  const user = await requireUser();
  const [stores, invitations] = await Promise.all([
    getUserStores(),
    listPendingInvitations(user.id),
  ]);

  if (stores.length === 0 && invitations.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="font-semibold text-xl tracking-tight">Your stores</h1>
        <p className="text-secondary-text text-sm">
          You do not have access to any store yet. Ask an owner to invite you,
          or create your own.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-semibold text-xl tracking-tight">Your stores</h1>

      <PendingInvitations invitations={invitations} />

      {stores.length > 0 ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
          {stores.map((store) => (
            <li key={store.id}>
              <Link
                href={`/dashboard/${store.id}`}
                className="flex items-center justify-between gap-4 bg-surface-1 px-4 py-3 hover:bg-surface-2"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-sm">{store.name}</span>
                  <span className="text-tertiary-text text-xs">
                    /{store.slug}
                  </span>
                </div>
                <Badge
                  variant={store.status === "active" ? "positive" : "neutral"}
                >
                  {store.status}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
