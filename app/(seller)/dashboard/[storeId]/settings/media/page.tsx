import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  googleRedirectUri,
  loadConnectionOverviewAction,
} from "@/lib/actions/google-connections";
import { getStoreAccess } from "@/lib/auth/access";
import { MediaConnections } from "./connections";

export const metadata: Metadata = { title: "Media connections" };

/**
 * Where a seller connects the Google capacity their media runs on.
 *
 * Gated on store.profile.update rather than a product permission: connecting
 * an account here decides where every photo and video in the shop is stored
 * and which channel hosts them, which is a store-level decision rather than a
 * catalogue one.
 */
export default async function MediaSettingsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/settings/media">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await getStoreAccess(storeId);
  if (!access || access.membershipStatus === "none") notFound();
  if (!access.permissions.has("store.profile.update")) notFound();

  const [overview, redirectUri] = await Promise.all([
    loadConnectionOverviewAction(storeId),
    googleRedirectUri(),
  ]);

  // The OAuth callback cannot render anything itself — it is a redirect — so
  // it hands its outcome back through the query string.
  const connected =
    typeof query.connected === "string" ? query.connected : null;
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">
          Media connections
        </h1>
        <p className="text-secondary-text text-sm">
          Product photos are stored in your Google Drive and videos on your
          YouTube channel. Connect at least one of each to upload media.
        </p>
      </div>

      <MediaConnections
        storeId={storeId}
        overview={overview}
        connectedEmail={connected}
        callbackError={error}
        redirectUri={redirectUri}
      />
    </div>
  );
}
