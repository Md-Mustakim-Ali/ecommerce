/**
 * The accessibility audit, as a runnable check.
 *
 * Parses the server-rendered HTML for every important route and asserts the
 * things that are true of the markup regardless of what the browser does with
 * it: every image has alt, every control has a name, headings do not skip,
 * there is one h1 and one main, ids are unique.
 *
 * These are not everything. Focus order, contrast under a real theme, and
 * whether a screen reader announcement makes sense are all judgement calls a
 * script cannot make, and they are recorded in docs/accessibility.md instead.
 * What this catches is the regression: a control that loses its label six
 * months from now, which nobody notices because nobody re-runs a manual pass.
 *
 * Deliberately no headless browser. The server HTML is what a screen reader
 * gets first and what a crawler sees, and testing it needs no extra
 * dependency — which is the difference between a check that runs and one that
 * rots.
 */

import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { products, stores } from "../lib/db/schema/index.ts";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const findings: string[] = [];

function fail(route: string, rule: string, detail: string) {
  failures++;
  findings.push(` FAIL  ${route}  ${rule}: ${detail}`);
}

/** Strips comments and script/style bodies so their contents are not parsed. */
function clean(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

function has(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(tag);
}

function audit(route: string, raw: string) {
  const html = clean(raw);

  // --- images -------------------------------------------------------------
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (!has(tag, "alt")) {
      fail(
        route,
        "img-alt",
        `${attr(tag, "src")?.slice(0, 70) ?? tag.slice(0, 70)}`,
      );
    }
  }

  // --- one h1, and no skipped levels --------------------------------------
  const headings = [
    ...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi),
  ].map((m) => ({
    level: Number(m[1]),
    text: m[2].replace(/<[^>]*>/g, "").trim(),
  }));

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) {
    fail(route, "h1-count", `${h1s.length} h1 elements`);
  }

  let previous = 0;
  for (const heading of headings) {
    if (previous && heading.level > previous + 1) {
      fail(
        route,
        "heading-skip",
        `h${previous} → h${heading.level} at "${heading.text.slice(0, 40)}"`,
      );
    }
    previous = heading.level;
  }

  // --- landmarks and language ---------------------------------------------
  if (!/<main\b/i.test(html)) fail(route, "no-main", "no <main> landmark");
  if (!/<html[^>]*\blang\s*=/i.test(raw))
    fail(route, "no-lang", "html has no lang");

  // --- controls with no accessible name -----------------------------------
  // A button whose only content is an icon, with no aria-label, is announced
  // as "button" and is the most common real failure in an interface like this.
  for (const match of html.matchAll(
    /<button\b([^>]*)>([\s\S]*?)<\/button>/gi,
  )) {
    const [, attributes, inner] = match;
    const text = inner.replace(/<[^>]*>/g, "").trim();
    const labelled =
      attr(`<b ${attributes}>`, "aria-label") ||
      attr(`<b ${attributes}>`, "aria-labelledby") ||
      attr(`<b ${attributes}>`, "title");
    if (!text && !labelled) {
      fail(route, "button-name", `<button${attributes.slice(0, 60)}>`);
    }
  }

  // Links, ignoring ones deliberately removed from the tree.
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const [, attributes, inner] = match;
    if (/aria-hidden\s*=\s*["']?true/i.test(attributes)) continue;
    if (!/\bhref\b/i.test(attributes)) continue;

    const text = inner.replace(/<[^>]*>/g, "").trim();
    const imgAlt = [...inner.matchAll(/<img\b[^>]*>/gi)]
      .map((img) => attr(img[0], "alt")?.trim())
      .find(Boolean);
    const labelled =
      attr(`<b ${attributes}>`, "aria-label") ||
      attr(`<b ${attributes}>`, "aria-labelledby");

    if (!text && !imgAlt && !labelled) {
      fail(route, "link-name", `href=${attr(`<b ${attributes}>`, "href")}`);
    }
  }

  // --- form fields --------------------------------------------------------
  //
  // A wrapping <label> is as valid as `for=`, and the theme toggle uses one —
  // an earlier version of this checked only `for=` and reported three
  // correctly-labelled radios as failures on every page. A checker that cries
  // wolf gets ignored, so wrapped labels are resolved properly here.
  const wrappedInputs = new Set<string>();
  for (const match of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const [, labelAttributes, inner] = match;
    const labelText =
      inner.replace(/<[^>]*>/g, "").trim() ||
      attr(`<b ${labelAttributes}>`, "title") ||
      "";
    if (!labelText) continue;
    for (const input of inner.match(/<input\b[^>]*>/gi) ?? []) {
      wrappedInputs.add(input);
    }
  }

  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") continue;

    const id = attr(tag, "id");
    const labelled =
      attr(tag, "aria-label") ||
      attr(tag, "aria-labelledby") ||
      wrappedInputs.has(tag) ||
      (id &&
        new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${id}["']`, "i").test(html));

    if (!labelled) {
      fail(
        route,
        "input-label",
        `type=${type} name=${attr(tag, "name") ?? "?"}`,
      );
    }
  }

  // --- duplicate ids ------------------------------------------------------
  // A duplicate id silently breaks `for`/`aria-labelledby`, which is exactly
  // the kind of failure nobody sees on screen.
  const ids = new Map<string, number>();
  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    ids.set(match[1], (ids.get(match[1]) ?? 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1) fail(route, "duplicate-id", `${id} × ${count}`);
  }

  // --- positive tabindex --------------------------------------------------
  for (const match of html.matchAll(/\btabindex\s*=\s*["']?(\d+)/gi)) {
    if (Number(match[1]) > 0) {
      fail(route, "positive-tabindex", `tabindex=${match[1]}`);
    }
  }
}

async function main() {
  const [store] = await db.select({ slug: stores.slug }).from(stores).limit(1);
  const [product] = await db
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.status, "active"))
    .limit(1);

  const routes = [
    "/",
    "/search",
    "/c/electronics",
    `/p/${product.slug}`,
    `/store/${store.slug}`,
    "/cart",
    "/checkout",
    "/sign-in",
    "/sign-up",
    "/this-route-does-not-exist",
  ];

  console.log(`base: ${BASE}\n`);

  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`, { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      console.log(`  --   ${route} redirects (${response.status}), skipped`);
      continue;
    }

    const before = failures;
    audit(route, await response.text());
    const found = failures - before;
    console.log(
      `${found === 0 ? "  ok  " : " FAIL "} ${route.padEnd(34)} ${
        found === 0 ? "clean" : `${found} problem${found === 1 ? "" : "s"}`
      }`,
    );
  }

  if (findings.length > 0) {
    console.log(`\n${findings.join("\n")}`);
  }

  console.log(
    failures === 0
      ? "\nno automated accessibility failures"
      : `\n${failures} PROBLEM(S)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
