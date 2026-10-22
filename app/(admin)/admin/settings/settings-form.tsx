"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { updatePlatformSettingsAction } from "@/lib/actions/settings";
import type { PlatformSettings } from "@/lib/settings";

export function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const [commission, setCommission] = useState(
    (settings.commissionBps / 100).toString(),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const moved = Math.round(Number(commission) * 100) !== settings.commissionBps;

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updatePlatformSettingsAction({
            commissionPercent: commission,
            freeShippingThreshold: String(
              data.get("freeShippingThreshold") ?? "",
            ),
            flatShipping: String(data.get("flatShipping") ?? ""),
            maintenanceNotice: String(data.get("maintenanceNotice") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="commission">Commission</Label>
        <div className="flex items-center gap-2">
          <Input
            id="commission"
            value={commission}
            onChange={(event) => setCommission(event.target.value)}
            inputMode="decimal"
            required
            className="max-w-32"
          />
          <span className="text-muted-foreground text-sm">%</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Taken from each sale. Rounded down, so a fractional cent stays with
          the seller.
        </p>
      </div>

      {/*
        Worth saying out loud. Somebody changing this will reasonably wonder
        whether it rewrites what sellers are owed, and the answer being no is
        the entire reason commission is snapshotted onto the sub-order.
      */}
      {moved ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This applies to orders placed from now on. Past orders keep the rate
            they were charged, so no balance moves.
          </span>
        </p>
      ) : null}

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="flatShipping">Flat shipping</Label>
          <Input
            id="flatShipping"
            name="flatShipping"
            defaultValue={(settings.flatShippingCents / 100).toFixed(2)}
            inputMode="decimal"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="freeShippingThreshold">Free above</Label>
          <Input
            id="freeShippingThreshold"
            name="freeShippingThreshold"
            defaultValue={(settings.freeShippingThresholdCents / 100).toFixed(
              2,
            )}
            inputMode="decimal"
            required
          />
        </div>
      </div>

      <Separator />

      <div className="grid gap-2">
        <Label htmlFor="maintenanceNotice">Storefront notice</Label>
        <Input
          id="maintenanceNotice"
          name="maintenanceNotice"
          defaultValue={settings.maintenanceNotice ?? ""}
          maxLength={300}
          placeholder="Shown across the storefront. Leave blank for none."
        />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-sm">
          {message}
        </output>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}
