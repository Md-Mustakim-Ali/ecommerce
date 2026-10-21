/**
 * Development seed.
 *
 * Run with `pnpm db:seed`, or `pnpm db:reset` to truncate first.
 *
 * Users are created through Better Auth rather than by inserting rows, so the
 * seeded accounts have real password hashes and can actually sign in. Every
 * account shares SEED_PASSWORD; this is local-only data on .test domains.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { auth } from "../lib/auth/index.ts";
import { slugify } from "../lib/catalog/normalize.ts";
import { proposeTerm } from "../lib/catalog/terms.ts";
import { db } from "../lib/db/index.ts";
import {
  brands,
  categories,
  productImages,
  products,
  productTags,
  productVariants,
  roles,
  storeMemberRoles,
  storeMembers,
  stores,
  tags,
  user,
  userPlatformRoles,
} from "../lib/db/schema/index.ts";
import { seedSystemRoles } from "../lib/db/seed/system-roles.ts";
import {
  ADMIN,
  BRANDS,
  BUYERS,
  CATEGORY_TREE,
  COLOR_OPTIONS,
  PENDING_BRANDS,
  PENDING_TAGS,
  productTitle,
  SEED_PASSWORD,
  SIZE_OPTIONS,
  STAFF,
  STORES,
  TAGS,
} from "./seed-data.ts";

const PRODUCT_COUNT = 200;

/** Deterministic PRNG so two seed runs produce identical data. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const random = makeRandom(20260903);
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];
const between = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));

async function reset() {
  console.log("  truncating…");
  // TRUNCATE ... CASCADE emits a NOTICE per cascaded table, which buries the
  // actual seed output.
  await db.execute(sql`set local client_min_messages to warning`);
  // TRUNCATE rather than DELETE: the ledger trigger blocks DELETE by design,
  // and CASCADE handles the foreign keys in one statement.
  await db.execute(sql`
    truncate table
      ${productTags}, ${productVariants}, ${productImages}, ${products},
      ${brands}, ${tags}, ${categories},
      ${storeMemberRoles}, ${storeMembers}, ${stores},
      ${userPlatformRoles}, ${roles}
    restart identity cascade
  `);
  await db.execute(sql`truncate table ${user} restart identity cascade`);
}

async function createUser(name: string, email: string): Promise<string> {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
  });
  if (existing) return existing.id;

  const result = await auth.api.signUpEmail({
    body: { name, email, password: SEED_PASSWORD },
  });
  return result.user.id;
}

async function seedCategories() {
  const leafIds: { id: string; name: string }[] = [];
  let total = 0;

  for (const [topIndex, top] of CATEGORY_TREE.entries()) {
    const [topRow] = await db
      .insert(categories)
      .values({ name: top.name, slug: slugify(top.name), position: topIndex })
      .returning({ id: categories.id });
    total++;

    for (const [midIndex, mid] of top.children.entries()) {
      const [midRow] = await db
        .insert(categories)
        .values({
          parentId: topRow.id,
          name: mid.name,
          slug: slugify(`${top.name} ${mid.name}`),
          position: midIndex,
        })
        .returning({ id: categories.id });
      total++;

      for (const [leafIndex, leaf] of mid.children.entries()) {
        const [leafRow] = await db
          .insert(categories)
          .values({
            parentId: midRow.id,
            name: leaf,
            slug: slugify(`${mid.name} ${leaf}`),
            position: leafIndex,
          })
          .returning({ id: categories.id });
        total++;
        leafIds.push({ id: leafRow.id, name: leaf });
      }
    }
  }

  return { leafIds, total };
}

async function main() {
  const shouldReset = process.argv.includes("--reset");
  console.log(shouldReset ? "Resetting and seeding…" : "Seeding…");

  if (shouldReset) {
    await reset();
  } else {
    // Without --reset this would hit the unique index on brands.slug partway
    // through and surface a raw constraint violation. Fail up front with
    // something actionable instead.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products);

    if (count > 0) {
      console.error(
        [
          "",
          `The catalog already has ${count} products.`,
          "Seeding on top of that would violate the unique index on brands.slug.",
          "Run `pnpm db:reset` to truncate and reseed.",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
  }

  const roleCount = await seedSystemRoles(db);
  console.log(`  ${roleCount} system roles`);

  // Admin
  const adminId = await createUser(ADMIN.name, ADMIN.email);
  const superAdmin = await db.query.roles.findFirst({
    where: and(
      eq(roles.slug, ADMIN.roleSlug),
      eq(roles.scope, "platform"),
      isNull(roles.storeId),
    ),
  });
  if (superAdmin) {
    await db
      .insert(userPlatformRoles)
      .values({ userId: adminId, roleId: superAdmin.id })
      .onConflictDoNothing();
  }

  for (const buyer of BUYERS) await createUser(buyer.name, buyer.email);
  console.log(`  1 admin, ${BUYERS.length} buyers`);

  // Catalog terms
  const brandRows = await db
    .insert(brands)
    .values(
      BRANDS.map((name) => ({
        name,
        slug: slugify(name),
        status: "approved" as const,
        approvedBy: adminId,
        approvedAt: new Date(),
      })),
    )
    .returning({ id: brands.id, name: brands.name });

  // Routed through the real propose flow rather than inserted directly, so the
  // seed exercises deduplication instead of stepping around it. Some of these
  // fixtures collide by design — "Kestrel and Co" slugs identically to
  // "Kestrel & Co" — and the outcome is reported rather than crashing.
  const brandOutcomes: Record<string, number> = {};
  for (const name of PENDING_BRANDS) {
    const result = await proposeTerm(db, "brand", name, adminId);
    brandOutcomes[result.outcome] = (brandOutcomes[result.outcome] ?? 0) + 1;
  }

  const tagRows = await db
    .insert(tags)
    .values(
      TAGS.map((name) => ({
        name,
        slug: slugify(name),
        status: "approved" as const,
        approvedBy: adminId,
        approvedAt: new Date(),
      })),
    )
    .returning({ id: tags.id, name: tags.name });

  const tagOutcomes: Record<string, number> = {};
  for (const name of PENDING_TAGS) {
    const result = await proposeTerm(db, "tag", name, adminId);
    tagOutcomes[result.outcome] = (tagOutcomes[result.outcome] ?? 0) + 1;
  }

  const describe = (outcomes: Record<string, number>) =>
    Object.entries(outcomes)
      .map(([outcome, count]) => `${count} ${outcome}`)
      .join(", ");

  console.log(`  ${brandRows.length} brands approved`);
  console.log(`    proposals: ${describe(brandOutcomes)}`);
  console.log(`  ${tagRows.length} tags approved`);
  console.log(`    proposals: ${describe(tagOutcomes)}`);

  const { leafIds, total: categoryTotal } = await seedCategories();
  console.log(`  ${categoryTotal} categories, ${leafIds.length} leaves`);

  // Stores
  const storeRows: { id: string; name: string }[] = [];
  for (const store of STORES) {
    const ownerId = await createUser(store.owner.name, store.owner.email);
    const [row] = await db
      .insert(stores)
      .values({
        ownerId,
        name: store.name,
        slug: store.slug,
        description: store.description,
        status: "active",
        accentColor: store.accentColor,
        layoutPreset: store.layoutPreset,
        supportEmail: store.owner.email,
      })
      .returning({ id: stores.id, name: stores.name });
    storeRows.push(row);
  }
  console.log(`  ${storeRows.length} stores`);

  // Staff on the first store, so the role system has real data behind it.
  const firstStore = storeRows[0];
  for (const staff of STAFF) {
    const userId = await createUser(staff.name, staff.email);
    const [member] = await db
      .insert(storeMembers)
      .values({
        storeId: firstStore.id,
        userId,
        status: "active",
        joinedAt: new Date(),
      })
      .returning({ id: storeMembers.id });

    const template = await db.query.roles.findFirst({
      where: and(
        eq(roles.slug, staff.roleSlug),
        eq(roles.scope, "store"),
        isNull(roles.storeId),
      ),
    });
    if (template) {
      await db
        .insert(storeMemberRoles)
        .values({ memberId: member.id, roleId: template.id });
    }
  }
  console.log(`  ${STAFF.length} staff on ${firstStore.name}`);

  // Products
  const productValues = [];
  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const store = storeRows[i % storeRows.length];
    const leaf = leafIds[i % leafIds.length];
    const brand = random() < 0.85 ? pick(brandRows) : null;
    const title = productTitle(leaf.name, i);
    const draft = random() < 0.08;

    productValues.push({
      storeId: store.id,
      brandId: brand?.id ?? null,
      categoryId: leaf.id,
      title,
      // Suffixed because the same title can recur across the 200, and
      // (store_id, slug) is unique.
      slug: `${slugify(title)}-${i}`,
      description: `${title}. Made in small batches and stocked by ${store.name}.`,
      // Drawn from the PRNG rather than `i % 12`. The title generator steps
      // adjectives by 18 and materials by 12, so any modulus sharing a factor
      // with those silently made whole title combinations draft-only — every
      // "Merino wool" product was invisible to search until this changed.
      status: draft ? ("draft" as const) : ("active" as const),
      // Denormalised so the generated tsvector can see the brand name.
      searchKeywords: brand?.name ?? "",
      publishedAt: draft ? null : new Date(),
    });
  }

  const productRows = await db
    .insert(products)
    .values(productValues)
    .returning({ id: products.id, title: products.title });

  console.log(`  ${productRows.length} products`);

  // Variants, images and tags
  const variantValues = [];
  const imageValues = [];
  const tagValues: { productId: string; tagId: string }[] = [];

  for (const [i, product] of productRows.entries()) {
    const variantCount = between(1, 3);
    const basePrice = between(9, 320) * 100;

    for (let v = 0; v < variantCount; v++) {
      variantValues.push({
        productId: product.id,
        sku: `SKU-${String(i).padStart(4, "0")}-${v}`,
        // Annotated because the ternary otherwise widens `{}` into
        // `{ size?: undefined }`, which is not a Record<string, string>.
        optionValues: (variantCount === 1
          ? {}
          : {
              size: SIZE_OPTIONS[v % SIZE_OPTIONS.length],
              color: pick(COLOR_OPTIONS),
            }) as Record<string, string>,
        priceCents: basePrice + v * 500,
        // A quarter of variants carry a compare-at price so sale badges appear.
        compareAtPriceCents: random() < 0.25 ? basePrice + 4000 : null,
        // Some zero stock, so sold-out states are exercised by real data.
        stock: random() < 0.08 ? 0 : between(1, 60),
        weightGrams: between(80, 3000),
        position: v,
      });
    }

    const hue = (i * 37) % 360;
    for (let img = 0; img < between(1, 3); img++) {
      imageValues.push({
        productId: product.id,
        url: `https://picsum.photos/seed/${product.id}-${img}/900/1125`,
        alt: product.title,
        position: img,
        width: 900,
        height: 1125,
        blurDataUrl: `data:image/svg+xml;base64,${Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><rect width="4" height="5" fill="hsl(${hue} 25% 60%)"/></svg>`,
        ).toString("base64")}`,
      });
    }

    const chosen = new Set<string>();
    for (let t = 0; t < between(1, 4); t++) chosen.add(pick(tagRows).id);
    for (const tagId of chosen)
      tagValues.push({ productId: product.id, tagId });
  }

  // Chunked: a single 200k-parameter insert exceeds what the driver will bind.
  const chunk = <T>(items: T[], size: number) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
      items.slice(i * size, i * size + size),
    );

  for (const batch of chunk(variantValues, 500)) {
    await db.insert(productVariants).values(batch);
  }
  for (const batch of chunk(imageValues, 500)) {
    await db.insert(productImages).values(batch);
  }
  for (const batch of chunk(tagValues, 500)) {
    await db.insert(productTags).values(batch).onConflictDoNothing();
  }

  console.log(
    `  ${variantValues.length} variants, ${imageValues.length} images, ${tagValues.length} product tags`,
  );

  // Tag names have to reach search_keywords too, and they are only known now
  // that product_tags is populated.
  await db.execute(sql`
    update ${products} p
    set search_keywords = coalesce(k.keywords, '')
    from (
      select p2.id,
        concat_ws(' ', b.name,
          (select string_agg(t.name, ' ')
             from ${productTags} pt join ${tags} t on t.id = pt.tag_id
            where pt.product_id = p2.id)) as keywords
      from ${products} p2
      left join ${brands} b on b.id = p2.brand_id
    ) k
    where p.id = k.id
  `);

  console.log("\nDone. Every seeded account uses the password:");
  console.log(`  ${SEED_PASSWORD}`);
  console.log(`  admin:  ${ADMIN.email}`);
  console.log(`  seller: ${STORES[0].owner.email}`);
  console.log(`  staff:  ${STAFF[0].email} (Manager)`);
  console.log(`  buyer:  ${BUYERS[0].email}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
