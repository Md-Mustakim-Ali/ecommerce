"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/lib/actions/roles";

type Invitation = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  invitedAt: Date;
  invitedByEmail: string | null;
};

/**
 * Pending invitations.
 *
 * Accepting is an explicit act. A membership created by somebody else should
 * not start granting access until the person it names has agreed to it, which
 * is also what makes the audit trail meaningful.
 */
export function PendingInvitations({
  invitations,
}: {
  invitations: Invitation[];
}) {
  if (invitations.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">Invitations</h2>
      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
        {invitations.map((invitation) => (
          <li key={invitation.storeId}>
            <InvitationRow invitation={invitation} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-1 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-sm">{invitation.storeName}</span>
        <span className="truncate text-secondary-text text-xs">
          {invitation.invitedByEmail
            ? `Invited by ${invitation.invitedByEmail}`
            : "Invited"}{" "}
          · {invitation.invitedAt.toLocaleDateString()}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="text-critical text-xs">
            {error}
          </span>
        ) : null}
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await acceptInviteAction({
                storeId: invitation.storeId,
              });
              if (!result.ok) setError(result.message);
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Accept
        </Button>
      </div>
    </div>
  );
}
