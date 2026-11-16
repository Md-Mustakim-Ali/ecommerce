"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  productImages,
  storeGoogleAccounts,
  storeGoogleGrants,
  storeGoogleProjects,
} from "@/lib/db/schema";
import { encryptionConfigured, encryptSecret } from "@/lib/media/crypto";
import { buildConsentUrl, signConnectState } from "@/lib/media/google/connect";
import { DEFAULT_DAILY_UNIT_LIMIT, nextQuotaResetAt } from "@/lib/media/quota";

/**
 * Managing a store's Google connections.
 *
 * Reads need media.connection.view, writes need media.connection.manage. The
 * split matters because someone who uploads product photos has a real reason
 * to see why an upload failed — "the Drive is full" — without also being able
 * to disconnect the account and take every existing photo down with it.
 *
 * Two pools, added independently: Cloud projects supply YouTube quota, and
 * accounts supply Drive storage and the destination channel. They are joined
 * by grants, which the seller creates by authorising an account through a
 * specific project — and that authorisation is the OAuth round trip, so it
 * finishes in the callback route rather than here.
 */

export type ConnectionResult =
  | { ok: true; message: string; redirectUrl?: string }
  | { ok: false; message: string };

/**
 * Refuses politely when the server cannot encrypt what it is about to store.
 *
 * Without GOOGLE_TOKEN_ENCRYPTION_KEY the write would throw from inside
 * encryptSecret and take the page down with it, which tells a seller nothing
 * they can act on. This is an operator problem and the message says so.
 */
const NOT_CONFIGURED =
  "Media connections are not set up on this server yet. Ask whoever runs it to set GOOGLE_TOKEN_ENCRYPTION_KEY.";

/**
 * Who is doing this, for the audit trail.
 *
 * Snapshotted rather than joined at read time: the point of the log is to
 * still answer "who disconnected the account" after that person has left the
 * store and their membership row is gone.
 */
async function actor() {
  const session = await getSession();
  if (!session) return { id: null, email: null };
  return { id: session.user.id, email: session.user.email };
}

/** The one URL every seller has to whitelist in their own Cloud project. */
export async function googleRedirectUri(): Promise<string> {
  const base = process.env.BETTER_AUTH_URL ?? "";
  return `${base.replace(/\/+$/, "")}/api/google/callback`;
}

// ── Projects ──────────────────────────────────────────────────────────────

const projectInput = z.object({
  storeId: z.uuid(),
  label: z.string().min(1).max(80),
  clientId: z.string().min(10).max(200),
  clientSecret: z.string().min(10).max(200),
});

