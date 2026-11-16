import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  googleRedirectUri,
  loadConnectionOverviewAction,
} from "@/lib/actions/google-connections";
import { getStoreAccess } from "@/lib/auth/access";
import { encryptionConfigured } from "@/lib/media/crypto";
import { sweepStoreMediaAfterResponse } from "@/lib/media/opportunistic";
import { MediaConnections } from "./connections";

export const metadata: Metadata = { title: "Media connections" };

/**
 * Where a seller connects the Google capacity their media runs on.
 *
 * Two permissions, not one. Viewing the pool answers "why did my upload
 * fail", which anyone adding product media needs; managing it binds a real
 * person's Drive and YouTube channel to the store and can hide every asset
 * already stored on an account. Those are different powers and a shop owner
 * should be able to hand out the first without the second.
 */
export default async function MediaSettingsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/settings/media">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await getStoreAccess(storeId);
  if (!access || access.membershipStatus === "none") notFound();
  if (!access.permissions.has("media.connection.view")) notFound();
  const canManage = access.permissions.has("media.connection.manage");

  // Somebody opening this page is usually here because an upload misbehaved.
  //
  // The sweep runs after this response, so what renders below is the state as
  // it was on arrival — the freshened version appears on the next load. That
  // is the trade for not making the page wait on Google, and it converges
  // quickly in practice because the person waiting on an upload is the person
  // pressing refresh.
  sweepStoreMediaAfterResponse(storeId);

  const [overview, redirectUri] = await Promise.all([
    loadConnectionOverviewAction(storeId),
    googleRedirectUri(),
  ]);

  // The OAuth callback cannot render anything itself — it is a redirect — so
  // it hands its outcome back through the query string.
  const configured = encryptionConfigured();

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

      {configured ? null : (
        <p
          role="alert"
          className="rounded-md border border-critical/30 bg-critical-muted px-3 py-2 text-sm"
        >
          This server has no media encryption key set, so connections cannot be
          saved yet. Whoever runs it needs to set GOOGLE_TOKEN_ENCRYPTION_KEY.
        </p>
      )}

      <MediaConnections
        storeId={storeId}
        overview={overview}
        connectedEmail={connected}
        callbackError={error}
        redirectUri={redirectUri}
        canManage={canManage}
      />
    </div>
  );
}
