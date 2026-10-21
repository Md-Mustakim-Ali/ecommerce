import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { requireStorePermission } from "@/lib/auth/access";
import { MAX_CUSTOM_ROLES_PER_STORE } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";
import {
  listAuditForStore,
  listMembersForStore,
  listRolesForStore,
} from "@/lib/rbac/queries";
import { AuditTrail } from "./audit-trail";
import { RoleManager } from "./role-manager";
import { StaffManager } from "./staff-manager";

export const metadata: Metadata = { title: "Staff and roles" };

/**
 * Staff and roles.
 *
 * `member.view` opens the page; everything inside is gated separately, so a
 * shift lead who can see who is on the team but not change anything gets the
 * list without buttons rather than a 404.
 *
 * The actor's own permission set is passed to the editor so it can grey out
 * what they cannot grant. That is presentation only — validateGrant on the
 * server is what actually enforces the ceiling, and it runs on every save
 * regardless of what the form submits.
 */
export default async function StaffPage({
  params,
}: PageProps<"/dashboard/[storeId]/staff">) {
  const { storeId } = await params;
  const access = await requireStorePermission(storeId, "member.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const canReadRoles = access.permissions.has("role.view");
  const canReadAudit = access.permissions.has("audit.view");

  const [roles, staff, audit] = await Promise.all([
    canReadRoles ? listRolesForStore(storeId) : Promise.resolve([]),
    listMembersForStore(storeId),
    canReadAudit ? listAuditForStore(storeId, 25) : Promise.resolve([]),
  ]);

  const customCount = roles.filter((r) => !r.isSystem).length;

  const permissions = {
    roleCreate: access.permissions.has("role.create"),
    roleUpdate: access.permissions.has("role.update"),
    roleDelete: access.permissions.has("role.delete"),
    memberInvite: access.permissions.has("member.invite"),
    memberRemove: access.permissions.has("member.remove"),
    memberAssign: access.permissions.has("member.assign_role"),
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">
            Staff and roles
          </h1>
          <p className="text-secondary-text text-sm">{store.name}</p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      {/*
        The ceiling is the single most surprising rule in this screen, so it is
        stated before anyone hits it rather than only in the error they get.
      */}
      {!access.isOwner ? (
        <p className="rounded-md border border-border bg-surface-2 px-4 py-3 text-secondary-text text-sm">
          You can only grant permissions you hold yourself. Anything beyond that
          is shown but not selectable.
        </p>
      ) : null}

      <StaffManager
        storeId={storeId}
        owner={staff.owner}
        members={staff.members}
        assignableRoles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          isSystem: r.isSystem,
          permissions: r.permissions,
        }))}
        actorPermissions={[...access.permissions]}
        permissions={permissions}
      />

      <Separator />

      {canReadRoles ? (
        <RoleManager
          storeId={storeId}
          roles={roles}
          actorPermissions={[...access.permissions]}
          customCount={customCount}
          maxCustomRoles={MAX_CUSTOM_ROLES_PER_STORE}
          permissions={permissions}
        />
      ) : (
        <p className="text-tertiary-text text-xs">
          <Badge variant="outline">Restricted</Badge> Your role does not include
          viewing this store's roles.
        </p>
      )}

      {canReadAudit ? (
        <>
          <Separator />
          <AuditTrail entries={audit} />
        </>
      ) : null}
    </div>
  );
}
