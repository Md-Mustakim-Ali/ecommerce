"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { suspendUserAction } from "@/lib/actions/moderation";

type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  storeCount: number;
  orderCount: number;
  activeSessions: number;
};

/**
 * User lookup.
 *
 * Search is a URL parameter rather than client state, so a support person can
 * paste the link into a ticket and land on the same account.
 */
export function UserSearch({
  query,
  users,
  canSuspend,
}: {
  query: string;
  users: User[];
  canSuspend: boolean;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(new FormData(event.currentTarget).get("q") ?? "");
          router.push(
            q ? `/admin/users?q=${encodeURIComponent(q)}` : "/admin/users",
          );
        }}
      >
        <Input
          name="q"
          defaultValue={query}
          placeholder="Email or name"
          className="max-w-sm"
        />
        <Button type="submit" variant="outline" size="sm">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {users.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          Nobody matches that.
        </p>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
          {users.map((user) => (
            <li key={user.id} className="bg-background">
              <Row user={user} canSuspend={canSuspend} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ user, canSuspend }: { user: User; canSuspend: boolean }) {
  const [suspending, setSuspending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
            {user.name}
            {user.storeCount > 0 ? (
              <Badge variant="outline">
                {user.storeCount} {user.storeCount === 1 ? "store" : "stores"}
              </Badge>
            ) : null}
            {user.activeSessions === 0 ? (
              <Badge variant="neutral">signed out</Badge>
            ) : null}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {user.email} · {user.orderCount}{" "}
            {user.orderCount === 1 ? "order" : "orders"} · joined{" "}
            {new Date(user.createdAt).toLocaleDateString()}
          </span>
        </div>

        {canSuspend && !suspending && user.activeSessions > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setSuspending(true)}>
            Suspend
          </Button>
        ) : null}
      </div>

      {suspending ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            );
            setError(null);
            startTransition(async () => {
              const result = await suspendUserAction({
                userId: user.id,
                reason,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setSuspending(false);
            });
          }}
        >
          <div className="flex-1">
            <Input
              name="reason"
              required
              maxLength={300}
              placeholder="Why is this account being suspended?"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Revoke every session
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSuspending(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}
