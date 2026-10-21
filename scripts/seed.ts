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
  attributes,
  attributeValues,
  brands,
  categories,
  pageBlocks,
  pages,
  placements,
  placementTargets,
  productAttributes,
  productAttributeValues,
  productImageAttributeValues,
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
  variantAttributeValues,
} from "../lib/db/schema/index.ts";
import { seedContent } from "../lib/db/seed/content.ts";
import { seedSystemRoles } from "../lib/db/seed/system-roles.ts";
import {
  ADMIN,
  ATTRIBUTES,
  BRANDS,
  BUYERS,
  CATEGORY_TREE,
  PENDING_BRANDS,
  PENDING_TAGS,
  productTitle,
  SEED_PASSWORD,
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
      ${placementTargets}, ${placements}, ${pageBlocks}, ${pages},
      ${variantAttributeValues}, ${productAttributeValues}, ${productAttributes},
      ${attributeValues}, ${attributes},
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

  // Attributes. Global and deduplicated by slug, exactly like brands and tags,
  // so the storefront can offer one Colour filter across the whole catalogue
  // instead of one per store.
  type SeededAttribute = {
    id: string;
    slug: string;
    values: { id: string; value: string }[];
  };
  const attributeBySlug = new Map<string, SeededAttribute>();
  const attributeById = new Map<string, SeededAttribute>();

  for (const [position, definition] of ATTRIBUTES.entries()) {
    const [attributeRow] = await db
      .insert(attributes)
      .values({
        name: definition.name,
        slug: slugify(definition.name),
        kind: definition.kind,
        isFilterable: definition.kind !== "text",
        position,
        status: "approved",
        approvedBy: adminId,
        approvedAt: new Date(),
      })
      .returning({ id: attributes.id });

    const valueRows = await db
      .insert(attributeValues)
      .values(
        definition.values.map((value, index) => ({
          attributeId: attributeRow.id,
          value: value.value,
          slug: slugify(value.value),
          meta: ("meta" in value ? value.meta : {}) as Record<string, unknown>,
          position: index,
          status: "approved" as const,
        })),
      )
      .returning({ id: attributeValues.id, value: attributeValues.value });

    const seeded: SeededAttribute = {
      id: attributeRow.id,
      slug: definition.slug,
      values: valueRows,
    };
    attributeBySlug.set(definition.slug, seeded);
    attributeById.set(attributeRow.id, seeded);
  }

  console.log(
    `  ${ATTRIBUTES.length} attributes, ${ATTRIBUTES.reduce((n, a) => n + a.values.length, 0)} values`,
  );

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

  // Variants, images, tags and attributes
  const variantValues: {
    productId: string;
    sku: string;
    optionValues: Record<string, string>;
    priceCents: number;
    compareAtPriceCents: number | null;
    stock: number;
    weightGrams: number;
    position: number;
    /** Carried so the variant-attribute rows can be written after insert. */
    combo: { attributeId: string; valueId: string }[];
  }[] = [];
  const imageValues = [];
  const tagValues: { productId: string; tagId: string }[] = [];
  const productAttrRows: {
    productId: string;
    attributeId: string;
    role: "variant" | "spec";
    position: number;
  }[] = [];
  const productAttrValueRows: {
    productId: string;
    attributeId: string;
    valueId: string;
  }[] = [];

  for (const [i, product] of productRows.entries()) {
    const basePrice = between(9, 320) * 100;

    // Which attributes drive this product's variants. Roughly a fifth get the
    // three-attribute treatment (RAM, storage, colour) so the seed exercises a
    // phone-style matrix, not just size and colour.
    const usesTechMatrix = i % 5 === 0;
    const variantAttrSlugs = usesTechMatrix
      ? ["ram", "storage", "colour"]
      : ["size", "colour"];
    const specAttrSlugs = usesTechMatrix
      ? ["made-in"]
      : ["material", "made-in"];

    for (const [position, slug] of variantAttrSlugs.entries()) {
      const attribute = attributeBySlug.get(slug);
      if (!attribute) continue;
      productAttrRows.push({
        productId: product.id,
        attributeId: attribute.id,
        role: "variant",
        position,
      });
    }
    for (const [position, slug] of specAttrSlugs.entries()) {
      const attribute = attributeBySlug.get(slug);
      if (!attribute) continue;
      productAttrRows.push({
        productId: product.id,
        attributeId: attribute.id,
        role: "spec",
        position: variantAttrSlugs.length + position,
      });
      // A spec attribute gets exactly one value, which is what makes it a spec.
      const value = pick(attribute.values);
      productAttrValueRows.push({
        productId: product.id,
        attributeId: attribute.id,
        valueId: value.id,
      });
    }

    // Two or three values offered per variant attribute.
    const offered = variantAttrSlugs.map((slug) => {
      const attribute = attributeBySlug.get(slug);
      if (!attribute) return null;
      const howMany = Math.min(attribute.values.length, between(2, 3));
      const chosenValues = [...attribute.values]
        .sort(() => random() - 0.5)
        .slice(0, howMany);
      for (const value of chosenValues) {
        productAttrValueRows.push({
          productId: product.id,
          attributeId: attribute.id,
          valueId: value.id,
        });
      }
      return { attribute, values: chosenValues };
    });

    // The full cross product of what is offered...
    let combos: { attributeId: string; valueId: string; label: string }[][] = [
      [],
    ];
    for (const entry of offered) {
      if (!entry) continue;
      combos = combos.flatMap((combo) =>
        entry.values.map((value) => [
          ...combo,
          {
            attributeId: entry.attribute.id,
            valueId: value.id,
            label: value.value,
          },
        ]),
      );
    }

    // ...minus some of it. Not every combination exists in reality — a phone
    // may ship 12GB/512GB in blue but not 12GB/256GB in blue — and the schema
    // represents that by simply not having a variant for it. Dropping around a
    // fifth here means the storefront's "unavailable combination" handling is
    // exercised by real data rather than assumed.
    const surviving = combos.filter(() => random() > 0.2);
    const finalCombos = surviving.length > 0 ? surviving : combos.slice(0, 1);

    for (const [v, combo] of finalCombos.entries()) {
      variantValues.push({
        productId: product.id,
        sku: `SKU-${String(i).padStart(4, "0")}-${v}`,
        optionValues: Object.fromEntries(
          combo.map((part) => [
            attributeById.get(part.attributeId)?.slug ?? "option",
            part.label,
          ]),
        ) as Record<string, string>,
        // Per-combination pricing: more RAM or a larger size costs more, which
        // is the point of pricing on the variant rather than the product.
        priceCents: basePrice + v * between(300, 2500),
        // A quarter of variants carry a compare-at price so sale badges appear.
        compareAtPriceCents: random() < 0.25 ? basePrice + 4000 : null,
        // Some zero stock, so sold-out states are exercised by real data.
        stock: random() < 0.08 ? 0 : between(1, 60),
        weightGrams: between(80, 3000),
        position: v,
        combo: combo.map((part) => ({
          attributeId: part.attributeId,
          valueId: part.valueId,
        })),
      });
    }

    const hue = (i * 37) % 360;

    // One image per offered colour, tagged with that colour, so picking a
    // colour on the product page swaps the photo. Plus one untagged image that
    // acts as the default when nothing matches.
    const colourEntry = offered.find((e) => e?.attribute.slug === "colour");
    imageValues.push({
      productId: product.id,
      url: `https://picsum.photos/seed/${product.id}-main/900/900`,
      alt: product.title,
      position: 0,
      width: 900,
      height: 900,
      blurDataUrl: `data:image/svg+xml;base64,${Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="hsl(${hue} 25% 60%)"/></svg>`,
      ).toString("base64")}`,
      tag: null as { attributeId: string; valueId: string } | null,
    });

    if (colourEntry) {
      for (const [index, value] of colourEntry.values.entries()) {
        imageValues.push({
          productId: product.id,
          url: `https://picsum.photos/seed/${product.id}-${value.id}/900/900`,
          alt: `${product.title} in ${value.value}`,
          position: index + 1,
          width: 900,
          height: 900,
          blurDataUrl: `data:image/svg+xml;base64,${Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="hsl(${(hue + index * 40) % 360} 30% 55%)"/></svg>`,
          ).toString("base64")}`,
          tag: { attributeId: colourEntry.attribute.id, valueId: value.id },
        });
      }
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

  // Variants are inserted with their combination carried alongside, so the
  // variant_attribute_values rows can be written against the returned ids.
  const variantAttrRows: {
    variantId: string;
    attributeId: string;
    valueId: string;
  }[] = [];

  for (const batch of chunk(variantValues, 400)) {
    const inserted = await db
      .insert(productVariants)
      .values(batch.map(({ combo: _combo, ...rest }) => rest))
      .returning({ id: productVariants.id });

    for (const [index, row] of inserted.entries()) {
      for (const part of batch[index].combo) {
        variantAttrRows.push({
          variantId: row.id,
          attributeId: part.attributeId,
          valueId: part.valueId,
        });
      }
    }
  }

  const imageTagRows: {
    imageId: string;
    attributeId: string;
    valueId: string;
  }[] = [];

  for (const batch of chunk(imageValues, 400)) {
    const inserted = await db
      .insert(productImages)
      .values(batch.map(({ tag: _tag, ...rest }) => rest))
      .returning({ id: productImages.id });

    for (const [index, row] of inserted.entries()) {
      const tag = batch[index].tag;
      if (tag) {
        imageTagRows.push({
          imageId: row.id,
          attributeId: tag.attributeId,
          valueId: tag.valueId,
        });
      }
    }
  }

  for (const batch of chunk(imageTagRows, 500)) {
    await db
      .insert(productImageAttributeValues)
      .values(batch)
      .onConflictDoNothing();
  }
  for (const batch of chunk(tagValues, 500)) {
    await db.insert(productTags).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(productAttrRows, 500)) {
    await db.insert(productAttributes).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(productAttrValueRows, 500)) {
    await db.insert(productAttributeValues).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(variantAttrRows, 500)) {
    await db.insert(variantAttributeValues).values(batch).onConflictDoNothing();
  }

  console.log(
    `  ${variantValues.length} variants, ${imageValues.length} images (${imageTagRows.length} colour-tagged), ${tagValues.length} product tags`,
  );
  console.log(
    `  ${productAttrRows.length} product-attribute links, ${variantAttrRows.length} variant combinations`,
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

  const content = await seedContent(db, {
    adminId,
    storeId: firstStore.id,
  });
  console.log(`  ${content.pages} pages, ${content.placements} placements`);

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
