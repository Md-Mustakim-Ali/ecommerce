import type { Metadata } from "next";
import { searchUsersAction } from "@/lib/actions/moderation";
import { requirePlatformPermission } from "@/lib/auth/access";
import { UserSearch } from "./user-search";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage({
  searchParams,
}: PageProps<"/admin/users">) {
  const access = await requirePlatformPermission("platform.user.view");
  const query = await searchParams;
  const q = Array.isArray(query.q) ? query.q[0] : (query.q ?? "");

  const users = await searchUsersAction({ query: q });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          {users.length} shown{q ? ` matching "${q}"` : ""}.
        </p>
      </div>

      <UserSearch
        query={q}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          emailVerified: u.emailVerified,
          createdAt: u.createdAt.toISOString(),
          storeCount: u.storeCount,
          orderCount: u.orderCount,
          activeSessions: u.activeSessions,
        }))}
        canSuspend={access.permissions.has("platform.user.suspend")}
      />
    </div>
  );
}
