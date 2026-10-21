"use client";

import { Crown, Loader2, UserMinus } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteMemberAction,
  removeMemberAction,
  setMemberRolesAction,
} from "@/lib/actions/roles";
import type { Permission } from "@/lib/auth/permissions";
import type { MemberRow } from "@/lib/rbac/queries";

type AssignableRole = {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
};

/**
 * Who has access, and what they can do.
 *
 * The owner is rendered from `stores.owner_id` rather than from a membership
 * row, and has no controls at all — their access is not a grant, so there is
 * nothing here that could take it away. Transfer of ownership is deliberately
 * not on this screen.
 */
export function StaffManager({
  storeId,
  owner,
  members,
  assignableRoles,
  actorPermissions,
  permissions,
}: {
  storeId: string;
  owner: { id: string; name: string; email: string } | null;
  members: MemberRow[];
  assignableRoles: AssignableRole[];
  actorPermissions: string[];
  permissions: {
    memberInvite: boolean;
    memberRemove: boolean;
    memberAssign: boolean;
  };
}) {
  const [inviting, setInviting] = useState(false);

  const held = useMemo(() => new Set(actorPermissions), [actorPermissions]);

  // A role granting more than the actor holds cannot be assigned by them, so
  // it is shown disabled rather than offered and then rejected on submit.
  const assignable = useMemo(
    () =>
      assignableRoles.map((role) => ({
        ...role,
        blocked: role.permissions.filter((key) => !held.has(key)),
      })),
    [assignableRoles, held],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">People</h2>
          <p className="text-secondary-text text-xs">
            {members.length + (owner ? 1 : 0)}{" "}
            {members.length === 0 && owner ? "person" : "people"} with access.
          </p>
        </div>
        {permissions.memberInvite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInviting((value) => !value)}
          >
            {inviting ? "Close" : "Invite someone"}
          </Button>
        ) : null}
      </div>

      {inviting ? (
        <InviteForm
          storeId={storeId}
          roles={assignable}
          canAssign={permissions.memberAssign}
          onDone={() => setInviting(false)}
        />
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
        {owner ? (
          <li className="flex flex-wrap items-center justify-between gap-3 bg-surface-1 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-sm">{owner.name}</span>
              <span className="truncate text-secondary-text text-xs">
                {owner.email}
              </span>
            </div>
            <Badge variant="default">
              <Crown aria-hidden /> Owner
            </Badge>
          </li>
        ) : null}

        {members.map((member) => (
          <li key={member.id} className="bg-surface-1">
            <MemberRowView
              storeId={storeId}
              member={member}
              roles={assignable}
              permissions={permissions}
            />
          </li>
        ))}
      </ul>

      {members.length === 0 ? (
        <p className="text-tertiary-text text-xs">
          No staff yet. Invite someone and give them a role.
        </p>
      ) : null}
    </section>
  );
}

function MemberRowView({
  storeId,
  member,
  roles,
  permissions,
}: {
  storeId: string;
  member: MemberRow;
  roles: (AssignableRole & { blocked: Permission[] })[];
  permissions: { memberRemove: boolean; memberAssign: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(member.roles.map((r) => r.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-sm">
            {member.name}
            {member.status === "invited" ? (
              <Badge variant="muted">Invited</Badge>
            ) : null}
            {member.status === "suspended" ? (
              <Badge variant="critical">Suspended</Badge>
            ) : null}
          </span>
          <span className="truncate text-secondary-text text-xs">
            {member.email}
            {member.roles.length > 0
              ? ` · ${member.roles.map((r) => r.name).join(", ")}`
              : " · no role, so no access"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {permissions.memberAssign ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? "Close" : "Change roles"}
            </Button>
          ) : null}
          {permissions.memberRemove ? (
            <RemoveButton
              storeId={storeId}
              memberId={member.id}
              name={member.name}
            />
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3 border-border border-t px-4 py-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Roles for {member.name}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => {
                const blocked = role.blocked.length > 0;
                const checked = selected.has(role.id);
                return (
                  <label
                    key={role.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${
                      checked
                        ? "border-accent bg-accent-muted"
                        : "border-border bg-surface-1"
                    } ${blocked ? "cursor-not-allowed opacity-55" : "hover:bg-surface-2"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                      checked={checked}
                      disabled={blocked}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(role.id)) next.delete(role.id);
                          else next.add(role.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-xs">
                        {role.name}
                      </span>
                      <span className="block text-secondary-text text-xs">
                        {blocked
                          ? `Grants ${role.blocked.length} ${role.blocked.length === 1 ? "permission" : "permissions"} you do not hold.`
                          : `${role.permissions.length} permissions`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await setMemberRolesAction({
                    storeId,
                    memberId: member.id,
                    roleIds: [...selected],
                  });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setEditing(false);
                });
              }}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {selected.size === 0 ? (
              <span className="text-tertiary-text text-xs">
                No roles means no access to anything in this store.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function InviteForm({
  storeId,
  roles,
  canAssign,
  onDone,
}: {
  storeId: string;
  roles: (AssignableRole & { blocked: Permission[] })[];
  canAssign: boolean;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await inviteMemberAction({
            storeId,
            email: String(data.get("email") ?? ""),
            roleIds: [...selected],
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        });
      }}
    >
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          placeholder="them@example.com"
          required
        />
        <p className="text-tertiary-text text-xs">
          They need an account already. The invitation appears on their
          dashboard for them to accept.
        </p>
      </div>

      {canAssign ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-tertiary-text text-xs">
            Roles (optional — you can set them later)
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              const blocked = role.blocked.length > 0;
              return (
                <label
                  key={role.id}
                  className={`flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-xs ${
                    blocked
                      ? "cursor-not-allowed opacity-55"
                      : "cursor-pointer hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    disabled={blocked}
                    checked={selected.has(role.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(role.id)) next.delete(role.id);
                        else next.add(role.id);
                        return next;
                      })
                    }
                  />
                  {role.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Send invitation
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RemoveButton({
  storeId,
  memberId,
  name,
}: {
  storeId: string;
  memberId: string;
  name: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${name}`}
        onClick={() => setConfirming(true)}
      >
        <UserMinus aria-hidden />
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-critical text-xs">
          {error}
        </span>
      ) : (
        <span className="text-secondary-text text-xs">Remove {name}?</span>
      )}
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await removeMemberAction({ storeId, memberId });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setConfirming(false);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Remove
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
