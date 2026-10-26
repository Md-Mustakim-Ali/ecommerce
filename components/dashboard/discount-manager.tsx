"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDiscountAction,
  type DiscountRow,
  deleteDiscountAction,
  setDiscountStatusAction,
  updateDiscountAction,
} from "@/lib/actions/discount-admin";
import { formatMoney } from "@/lib/money/format";

type Scope = { scope: "platform" } | { scope: "store"; storeId: string };

/**
 * One editor for both scopes.
 *
 * The scope prop decides what a new code is attached to and which permission
 * the server checks — it is not something the form asserts, because a seller
 * publishing a platform-wide code would be spending everyone's margin.
 *
 * A seller also sees marketplace codes that apply to their products, read-only.
 * Those come off their sale too, so hiding them would leave a seller unable to
 * explain their own numbers.
 */
export function DiscountManager({
  scope,
  discounts,
  canCreate,
}: {
  scope: Scope;
  discounts: DiscountRow[];
  canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);

  const mine = discounts.filter((d) =>
    scope.scope === "store" ? d.scope === "store" : true,
  );
  const inherited = discounts.filter(
    (d) => scope.scope === "store" && d.scope === "platform",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Discount codes</h2>
          <p className="text-tertiary-text text-xs">
            {scope.scope === "store"
              ? "Yours come off your own items only."
              : "Platform codes apply across every store."}
          </p>
        </div>
        {canCreate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Close" : "New code"}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <DiscountForm scope={scope} onDone={() => setCreating(false)} />
      ) : null}

      {mine.length === 0 ? (
        <p className="rounded-md border border-border border-dashed px-4 py-8 text-center text-secondary-text text-sm">
          No codes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
          {mine.map((discount) => (
            <li key={discount.id} className="bg-surface-1">
              <DiscountRowView scope={scope} discount={discount} />
            </li>
          ))}
        </ul>
      )}

      {inherited.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">Marketplace codes</h3>
          <p className="text-tertiary-text text-xs">
            Run by the platform. They discount your items too, so they show here
            for context — you cannot change them.
          </p>
          <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
            {inherited.map((discount) => (
              <li
                key={discount.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-surface-1 px-4 py-3"
              >
                <span className="flex items-center gap-2 font-medium text-sm">
                  <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
                    {discount.code}
                  </code>
                  <span className="text-secondary-text">
                    {describe(discount)}
                  </span>
                </span>
                <Badge variant="neutral">{discount.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function describe(discount: DiscountRow): string {
  if (discount.kind === "free_shipping") return "Free shipping";
  if (discount.kind === "percentage") {
    const percent = discount.value / 100;
    const capped = discount.maxDiscountCents
      ? `, up to ${formatMoney(discount.maxDiscountCents, "USD")}`
      : "";
    return `${percent % 1 === 0 ? percent : percent.toFixed(2)}% off${capped}`;
  }
  return `${formatMoney(discount.value, "USD")} off`;
}

function DiscountRowView({
  scope,
  discount,
}: {
  scope: Scope;
  discount: DiscountRow;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(status: "draft" | "published" | "archived") {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setDiscountStatusAction({
        ...scope,
        discountId: discount.id,
        status,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
    });
  }

  const limits = [
    discount.minSubtotalCents > 0
      ? `min ${formatMoney(discount.minSubtotalCents, "USD")}`
      : null,
    discount.maxRedemptions
      ? `${discount.redemptionCount}/${discount.maxRedemptions} used`
      : `${discount.redemptionCount} used`,
    discount.perCustomerLimit
      ? `${discount.perCustomerLimit} per person`
      : "unlimited per person",
    discount.endsAt ? `ends ${discount.endsAt.toLocaleDateString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
            <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
              {discount.code}
            </code>
            {describe(discount)}
            <Badge
              variant={
                discount.status === "published"
                  ? "positive"
                  : discount.status === "archived"
                    ? "critical"
                    : "neutral"
              }
            >
              {discount.status}
            </Badge>
          </span>
          <span className="text-secondary-text text-xs">{limits}</span>
          {/*
            Uses alone is a vanity number. What it gave away is the number that
            decides whether the campaign was worth running.
          */}
          {discount.redeemedCents > 0 ? (
            <span className="text-tertiary-text text-xs">
              {formatMoney(discount.redeemedCents, "USD")} given away
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {discount.status !== "published" ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => move("published")}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Publish
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => move("draft")}
            >
              Pause
            </Button>
          )}
          {discount.status !== "archived" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? "Close" : "Edit"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => move("archived")}
              >
                Archive
              </Button>
            </>
          ) : null}
          <DeleteDiscount
            scope={scope}
            discountId={discount.id}
            code={discount.code}
            used={discount.redemptionCount > 0}
          />
        </div>
      </div>

      {editing ? (
        <DiscountForm
          scope={scope}
          discount={discount}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-xs">{message}</output>
      ) : null}
    </div>
  );
}

function DeleteDiscount({
  scope,
  discountId,
  code,
  used,
}: {
  scope: Scope;
  discountId: string;
  code: string;
  used: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A redeemed code is part of the record of what an order was charged, so
  // there is nothing to offer here.
  if (used) return null;

  if (!confirming) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${code}`}
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
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteDiscountAction({ ...scope, discountId });
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

/** Minor units back to the string the form edits. */
function toInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

/** A Date back to the value a datetime-local input accepts. */
function toLocalInput(date: Date | null): string {
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * One form for creating and for editing.
 *
 * The code itself is not editable. It is what a buyer typed and what every
 * redemption row points at, so renaming it would invalidate anything already
 * circulating — a printed card, an email — while leaving the redemptions
 * attached to a name nobody can use again.
 */
function DiscountForm({
  scope,
  discount,
  onDone,
  onCancel,
}: {
  scope: Scope;
  /** Absent when creating. */
  discount?: DiscountRow;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const editing = discount !== undefined;
  const [kind, setKind] = useState<
    "percentage" | "fixed_amount" | "free_shipping"
  >(discount?.kind ?? "percentage");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const payload = {
            ...scope,
            // Sent on edit too, because the schema requires it; the server
            // ignores it and keeps the stored code.
            code: discount?.code ?? String(data.get("code") ?? ""),
            kind,
            value: String(data.get("value") ?? "0"),
            maxDiscount: String(data.get("maxDiscount") ?? ""),
            minSubtotal: String(data.get("minSubtotal") ?? ""),
            maxRedemptions: String(data.get("maxRedemptions") ?? ""),
            perCustomerLimit: String(data.get("perCustomerLimit") ?? ""),
            description: String(data.get("description") ?? ""),
            startsAt: String(data.get("startsAt") ?? ""),
            endsAt: String(data.get("endsAt") ?? ""),
            publish: data.get("publish") === "on",
          };

          const result = discount
            ? await updateDiscountAction({
                ...payload,
                discountId: discount.id,
              })
            : await createDiscountAction(payload);

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
          <Label htmlFor="d-code">Code</Label>
          <Input
            id="d-code"
            name="code"
            required={!editing}
            disabled={editing}
            defaultValue={discount?.code ?? ""}
            maxLength={40}
            placeholder="SUMMER20"
            className="uppercase"
            autoCapitalize="characters"
          />
          <p className="text-tertiary-text text-xs">
            {editing
              ? "The code cannot change — anything already circulating points at it."
              : "Case does not matter to shoppers — it is matched upper-case."}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="d-kind">Type</Label>
          <select
            id="d-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
            className="h-11 rounded-control border border-border-strong bg-surface-sunken px-4 text-sm"
          >
            <option value="percentage">Percentage off</option>
            <option value="fixed_amount">Fixed amount off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
        </div>
      </div>

      {kind !== "free_shipping" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="d-value">
              {kind === "percentage" ? "Percent off" : "Amount off"}
            </Label>
            <Input
              id="d-value"
              name="value"
              defaultValue={
                discount
                  ? discount.kind === "percentage"
                    ? String(discount.value / 100)
                    : toInput(discount.value)
                  : ""
              }
              required
              inputMode="decimal"
              placeholder={kind === "percentage" ? "20" : "10.00"}
            />
          </div>

          {kind === "percentage" ? (
            <div className="grid gap-2">
              <Label htmlFor="d-max">Cap (optional)</Label>
              <Input
                id="d-max"
                name="maxDiscount"
                defaultValue={toInput(discount?.maxDiscountCents)}
                inputMode="decimal"
                placeholder="50.00"
              />
              <p className="text-tertiary-text text-xs">
                Stops a percentage code costing more than planned on a large
                order.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="d-min">Minimum spend</Label>
          <Input
            id="d-min"
            name="minSubtotal"
            defaultValue={toInput(discount?.minSubtotalCents)}
            inputMode="decimal"
            placeholder="25.00"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="d-uses">Total uses</Label>
          <Input
            id="d-uses"
            name="maxRedemptions"
            defaultValue={discount?.maxRedemptions ?? ""}
            inputMode="numeric"
            placeholder="unlimited"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="d-per">Uses per person</Label>
          <Input
            id="d-per"
            name="perCustomerLimit"
            inputMode="numeric"
            defaultValue={discount ? (discount.perCustomerLimit ?? "") : "1"}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="d-starts">Starts (optional)</Label>
          <Input
            id="d-starts"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(discount?.startsAt ?? null)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="d-ends">Ends (optional)</Label>
          <Input
            id="d-ends"
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocalInput(discount?.endsAt ?? null)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="d-desc">What shoppers see</Label>
        <Input
          id="d-desc"
          name="description"
          defaultValue={discount?.description ?? ""}
          maxLength={200}
          placeholder="20% off the autumn range"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="publish"
          className="size-4 accent-accent"
        />
        Make it live straight away
      </label>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {editing ? "Save changes" : "Create code"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel ?? onDone}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
