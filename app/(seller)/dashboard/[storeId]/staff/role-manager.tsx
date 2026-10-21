"use client";

import { Copy, Loader2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createRoleAction,
  deleteRoleAction,
  duplicateRoleAction,
  updateRoleAction,
} from "@/lib/actions/roles";
import { permissionGroups } from "@/lib/auth/permissions";
import type { RoleRow } from "@/lib/rbac/queries";

type Permissions = {
  roleCreate: boolean;
  roleUpdate: boolean;
  roleDelete: boolean;
};

/**
 * The role editor.
 *
 * Permissions the actor does not hold are rendered, disabled, and labelled —
 * not hidden. Hiding them makes the ceiling invisible and turns "why can't I
 * give someone refund access" into a support ticket; showing them locked
 * answers it on the spot.
 *
 * Sensitive permissions carry a marker because they are the ones that let a
 * holder change who can do what, and someone assembling a role deserves to see
 * that before they save rather than after.
 */
export function RoleManager({
  storeId,
  roles,
  actorPermissions,
  customCount,
  maxCustomRoles,
  permissions,
}: {
  storeId: string;
  roles: RoleRow[];
  actorPermissions: string[];
  customCount: number;
  maxCustomRoles: number;
  permissions: Permissions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const held = useMemo(() => new Set(actorPermissions), [actorPermissions]);
  const atLimit = customCount >= maxCustomRoles;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Roles</h2>
          <p className="text-secondary-text text-xs">
            {customCount} of {maxCustomRoles} custom roles used. Built-in roles
            are shared across every store and cannot be edited.
          </p>
        </div>
        {permissions.roleCreate ? (
          <Button
            size="sm"
            variant="outline"
            disabled={atLimit}
            onClick={() => {
              setCreating((value) => !value);
              setEditing(null);
            }}
          >
            {atLimit ? "Role limit reached" : "New role"}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <RoleForm
          storeId={storeId}
          held={held}
          onDone={() => setCreating(false)}
        />
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
        {roles.map((role) => (
          <li key={role.id} className="bg-surface-1">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 font-medium text-sm">
                  {role.name}
                  {role.isSystem ? (
                    <Badge variant="outline">
                      <Lock aria-hidden /> Built in
                    </Badge>
                  ) : null}
                </span>
                <span className="text-secondary-text text-xs">
                  {role.permissions.length}{" "}
                  {role.permissions.length === 1 ? "permission" : "permissions"}
                  {" · "}
                  {role.memberCount}{" "}
                  {role.memberCount === 1 ? "person" : "people"}
                  {role.description ? ` · ${role.description}` : ""}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {permissions.roleCreate ? (
                  <DuplicateButton storeId={storeId} roleId={role.id} />
                ) : null}
                {permissions.roleUpdate && !role.isSystem ? (
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
                {permissions.roleDelete && !role.isSystem ? (
                  <DeleteButton
                    storeId={storeId}
                    roleId={role.id}
                    name={role.name}
                    memberCount={role.memberCount}
                  />
                ) : null}
              </div>
            </div>

            {editing === role.id ? (
              <div className="border-border border-t px-4 py-4">
                <RoleForm
                  storeId={storeId}
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
  );
}

function RoleForm({
  storeId,
  role,
  held,
  onDone,
}: {
  storeId: string;
  role?: RoleRow;
  held: Set<string>;
  onDone: () => void;
}) {
  const groups = useMemo(() => permissionGroups("store"), []);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role?.permissions ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sensitiveChosen = groups
    .flatMap((g) => g.items)
    .filter((item) => item.sensitive && selected.has(item.key));

  return (
    <form
      className="flex flex-col gap-5 rounded-md border border-border bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const payload = {
          storeId,
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          permissions: [...selected],
        };

        startTransition(async () => {
          const result = role
            ? await updateRoleAction({ ...payload, roleId: role.id })
            : await createRoleAction(payload);
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
          <Label htmlFor={`role-name-${role?.id ?? "new"}`}>Name</Label>
          <Input
            id={`role-name-${role?.id ?? "new"}`}
            name="name"
            defaultValue={role?.name ?? ""}
            placeholder="Fulfilment"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`role-desc-${role?.id ?? "new"}`}>
            Description (optional)
          </Label>
          <Input
            id={`role-desc-${role?.id ?? "new"}`}
            name="description"
            defaultValue={role?.description ?? ""}
            placeholder="Packs and ships, no access to money"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <fieldset key={group.name} className="flex flex-col gap-2">
            <legend className="font-medium text-tertiary-text text-xs">
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
                      checked
                        ? "border-accent bg-accent-muted"
                        : "border-border bg-surface-1"
                    } ${grantable ? "hover:bg-surface-2" : "cursor-not-allowed opacity-55"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                      checked={checked}
                      disabled={!grantable}
                      onChange={() => toggle(item.key)}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium text-xs">
                        {item.label}
                        {item.sensitive ? (
                          <ShieldAlert
                            aria-label="Changes who can do what"
                            className="size-3 text-critical"
                          />
                        ) : null}
                      </span>
                      <span className="block text-secondary-text text-xs">
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

      {sensitiveChosen.length > 0 ? (
        <p className="flex items-start gap-2 rounded-md bg-critical-muted px-3 py-2 text-critical text-xs">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This role can change who has access:{" "}
            {sensitiveChosen.map((item) => item.label).join(", ")}. Anyone in it
            can grant those same permissions to others.
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-sm">
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
        <span className="text-tertiary-text text-xs">
          {selected.size} selected
        </span>
      </div>
    </form>
  );
}

function DuplicateButton({
  storeId,
  roleId,
}: {
  storeId: string;
  roleId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Duplicate role"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await duplicateRoleAction({ storeId, roleId });
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Copy aria-hidden />
        )}
      </Button>
      {error ? (
        <span role="alert" className="text-critical text-xs">
          {error}
        </span>
      ) : null}
    </>
  );
}

/**
 * Two-step delete.
 *
 * Not a modal: the confirmation replaces the button in place, which keeps the
 * role's name and member count on screen while the decision is being made.
 */
function DeleteButton({
  storeId,
  roleId,
  name,
  memberCount,
}: {
  storeId: string;
  roleId: string;
  name: string;
  memberCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (memberCount > 0) {
    return (
      <span className="text-tertiary-text text-xs">
        In use by {memberCount}
      </span>
    );
  }

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
        <span role="alert" className="text-critical text-xs">
          {error}
        </span>
      ) : (
        <span className="text-secondary-text text-xs">Delete {name}?</span>
      )}
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteRoleAction({ storeId, roleId });
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
