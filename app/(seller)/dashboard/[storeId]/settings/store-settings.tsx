"use client";

import { ImagePlus, Loader2, Lock } from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  removeStoreImageAction,
  updateStoreAppearanceAction,
  updateStoreProfileAction,
  uploadStoreImageAction,
} from "@/lib/actions/store-settings";
import {
  LAYOUT_PRESETS,
  type LayoutPreset,
  STORE_ACCENTS,
  type StoreAccent,
} from "@/lib/stores/appearance";

type Store = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  layoutPreset: LayoutPreset;
  supportEmail: string | null;
  supportPhone: string | null;
};

export function StoreSettings({
  store,
  isOwner,
  canProfile,
  canTheme,
}: {
  store: Store;
  isOwner: boolean;
  canProfile: boolean;
  canTheme: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {canProfile ? <ProfileForm store={store} isOwner={isOwner} /> : null}
      {canTheme ? <AppearanceForm store={store} /> : null}
    </div>
  );
}

function ProfileForm({ store, isOwner }: { store: Store; isOwner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updateStoreProfileAction({
            storeId: store.id,
            name: String(data.get("name") ?? ""),
            slug: String(data.get("slug") ?? store.slug),
            description: String(data.get("description") ?? ""),
            supportEmail: String(data.get("supportEmail") ?? ""),
            supportPhone: String(data.get("supportPhone") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
        });
      }}
    >
      <h2 className="font-medium text-sm">Profile</h2>

      <div className="grid gap-2">
        <Label htmlFor="name">Store name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={store.name}
          required
          maxLength={80}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="slug">
          Address
          {!isOwner ? (
            <span className="ml-2 inline-flex items-center gap-1 text-tertiary-text text-xs">
              <Lock aria-hidden className="size-3" />
              owner only
            </span>
          ) : null}
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-secondary-text text-sm">/store/</span>
          <Input
            id="slug"
            name="slug"
            defaultValue={store.slug}
            disabled={!isOwner}
            maxLength={60}
          />
        </div>
        <p className="text-tertiary-text text-xs">
          {/*
            Not a cosmetic field. Changing it breaks every link anyone has
            already shared, which is why it is owner-only.
          */}
          Changing this breaks existing links to your store.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">About</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={600}
          defaultValue={store.description ?? ""}
          className="w-full rounded-lg border border-border-strong bg-surface-sunken px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          placeholder="What you make, and what makes it worth buying."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="supportEmail">Support email</Label>
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={store.supportEmail ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="supportPhone">Support phone</Label>
          <Input
            id="supportPhone"
            name="supportPhone"
            type="tel"
            defaultValue={store.supportPhone ?? ""}
          />
        </div>
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
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}

function AppearanceForm({ store }: { store: Store }) {
  // Narrowed on the way in: the column is plain text, so a value written
  // before this palette existed must not be treated as one of its members.
  const [accent, setAccent] = useState<StoreAccent | null>(
    (STORE_ACCENTS.find((a) => a.value === store.accentColor)?.value ??
      null) as StoreAccent | null,
  );
  const [layout, setLayout] = useState<LayoutPreset>(store.layoutPreset);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-5 rounded-md border border-border bg-surface-1 p-5">
      <div>
        <h2 className="font-medium text-sm">Appearance</h2>
        <p className="text-tertiary-text text-xs">
          {/*
            The constraint is deliberate and worth stating, or it reads as a
            missing feature rather than a decision.
          */}
          Your shopfront only. Product pages, cart and checkout look the same
          across every store, so shoppers never have to relearn where to buy.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ImageField
          storeId={store.id}
          kind="logo"
          label="Logo"
          url={store.logoUrl}
          hint="Square works best."
          aspect="aspect-square w-24"
        />
        <ImageField
          storeId={store.id}
          kind="banner"
          label="Banner"
          url={store.bannerUrl}
          hint="Wide. Shown across the top of your shopfront."
          aspect="aspect-[3/1] w-full"
        />
      </div>

      <Separator />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-sm">Accent colour</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAccent(null)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              accent === null
                ? "border-accent bg-accent-muted text-accent-text"
                : "border-border text-secondary-text hover:bg-surface-2"
            }`}
          >
            Marketplace default
          </button>
          {STORE_ACCENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAccent(option.value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
                accent === option.value
                  ? "border-accent bg-accent-muted text-accent-text"
                  : "border-border text-secondary-text hover:bg-surface-2"
              }`}
            >
              <span
                aria-hidden
                className="size-3 rounded-full border border-border-strong"
                style={{ backgroundColor: option.hex }}
              />
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-tertiary-text text-xs">
          A fixed palette, not a colour picker — every one of these is checked
          for contrast in both light and dark.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-sm">Shopfront layout</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LAYOUT_PRESETS.map((preset) => (
            <label
              key={preset.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 ${
                layout === preset.value
                  ? "border-accent bg-accent-muted"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="layoutPreset"
                  className="size-4 accent-accent"
                  checked={layout === preset.value}
                  onChange={() => setLayout(preset.value)}
                />
                <span className="font-medium text-xs">{preset.label}</span>
              </span>
              <span className="text-secondary-text text-xs">
                {preset.description}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await updateStoreAppearanceAction({
                storeId: store.id,
                accentColor: accent,
                layoutPreset: layout,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
            });
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save appearance
        </Button>
      </div>
    </section>
  );
}

function ImageField({
  storeId,
  kind,
  label,
  url,
  hint,
  aspect,
}: {
  storeId: string;
  kind: "logo" | "banner";
  label: string;
  url: string | null;
  hint: string;
  aspect: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>

      <div
        className={`relative overflow-hidden rounded-md border border-border bg-surface-2 ${aspect}`}
      >
        {current ? (
          <Image
            src={current}
            alt=""
            fill
            sizes="300px"
            className="object-cover"
          />
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;

          setError(null);
          const data = new FormData();
          data.set("storeId", storeId);
          data.set("kind", kind);
          data.set("file", file);

          startTransition(async () => {
            const result = await uploadStoreImageAction(data);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            // The action revalidates; refreshing the local preview avoids a
            // full reload just to see the new image.
            setCurrent(URL.createObjectURL(file));
          });
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ImagePlus aria-hidden />
          )}
          {current ? "Replace" : "Upload"}
        </Button>

        {current ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeStoreImageAction({ storeId, kind });
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setCurrent(null);
              })
            }
          >
            Remove
          </Button>
        ) : null}
      </div>

      <p className="text-tertiary-text text-xs">{hint}</p>
      {error ? (
        <p role="alert" className="text-critical text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
