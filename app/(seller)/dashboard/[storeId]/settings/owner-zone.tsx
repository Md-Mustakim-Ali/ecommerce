"use client";

import { Banknote, Loader2, ShieldAlert, UserRoundCog } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  closeStoreAction,
  transferOwnershipAction,
  updateBillingAction,
  updatePayoutDestinationAction,
} from "@/lib/actions/store-owner";

type OwnerStore = {
  id: string;
  name: string;
  payoutAccountRef: string | null;
  payoutAccountLabel: string | null;
  billingName: string | null;
  billingTaxId: string | null;
  billingAddress: string | null;
};

/**
 * The four things only the owner can do.
 *
 * Kept in their own section, visually separated, because they are the ones
 * that cannot be delegated — no custom role can contain them, by design. An
 * owner who could hand "change payout destination" to a manager could be
 * socially engineered into handing over their revenue.
 *
 * Transfer and close both ask for the store name to be typed. It is the
 * cheapest way to be sure the click was deliberate, and both are effectively
 * one-way.
 */
export function OwnerZone({ store }: { store: OwnerStore }) {
  return (
    <section className="flex flex-col gap-5 rounded-md border border-critical/30 bg-critical-muted/20 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-critical"
        />
        <div>
          <h2 className="font-medium text-sm">Owner only</h2>
          <p className="text-secondary-text text-xs">
            These cannot be given to a staff member through any role. Only the
            account that owns this store can use them.
          </p>
        </div>
      </div>

      <PayoutDestination store={store} />
      <Separator />
      <Billing store={store} />
      <Separator />
      <Transfer store={store} />
      <Separator />
      <CloseStore store={store} />
    </section>
  );
}

function PayoutDestination({ store }: { store: OwnerStore }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updatePayoutDestinationAction({
            storeId: store.id,
            accountRef: String(data.get("accountRef") ?? ""),
            label: String(data.get("label") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
        });
      }}
    >
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <Banknote aria-hidden className="size-4" />
        Where payouts go
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="accountRef">Provider reference</Label>
          <Input
            id="accountRef"
            name="accountRef"
            defaultValue={store.payoutAccountRef ?? ""}
            placeholder="acct_1234…"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="payoutLabel">Label</Label>
          <Input
            id="payoutLabel"
            name="label"
            defaultValue={store.payoutAccountLabel ?? ""}
            placeholder="Business current account"
          />
        </div>
      </div>

      {/*
        Worth being explicit. A field labelled "where payouts go" invites
        somebody to paste an account number, and this database is deliberately
        not built to hold one.
      */}
      <p className="text-tertiary-text text-xs">
        Not your bank details. This is the reference your payment provider gives
        you. We never store account numbers, and the server rejects a bare
        string of digits if one is pasted here by mistake.
      </p>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save payout destination
        </Button>
      </div>
    </form>
  );
}

function Billing({ store }: { store: OwnerStore }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updateBillingAction({
            storeId: store.id,
            billingName: String(data.get("billingName") ?? ""),
            billingTaxId: String(data.get("billingTaxId") ?? ""),
            billingAddress: String(data.get("billingAddress") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
        });
      }}
    >
      <h3 className="font-medium text-sm">Billing</h3>
      <p className="text-tertiary-text text-xs">
        The legal entity, for invoices. Not your trading name.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="billingName">Legal name</Label>
          <Input
            id="billingName"
            name="billingName"
            defaultValue={store.billingName ?? ""}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="billingTaxId">Tax ID</Label>
          <Input
            id="billingTaxId"
            name="billingTaxId"
            defaultValue={store.billingTaxId ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="billingAddress">Registered address</Label>
        <Input
          id="billingAddress"
          name="billingAddress"
          defaultValue={store.billingAddress ?? ""}
          maxLength={400}
        />
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save billing
        </Button>
      </div>
    </form>
  );
}

function Transfer({ store }: { store: OwnerStore }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <UserRoundCog aria-hidden className="size-4" />
        Transfer ownership
      </h3>
      <p className="text-tertiary-text text-xs">
        Hands the store to another account. You stay listed as a member but hold
        nothing until they give it back.
      </p>

      {!open ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Transfer this store
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await transferOwnershipAction({
                storeId: store.id,
                email: String(data.get("email") ?? ""),
                confirmation: String(data.get("confirmation") ?? ""),
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setOpen(false);
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="transferEmail">New owner&rsquo;s email</Label>
            <Input
              id="transferEmail"
              name="email"
              type="email"
              required
              placeholder="them@example.com"
            />
            <p className="text-tertiary-text text-xs">
              They need an account already.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="transferConfirm">
              Type <span className="font-medium">{store.name}</span> to confirm
            </Label>
            <Input id="transferConfirm" name="confirmation" required />
          </div>

          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Transfer ownership
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}
    </div>
  );
}

function CloseStore({ store }: { store: OwnerStore }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium text-sm">Close the store</h3>
      <p className="text-tertiary-text text-xs">
        {/*
          "Delete" would be a lie. Orders and the ledger reference the store
          with ON DELETE RESTRICT, and the financial record is the one thing
          that has to survive.
        */}
        Takes it off the storefront and archives every listing. Past orders,
        payouts and the ledger are untouched — they have to be. Cannot be done
        while orders are open or money is owed.
      </p>

      {!open ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Close this store
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-md border border-critical/40 bg-surface-1 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await closeStoreAction({
                storeId: store.id,
                confirmation: String(data.get("confirmation") ?? ""),
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setOpen(false);
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="closeConfirm">
              Type <span className="font-medium">{store.name}</span> to confirm
            </Label>
            <Input id="closeConfirm" name="confirmation" required />
          </div>

          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Close the store
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}
    </div>
  );
}
