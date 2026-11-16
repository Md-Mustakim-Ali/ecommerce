import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getStoreAccess } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  storeGoogleAccounts,
  storeGoogleGrants,
  storeGoogleProjects,
} from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/media/crypto";
import {
  exchangeCodeForRefreshToken,
  missingScopes,
  verifyConnectState,
} from "@/lib/media/google/connect";
import { fetchStorageQuota } from "@/lib/media/google/drive";
import { fetchAccessToken } from "@/lib/media/google/oauth";

/**
 * Where Google sends the seller back after they authorise an account.
 *
 * This is the only place a grant is created. It runs entirely on values this
 * server can verify: the state parameter is HMAC-signed by us, and the code is
 * exchanged using the project's own client secret, so neither the store nor
 * the project can be chosen by whoever opened the URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsUrl(storeId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/dashboard/${storeId}/settings/media?${query}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || !stateParam) {
    return new Response("Invalid request", { status: 400 });
  }

  // Verified before anything else is read. An unverified state is an
  // instruction from a stranger about which store to attach an account to.
  const state = verifyConnectState(stateParam, secret);
  if (!state) {
    return new Response("This connection link has expired. Start again.", {
      status: 400,
    });
  }

  // Re-checked here, not just where the consent URL was built.
  //
  // The signed state proves which store and project were chosen; it does not
  // prove who is arriving with it. Without this, anyone who came by that URL —
  // browser history, a shared screen, a referrer header — could finish the
  // flow and bind their own Drive and YouTube channel to somebody else's
  // store, then delete the videos it was serving.
  const access = await getStoreAccess(state.storeId);
  if (!access?.permissions.has("media.connection.manage")) {
    return new Response(
      "You do not have permission to connect a media account to this store.",
      { status: 403 },
    );
  }

  if (error) {
    // The seller pressed cancel, which is not a fault worth an error page.
    redirect(
      settingsUrl(state.storeId, {
        error:
          error === "access_denied"
            ? "Connection cancelled."
            : `Google returned: ${error}`,
      }),
    );
  }

  if (!code) {
    redirect(settingsUrl(state.storeId, { error: "Google returned no code." }));
  }

  const [project] = await db
    .select({
      id: storeGoogleProjects.id,
      clientId: storeGoogleProjects.clientId,
      clientSecretEnc: storeGoogleProjects.clientSecretEnc,
    })
    .from(storeGoogleProjects)
    .where(
      and(
        eq(storeGoogleProjects.id, state.projectId),
        eq(storeGoogleProjects.storeId, state.storeId),
      ),
    )
    .limit(1);

  if (!project) {
    redirect(settingsUrl(state.storeId, { error: "That project is gone." }));
  }

  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");

  let identity: Awaited<ReturnType<typeof exchangeCodeForRefreshToken>>;
  try {
    identity = await exchangeCodeForRefreshToken({
      code,
      clientId: project.clientId,
      clientSecret: decryptSecret(project.clientSecretEnc),
      redirectUri: `${base}/api/google/callback`,
    });
  } catch (caught) {
    redirect(
      settingsUrl(state.storeId, {
        error:
          caught instanceof Error
            ? caught.message
            : "Could not connect that account.",
      }),
    );
  }

  // Google's consent screen lets a user grant a subset. Finding out at the
  // first upload — days later, mid-listing — is far worse than here.
  const missing = missingScopes(identity.grantedScopes);
  if (missing.length > 0) {
    redirect(
      settingsUrl(state.storeId, {
        error:
          "Some permissions were not granted, so uploads would fail. Connect again and leave every box ticked.",
      }),
    );
  }

  // Upsert: the same account can be authorised through several projects, and
  // each of those is a separate grant against one account row.
  const [account] = await db
    .insert(storeGoogleAccounts)
    .values({
      storeId: state.storeId,
      email: identity.email,
      googleUserId: identity.googleUserId,
      state: "active",
    })
    .onConflictDoUpdate({
      target: [storeGoogleAccounts.storeId, storeGoogleAccounts.googleUserId],
      set: {
        email: identity.email,
        // Reconnecting is how a seller fixes a revoked account, so this has to
        // clear the failure rather than leave it looking broken.
        state: "active",
        cooldownUntil: null,
        lastError: null,
      },
    })
    .returning({ id: storeGoogleAccounts.id });

  await db
    .insert(storeGoogleGrants)
    .values({
      projectId: project.id,
      accountId: account.id,
      refreshTokenEnc: encryptSecret(identity.refreshToken),
      scopes: identity.grantedScopes,
      state: "active",
    })
    .onConflictDoUpdate({
      target: [storeGoogleGrants.projectId, storeGoogleGrants.accountId],
      set: {
        refreshTokenEnc: encryptSecret(identity.refreshToken),
        scopes: identity.grantedScopes,
        state: "active",
        lastError: null,
        lastErrorAt: null,
      },
    });

  // This is the moment an outside account gains standing in the store, so it
  // is the one worth logging. Written after the grant so a failed exchange
  // does not leave a record of a connection that never existed.
  const session = await getSession();

  await db.insert(auditLog).values({
    storeId: state.storeId,
    actorId: access.userId,
    actorEmail: session?.user.email ?? null,
    action: "media.account.connect",
    targetType: "google_account",
    targetId: account.id,
    targetLabel: identity.email,
    before: null,
    after: { email: identity.email, projectId: project.id },
  });

  // Best effort, and deliberately not fatal: a connection that works but has
  // not reported its free space yet is fine, because the picker treats an
  // unknown limit as unmetered and the sweeper will fill it in.
  try {
    const token = await fetchAccessToken({
      clientId: project.clientId,
      clientSecret: decryptSecret(project.clientSecretEnc),
      refreshToken: identity.refreshToken,
    });
    const quota = await fetchStorageQuota(token.token);
    await db
      .update(storeGoogleAccounts)
      .set({
        storageLimitBytes: quota.limitBytes,
        storageUsageBytes: quota.usageBytes,
        storageCheckedAt: new Date(),
      })
      .where(eq(storeGoogleAccounts.id, account.id));
  } catch {
    // Ignored on purpose. See above.
  }

  redirect(settingsUrl(state.storeId, { connected: identity.email }));
}
