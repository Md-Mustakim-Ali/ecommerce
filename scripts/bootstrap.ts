/**
 * Prepares an empty database for real use. No demo data.
 *
 * `pnpm db:seed` fills the shop with invented stores, products, orders and
 * reviews, which is the right thing locally and the wrong thing on the
 * database a real shop is about to run on. But a freshly migrated database is
 * not usable either, for two reasons that have nothing to do with demo
 * content:
 *
 *   1. The RBAC role templates do not exist. They are reference data, not
 *      sample data — without them a store owner has no roles to give staff and
 *      the platform has no super-admin role to grant anyone.
 *
 *   2. Nobody can grant a platform role, because granting one requires already
 *      holding one. That is the correct rule and it makes the first admin
 *      impossible to create through the interface. Bootstrapping has to happen
 *      out of band, which is what this is.
 *
 * Idempotent. Run it again after adding a second admin, or after a migration
 * adds a role template.
 *
 *   pnpm tsx --env-file=.env.local scripts/bootstrap.ts you@example.com
 *
 * Or against a deployed database, without touching .env.local:
 *
 *   DATABASE_URL="postgresql://…" pnpm tsx scripts/bootstrap.ts you@example.com
 *
 * The account must already exist — sign up through the site first. This
 * deliberately does not create it: a script that can mint a verified admin
 * account from an email address is a much larger thing to leave lying around
 * than one that can only promote an account somebody already proved they
 * control.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { roles, user, userPlatformRoles } from "@/lib/db/schema";
import { seedSystemRoles } from "@/lib/db/seed/system-roles";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  // ── Reference data ───────────────────────────────────────────────────────
  //
  // Runs with or without an email. The role templates are needed before
  // anybody signs up, and the first admin cannot be promoted until after —
  // so this is deliberately usable in two passes rather than demanding both
  // halves be possible at once.
  const roleCount = await seedSystemRoles(db);
  console.log(`Role templates ensured (${roleCount} touched).`);

  if (!email) {
    console.log(
      "\nNo email given, so no admin was promoted. Sign up on the site,\n" +
        "then run this again with that address:\n\n" +
        "  pnpm tsx --env-file=.env.local scripts/bootstrap.ts you@example.com\n",
    );
    process.exit(0);
  }

  // ── The first admin ──────────────────────────────────────────────────────
  const account = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (!account) {
    console.error(
      `\nNo account for ${email}.\n` +
        `Sign up on the site first, then run this again — it promotes an\n` +
        `existing account rather than creating one.`,
    );
    process.exit(1);
  }

  const superAdmin = await db.query.roles.findFirst({
    where: eq(roles.slug, "super-admin"),
  });

  if (!superAdmin) {
    console.error("No super-admin role after seeding. That is a bug.");
    process.exit(1);
  }

  await db
    .insert(userPlatformRoles)
    .values({ userId: account.id, roleId: superAdmin.id })
    // Already an admin is the desired end state, not an error.
    .onConflictDoNothing();

  // Better Auth will not let an unverified address sign in, and on a fresh
  // deployment there may be no mail transport configured yet — so the first
  // admin would be locked out of the site they were just given the keys to.
  if (!account.emailVerified) {
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, account.id));
    console.log("Marked the address verified so the account can sign in.");
  }

  console.log(`\n${email} is now a platform super-admin.`);
  console.log(
    "\nNext: sign in, then create a store from the seller dashboard.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
