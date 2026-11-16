import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getStoreAccess } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";
import { OwnerZone } from "./owner-zone";
import { StoreSettings } from "./store-settings";

export const metadata: Metadata = { title: "Store settings" };

/**
 * Store profile and appearance.
 *
 * Two permissions gate the two halves separately, so a support person who can
 * fix a phone number is not also able to restyle the shopfront. Someone with
 * neither gets a 404 rather than an empty page.
 */
export default async function StoreSettingsPage({
  params,
}: PageProps<"/dashboard/[storeId]/settings">) {
  const { storeId } = await params;

  const access = await getStoreAccess(storeId);
  if (!access || access.membershipStatus === "none") notFound();

  const canProfile = access.permissions.has("store.profile.update");
  const canTheme = access.permissions.has("store.theme.update");
  const canMedia = access.permissions.has("media.connection.view");
  if (!canProfile && !canTheme) notFound();

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      bannerUrl: true,
      accentColor: true,
      layoutPreset: true,
      supportEmail: true,
      supportPhone: true,
      status: true,
      payoutAccountRef: true,
      payoutAccountLabel: true,
      billingName: true,
      billingTaxId: true,
      billingAddress: true,
    },
  });
  if (!store) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">
            Store settings
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-secondary-text text-sm">
            <Badge variant={store.status === "active" ? "positive" : "neutral"}>
              {store.status}
            </Badge>
            <Link
              href={`/store/${store.slug}`}
              className="underline underline-offset-4 hover:text-primary-text"
            >
              View shopfront
            </Link>
          </p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      <StoreSettings
        store={store}
        isOwner={access.isOwner}
        canProfile={canProfile}
        canTheme={canTheme}
      />

      {/* Media connections live on their own page — they are a list that grows
          rather than a form — but this is where someone looks for them. */}
      {canMedia ? (
        <Link
          href={`/dashboard/${storeId}/settings/media`}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-1 p-5 transition-colors hover:border-accent"
        >
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">Media connections</span>
            <span className="text-secondary-text text-sm">
              The Google accounts and Cloud projects your product photos and
              videos are stored on.
            </span>
          </span>
          <span aria-hidden className="text-secondary-text">
            →
          </span>
        </Link>
      ) : null}

      {/* Identity, not permission. A manager holding every permission still
          does not see this. */}
      {access.isOwner ? <OwnerZone store={store} /> : null}
    </div>
  );
}