export async function addGoogleProjectAction(
  input: z.input<typeof projectInput>,
): Promise<ConnectionResult> {
  const parsed = projectInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Fill in every field." };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "media.connection.manage");

  if (!encryptionConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  // Google's client ids all carry this suffix. Catching it here saves the
  // seller a failed OAuth round trip to discover they pasted the project
  // number, or the API key, instead.
  if (!data.clientId.endsWith(".apps.googleusercontent.com")) {
    return {
      ok: false,
      message:
        "That is not an OAuth client ID — it should end in .apps.googleusercontent.com.",
    };
  }

  const existing = await db
    .select({ id: storeGoogleProjects.id })
    .from(storeGoogleProjects)
    .where(
      and(
        eq(storeGoogleProjects.storeId, data.storeId),
        eq(storeGoogleProjects.clientId, data.clientId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    // The unique index would catch this, but as an opaque constraint error.
    // Two rows for one client would also double-count a single real budget.
    return { ok: false, message: "That project is already connected." };
  }

  const [{ value: projectCount }] = await db
    .select({ value: count() })
    .from(storeGoogleProjects)
    .where(eq(storeGoogleProjects.storeId, data.storeId));

  const who = await actor();

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(storeGoogleProjects)
      .values({
        storeId: data.storeId,
        label: data.label,
        clientId: data.clientId,
        clientSecretEnc: encryptSecret(data.clientSecret),
        dailyUnitLimit: DEFAULT_DAILY_UNIT_LIMIT,
        unitsUsed: 0,
        unitsResetAt: nextQuotaResetAt(new Date()),
        priority: projectCount,
      })
      .returning({ id: storeGoogleProjects.id });

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "media.project.add",
      targetType: "google_project",
      targetId: created.id,
      targetLabel: data.label,
      before: null,
      // The client id only, never the secret. An audit log that leaks the
      // credential it exists to protect is worse than none.
      after: { label: data.label, clientId: data.clientId },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings/media`);
  return {
    ok: true,
    message: "Project added. Now connect a Google account through it.",
  };
}

const removeProjectInput = z.object({
  storeId: z.uuid(),
  projectId: z.uuid(),
});

export async function removeGoogleProjectAction(
  input: z.input<typeof removeProjectInput>,
): Promise<ConnectionResult> {
  const parsed = removeProjectInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "media.connection.manage");

  const who = await actor();

  // Grants cascade. Media is unaffected: a project only ever supplied quota,
  // and the files themselves belong to the account.
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(storeGoogleProjects)
      .where(
        and(
          eq(storeGoogleProjects.id, data.projectId),
          eq(storeGoogleProjects.storeId, data.storeId),
        ),
      )
      .returning({
        id: storeGoogleProjects.id,
        label: storeGoogleProjects.label,
        clientId: storeGoogleProjects.clientId,
      });

    // Nothing deleted means it was already gone, or belongs to another store.
    // Either way there is no event to record.
    if (!removed) return;

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "media.project.remove",
      targetType: "google_project",
      targetId: removed.id,
      targetLabel: removed.label,
      before: { label: removed.label, clientId: removed.clientId },
      after: null,
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings/media`);
  return { ok: true, message: "Project removed." };
}

// ── Starting an account connection ────────────────────────────────────────

const connectInput = z.object({
  storeId: z.uuid(),
  projectId: z.uuid(),
});

/**
 * Builds the consent URL for authorising an account through one project.
 *
 * Returns the URL rather than redirecting, so the caller can open it and the
 * seller can see where they are going. The state is signed with the app secret
 * and expires in ten minutes — Google echoes it back verbatim, so an unsigned
 * one would let a crafted callback link attach an attacker's Google account to
 * somebody else's store.
 */
export async function startAccountConnectionAction(
  input: z.input<typeof connectInput>,
): Promise<ConnectionResult> {
  const parsed = connectInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "media.connection.manage");

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return { ok: false, message: "Server is missing BETTER_AUTH_SECRET." };
  }
  if (!encryptionConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const [project] = await db
    .select({
      id: storeGoogleProjects.id,
      clientId: storeGoogleProjects.clientId,
    })
    .from(storeGoogleProjects)
    .where(
      and(
        eq(storeGoogleProjects.id, data.projectId),
        eq(storeGoogleProjects.storeId, data.storeId),
      ),
    )
    .limit(1);

  if (!project) return { ok: false, message: "Project not found." };

  const state = signConnectState(
    {
      storeId: data.storeId,
      projectId: project.id,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    secret,
  );

  return {
    ok: true,
    message: "Continue in the Google window.",
    redirectUrl: buildConsentUrl({
      clientId: project.clientId,
      redirectUri: await googleRedirectUri(),
      state,
    }),
  };
}

// ── Accounts ──────────────────────────────────────────────────────────────

const removeAccountInput = z.object({
  storeId: z.uuid(),
  accountId: z.uuid(),
});

/**
 * Counts what disconnecting an account would take down.
 *
 * Only the account that uploaded a file can serve or delete it, so removing
 * one darkens every asset it holds. The seller has to be told the number
 * before they click, not after.
 */
export async function countMediaOnAccountAction(
  input: z.input<typeof removeAccountInput>,
): Promise<number> {
  const parsed = removeAccountInput.safeParse(input);
  if (!parsed.success) return 0;

  await requireStorePermission(parsed.data.storeId, "media.connection.manage");

  const [{ value }] = await db
    .select({ value: count() })
    .from(productImages)
    .where(eq(productImages.googleAccountId, parsed.data.accountId));

  return value;
}

export async function removeGoogleAccountAction(
  input: z.input<typeof removeAccountInput>,
): Promise<ConnectionResult> {
  const parsed = removeAccountInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "media.connection.manage");

  const affected = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(eq(productImages.googleAccountId, data.accountId));

  const who = await actor();

  // Media rows survive with google_account_id set to null — the FK is ON
  // DELETE SET NULL rather than CASCADE on purpose. Deleting them would
  // silently strip photos off live products and leave nobody able to see what
  // broke; this way the asset goes `unavailable` and says so.
  await db.transaction(async (tx) => {
    if (affected.length > 0) {
      await tx
        .update(productImages)
        .set({
          state: "unavailable",
          failureReason:
            "The Google account holding this file was disconnected.",
        })
        .where(eq(productImages.googleAccountId, data.accountId));
    }

    const [removed] = await tx
      .delete(storeGoogleAccounts)
      .where(
        and(
          eq(storeGoogleAccounts.id, data.accountId),
          eq(storeGoogleAccounts.storeId, data.storeId),
        ),
      )
      .returning({
        id: storeGoogleAccounts.id,
        email: storeGoogleAccounts.email,
      });

    if (!removed) return;

    // The file count is the part that matters here. This is the one action in
    // the store that can take live product photos down in bulk, and the log
    // has to say how many rather than just that it happened.
    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "media.account.remove",
      targetType: "google_account",
      targetId: removed.id,
      targetLabel: removed.email,
      before: { email: removed.email },
      after: { mediaHidden: affected.length },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings/media`);
  return {
    ok: true,
    message:
      affected.length > 0
        ? `Account removed. ${affected.length} file(s) are no longer available and have been hidden.`
        : "Account removed.",
  };
}

// ── Ordering ──────────────────────────────────────────────────────────────

const priorityInput = z.object({
  storeId: z.uuid(),
  /** Most-preferred first. */
  ids: z.array(z.uuid()).min(1).max(20),
});

/**
 * Reorders the account pool.
 *
 * Account order is the one a seller actually cares about: it decides which
 * channel their videos land on and which Drive fills up first. Project order
 * is interchangeable plumbing, which is why only this half is exposed.
 */
export async function reorderGoogleAccountsAction(
  input: z.input<typeof priorityInput>,
): Promise<ConnectionResult> {
  const parsed = priorityInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid order." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "media.connection.manage");

  const owned = await db
    .select({
      id: storeGoogleAccounts.id,
      email: storeGoogleAccounts.email,
      priority: storeGoogleAccounts.priority,
    })
    .from(storeGoogleAccounts)
    .where(eq(storeGoogleAccounts.storeId, data.storeId));

  const ownedIds = new Set(owned.map((row) => row.id));
  if (
    data.ids.length !== ownedIds.size ||
    data.ids.some((id) => !ownedIds.has(id))
  ) {
    return { ok: false, message: "That ordering no longer matches." };
  }

  const byId = new Map(owned.map((row) => [row.id, row.email]));
  const previous = [...owned]
    .sort((a, b) => a.priority - b.priority)
    .map((row) => row.email);
  const next = data.ids.map((id) => byId.get(id) ?? id);

  const who = await actor();

  await db.transaction(async (tx) => {
    for (const [index, id] of data.ids.entries()) {
      await tx
        .update(storeGoogleAccounts)
        .set({ priority: index })
        .where(eq(storeGoogleAccounts.id, id));
    }

    // Recorded by email rather than id: the first account in this list is the
    // channel new videos land on, and "who moved my uploads to the other
    // account" needs an answer that reads without a database lookup.
    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "media.account.reorder",
      targetType: "google_account",
      targetId: data.ids[0],
      targetLabel: next[0],
      before: { order: previous },
      after: { order: next },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings/media`);
  return { ok: true, message: "Order saved." };
}

// ── Reading the pool, for the settings page ───────────────────────────────

export type ConnectionOverview = {
  projects: {
    id: string;
    label: string;
    clientId: string;
    state: string;
    priority: number;
    unitsUsed: number;
    dailyUnitLimit: number;
    unitsResetAt: Date;
    lastError: string | null;
  }[];
  accounts: {
    id: string;
    email: string;
    state: string;
    priority: number;
    storageLimitBytes: number | null;
    storageUsageBytes: number | null;
    cooldownUntil: Date | null;
    lastError: string | null;
  }[];
  grants: { id: string; projectId: string; accountId: string; state: string }[];
};

export async function loadConnectionOverviewAction(
  storeId: string,
): Promise<ConnectionOverview> {
  const id = z.uuid().parse(storeId);
  await requireStorePermission(id, "media.connection.view");

  const [projects, accounts, grants] = await Promise.all([
    db
      .select({
        id: storeGoogleProjects.id,
        label: storeGoogleProjects.label,
        clientId: storeGoogleProjects.clientId,
        state: storeGoogleProjects.state,
        priority: storeGoogleProjects.priority,
        unitsUsed: storeGoogleProjects.unitsUsed,
        dailyUnitLimit: storeGoogleProjects.dailyUnitLimit,
        unitsResetAt: storeGoogleProjects.unitsResetAt,
        lastError: storeGoogleProjects.lastError,
      })
      .from(storeGoogleProjects)
      .where(eq(storeGoogleProjects.storeId, id))
      .orderBy(storeGoogleProjects.priority),

    db
      .select({
        id: storeGoogleAccounts.id,
        email: storeGoogleAccounts.email,
        state: storeGoogleAccounts.state,
        priority: storeGoogleAccounts.priority,
        storageLimitBytes: storeGoogleAccounts.storageLimitBytes,
        storageUsageBytes: storeGoogleAccounts.storageUsageBytes,
        cooldownUntil: storeGoogleAccounts.cooldownUntil,
        lastError: storeGoogleAccounts.lastError,
      })
      .from(storeGoogleAccounts)
      .where(eq(storeGoogleAccounts.storeId, id))
      .orderBy(storeGoogleAccounts.priority),

    db
      .select({
        id: storeGoogleGrants.id,
        projectId: storeGoogleGrants.projectId,
        accountId: storeGoogleGrants.accountId,
        state: storeGoogleGrants.state,
      })
      .from(storeGoogleGrants)
      .innerJoin(
        storeGoogleProjects,
        eq(storeGoogleProjects.id, storeGoogleGrants.projectId),
      )
      .where(eq(storeGoogleProjects.storeId, id)),
  ]);

  return { projects, accounts, grants };
}
