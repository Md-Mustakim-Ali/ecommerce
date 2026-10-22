"use client";

import { Loader2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPlatformRoleAction,
  deletePlatformRoleAction,
  setPlatformRolesAction,
  updatePlatformRoleAction,
} from "@/lib/actions/platform-roles";
import { permissionGroups } from "@/lib/auth/permissions";

export type PlatformRole = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
};

export type PlatformStaff = {
  userId: string;
  name: string;
  email: string;
  roles: { id: string; name: string }[];
};

/**
 * Platform roles and who holds them.
 *
 * The store version has an owner who implicitly holds everything and cannot be
 * locked out. There is nothing equivalent here, so two guards do that job: the
 * ceiling stops anyone granting more than they hold, and the server refuses to
 * remove the last route back in — the only role that can manage roles, or your
 * own role management.
 */
export function PlatformRoleManager({
  roles,
  staff,
  actorPermissions,
}: {
  roles: PlatformRole[];
  staff: PlatformStaff[];
  actorPermissions: string[];
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const held = useMemo(() => new Set(actorPermissions), [actorPermissions]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-medium text-sm">Roles</h2>
            <p className="text-muted-foreground text-xs">
              You can only grant permissions you hold yourself. Anything beyond
              that is shown but not selectable.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating((v) => !v);
              setEditing(null);
            }}
          >
            {creating ? "Close" : "New role"}
          </Button>
        </div>

        {creating ? (
          <RoleForm held={held} onDone={() => setCreating(false)} />
        ) : null}

        <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
          {roles.map((role) => (
            <li key={role.id} className="bg-background">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium text-sm">
                    {role.name}
                    {role.isSystem ? (
                      <Badge variant="outline">
                        <Lock aria-hidden /> Built in
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {role.permissions.length}{" "}
                    {role.permissions.length === 1
                      ? "permission"
                      : "permissions"}{" "}
                    · {role.memberCount}{" "}
                    {role.memberCount === 1 ? "person" : "people"}
                    {role.description ? ` · ${role.description}` : ""}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {!role.isSystem ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(editing === role.id ? null : role.id);
                        setCreating(false);
                      }}
                    >
                      {editing === role.id ? "Close" : "Edit"}
                    </Button>
                  ) : null}
                  {!role.isSystem && role.memberCount === 0 ? (
                    <DeleteRole roleId={role.id} name={role.name} />
                  ) : null}
                </div>
              </div>

              {editing === role.id ? (
                <div className="border-border border-t px-4 py-4">
                  <RoleForm
                    role={role}
                    held={held}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">Staff</h2>
          <p className="text-muted-foreground text-xs">
            Everyone holding a platform role. Removing every role removes their
            admin access entirely.
          </p>
        </div>

        {staff.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            Nobody has a platform role.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {staff.map((person) => (
              <li key={person.userId} className="bg-background">
                <StaffRow person={person} roles={roles} held={held} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoleForm({
  role,
  held,
  onDone,
}: {
  role?: PlatformRole;
  held: Set<string>;
  onDone: () => void;
}) {
  const groups = useMemo(() => permissionGroups("platform"), []);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role?.permissions ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sensitive = groups
    .flatMap((g) => g.items)
    .filter((item) => item.sensitive && selected.has(item.key));

  return (
    <form
      className="flex flex-col gap-5 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const payload = {
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          permissions: [...selected],
        };
        startTransition(async () => {
          const result = role
            ? await updatePlatformRoleAction({ ...payload, roleId: role.id })
            : await createPlatformRoleAction(payload);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`pr-name-${role?.id ?? "new"}`}>Name</Label>
          <Input
            id={`pr-name-${role?.id ?? "new"}`}
            name="name"
            defaultValue={role?.name ?? ""}
            placeholder="Support"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`pr-desc-${role?.id ?? "new"}`}>
            Description (optional)
          </Label>
          <Input
            id={`pr-desc-${role?.id ?? "new"}`}
            name="description"
            defaultValue={role?.description ?? ""}
            placeholder="Looks up orders, cannot move money"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <fieldset key={group.name} className="flex flex-col gap-2">
            <legend className="font-medium text-muted-foreground text-xs">
              {group.name}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => {
                const grantable = held.has(item.key);
                const checked = selected.has(item.key);
                return (
                  <label
                    key={item.key}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${
                      checked ? "border-primary bg-muted" : "border-border"
                    } ${grantable ? "hover:bg-muted" : "cursor-not-allowed opacity-55"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0"
                      checked={checked}
                      disabled={!grantable}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium text-xs">
                        {item.label}
                        {item.sensitive ? (
                          <ShieldAlert
                            aria-label="Changes who can do what"
                            className="size-3 text-destructive"
                          />
                        ) : null}
                      </span>
                      <span className="block text-muted-foreground text-xs">
                        {grantable
                          ? item.description
                          : "You do not hold this, so you cannot grant it."}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {sensitive.length > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This role can change who has access:{" "}
            {sensitive.map((item) => item.label).join(", ")}. Anyone in it can
            grant those same permissions to others.
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {role ? "Save role" : "Create role"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-muted-foreground text-xs">
          {selected.size} selected
        </span>
      </div>
    </form>
  );
}

function DeleteRole({ roleId, name }: { roleId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${name}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden />
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">Delete {name}?</span>
      )}
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deletePlatformRoleAction({ roleId });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setConfirming(false);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

function StaffRow({
  person,
  roles,
  held,
}: {
  person: PlatformStaff;
  roles: PlatformRole[];
  held: Set<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(person.roles.map((r) => r.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-sm">{person.name}</span>
          <span className="truncate text-muted-foreground text-xs">
            {person.email} · {person.roles.map((r) => r.name).join(", ")}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Close" : "Change roles"}
        </Button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3 border-border border-t px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              // A role granting more than the actor holds cannot be assigned
              // by them, so it is shown disabled rather than offered and then
              // refused on submit.
              const blocked = role.permissions.filter((p) => !held.has(p));
              const checked = selected.has(role.id);
              return (
                <label
                  key={role.id}
                  className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${
                    checked ? "border-primary bg-muted" : "border-border"
                  } ${blocked.length > 0 ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-muted"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={checked}
                    disabled={blocked.length > 0}
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
                    <span className="block text-muted-foreground text-xs">
                      {blocked.length > 0
                        ? `Grants ${blocked.length} you do not hold.`
                        : `${role.permissions.length} permissions`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
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
                  const result = await setPlatformRolesAction({
                    userId: person.userId,
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
              <span className="text-muted-foreground text-xs">
                No roles removes their admin access.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
