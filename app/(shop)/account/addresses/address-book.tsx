"use client";

import { Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
} from "@/lib/actions/addresses";

export type SavedAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  countryCode: string;
  isDefaultShipping: boolean;
};

/**
 * The address book.
 *
 * Saved addresses fill in checkout; they are never what an order records. An
 * order snapshots the address at purchase time, so editing one here does not
 * rewrite where a past order says it went.
 */
export function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(addresses.length === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-secondary-text text-sm">
          {addresses.length} saved. The default is filled in at checkout.
        </p>
        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add an address
          </Button>
        ) : null}
      </div>

      {adding ? <AddressForm onDone={() => setAdding(false)} /> : null}

      {addresses.length === 0 && !adding ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border border-dashed px-8 py-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-surface-2">
            <MapPin className="size-5 text-tertiary-text" aria-hidden />
          </div>
          <p className="text-secondary-text text-sm">
            No addresses yet. Save one and checkout fills itself in.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-xl bg-border">
        {addresses.map((address) => (
          <li key={address.id} className="bg-surface-1">
            {editing === address.id ? (
              <div className="p-4">
                <AddressForm
                  address={address}
                  onDone={() => setEditing(null)}
                />
              </div>
            ) : (
              <AddressCard
                address={address}
                onEdit={() => setEditing(address.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddressCard({
  address,
  onEdit,
}: {
  address: SavedAddress;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
          {address.label ?? address.recipientName}
          {address.isDefaultShipping ? (
            <Badge variant="muted">
              <Star aria-hidden /> Default
            </Badge>
          ) : null}
        </span>
        <address className="not-italic text-secondary-text text-xs leading-relaxed">
          {address.recipientName}
          <br />
          {address.line1}
          {address.line2 ? (
            <>
              <br />
              {address.line2}
            </>
          ) : null}
          <br />
          {address.city}
          {address.region ? `, ${address.region}` : ""} {address.postalCode}
          <br />
          {address.countryCode}
          {address.phone ? ` · ${address.phone}` : ""}
        </address>
        {error ? (
          <span role="alert" className="text-critical text-xs">
            {error}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {!address.isDefaultShipping ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setDefaultAddressAction({
                  addressId: address.id,
                });
                if (!result.ok) setError(result.message);
              })
            }
          >
            Make default
          </Button>
        ) : null}

        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>

        {confirming ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAddressAction({
                    addressId: address.id,
                  });
                  if (!result.ok) setError(result.message);
                  setConfirming(false);
                })
              }
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Remove
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </span>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove address"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddressForm({
  address,
  onDone,
}: {
  address?: SavedAddress;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await saveAddressAction({
            id: address?.id,
            label: String(data.get("label") ?? ""),
            recipientName: String(data.get("recipientName") ?? ""),
            phone: String(data.get("phone") ?? ""),
            line1: String(data.get("line1") ?? ""),
            line2: String(data.get("line2") ?? ""),
            city: String(data.get("city") ?? ""),
            region: String(data.get("region") ?? ""),
            postalCode: String(data.get("postalCode") ?? ""),
            countryCode: String(data.get("countryCode") ?? "").toUpperCase(),
            isDefaultShipping: data.get("isDefaultShipping") === "on",
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="a-label">Label (optional)</Label>
          <Input
            id="a-label"
            name="label"
            defaultValue={address?.label ?? ""}
            placeholder="Home"
            maxLength={40}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="a-name">Full name</Label>
          <Input
            id="a-name"
            name="recipientName"
            defaultValue={address?.recipientName ?? ""}
            autoComplete="name"
            required
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="a-line1">Address</Label>
        <Input
          id="a-line1"
          name="line1"
          defaultValue={address?.line1 ?? ""}
          autoComplete="address-line1"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="a-line2">Apartment, suite (optional)</Label>
        <Input
          id="a-line2"
          name="line2"
          defaultValue={address?.line2 ?? ""}
          autoComplete="address-line2"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="a-city">City</Label>
          <Input
            id="a-city"
            name="city"
            defaultValue={address?.city ?? ""}
            autoComplete="address-level2"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="a-region">Region</Label>
          <Input
            id="a-region"
            name="region"
            defaultValue={address?.region ?? ""}
            autoComplete="address-level1"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="a-postal">Postcode</Label>
          <Input
            id="a-postal"
            name="postalCode"
            defaultValue={address?.postalCode ?? ""}
            autoComplete="postal-code"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="a-country">Country code</Label>
          <Input
            id="a-country"
            name="countryCode"
            defaultValue={address?.countryCode ?? ""}
            autoComplete="country"
            placeholder="US"
            maxLength={2}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="a-phone">Phone (optional)</Label>
          <Input
            id="a-phone"
            name="phone"
            type="tel"
            defaultValue={address?.phone ?? ""}
            autoComplete="tel"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isDefaultShipping"
          className="size-4 accent-accent"
          defaultChecked={address?.isDefaultShipping ?? false}
        />
        Use this by default at checkout
      </label>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {address ? "Save changes" : "Save address"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
