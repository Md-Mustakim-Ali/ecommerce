import type { Metadata } from "next";
import {
  listPlatformRolesAction,
  listPlatformStaffAction,
} from "@/lib/actions/platform-roles";
import { requirePlatformPermission } from "@/lib/auth/access";
import { PlatformRoleManager } from "./role-manager";

export const metadata: Metadata = { title: "Platform roles" };

export default async function AdminRolesPage() {
  const access = await requirePlatformPermission("platform.role.manage");

  const [roles, staff] = await Promise.all([
    listPlatformRolesAction(),
    listPlatformStaffAction(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Platform roles</h1>
        <p className="text-muted-foreground text-sm">
          Who can do what across the whole marketplace. Unlike a store, there is
          no owner who implicitly holds everything — so the last role that can
          manage roles cannot be removed.
        </p>
      </div>

      <PlatformRoleManager
        roles={roles}
        staff={staff}
        actorPermissions={[...access.permissions]}
      />
    </div>
  );
}
