/**
 * Motion audit.
 *
 * Finds three things a grep cannot, in order of how much damage they do:
 *
 *  1. Tailwind 4 CSS variables written with brackets: duration-[--duration-base]
 *     instead of duration-(--duration-base).
 *
 *     This is the one that matters. Tailwind 3 read `[--x]` as var(--x);
 *     Tailwind 4 does not — it passes the text through literally, so the rule
 *     compiles to `transition-duration: --duration-base`, the browser throws
 *     the declaration away, and the duration falls to 0s. The class list still
 *     looks correct. Nothing warns. Biome and tsc both pass. The only symptom
 *     is that the transition does not happen, and the natural response is to
 *     go and retune the easing curves — which changes nothing, because no
 *     transition is running to be tuned.
 *
 *     Thirty of these were live in this codebase at once, including every
 *     transition on the product card, which is why the card appeared to have
 *     no hover at all.
 *
 *  2. Hover, focus and open states that MOVE an element with no transition
 *     anywhere near them. Colour, border, shadow and opacity are covered by
 *     the default transition in globals.css @layer base, so they are not
 *     checked here — transform is deliberately excluded from that default
 *     (it would interfere with the scroll-linked animations), which means a
 *     hover that scales or translates has to declare its own transition or it
 *     will teleport.
 *
 *  3. Hardcoded durations and easings. Every one of them is a value that will
 *     not move when the motion tokens do, so the scale silently drifts apart.
 *
 * Run with: pnpm tsx scripts/audit-motion.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app"];
/** Vendored, and retuning it would be a merge conflict every upgrade. */
const SKIP = /node_modules|[\\/]\.next|components[\\/]analytics[\\/]ui/;

const STATEFUL =
  /(hover|focus-visible|focus|active|group-hover|group-focus-within|data-open):-?(scale-|translate-|rotate-)/;
const HARDCODED =
  /\b(duration-\d+|ease-linear|ease-\[cubic-bezier|transition-all)\b/;
/**
 * A utility taking a bare custom property in brackets. `[--x:1rem]` — the
 * arbitrary-property form — is legal and deliberately not matched, because the
 * closing bracket here has to follow the variable name directly.
 */
const BRACKET_VAR = /[a-z][a-z-]*-\[--[a-zA-Z0-9-]+\]/;

type Hit = { file: string; line: number; text: string };

const bracketVars: Hit[] = [];
const missing: Hit[] = [];
const hardcoded: Hit[] = [];

function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (SKIP.test(full)) continue;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".css")) continue;

    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, index) => {
      // .css files are hand-written CSS, where [--x] never appears as a class.
      if (full.endsWith(".tsx") && BRACKET_VAR.test(line)) {
        bracketVars.push({ file: full, line: index + 1, text: line.trim() });
      }
      if (HARDCODED.test(line)) {
        hardcoded.push({ file: full, line: index + 1, text: line.trim() });
      }
      if (!STATEFUL.test(line)) return;
      // A class list is usually split across several lines by the formatter,
      // so the transition that governs this state may be a few lines away.
      const window = lines.slice(Math.max(0, index - 10), index + 11).join(" ");
      if (
        /transition|motion-(backdrop|popup|panel)|\.pressable|\.elevate/.test(
          window,
        )
      )
        return;
      missing.push({ file: full, line: index + 1, text: line.trim() });
    });
  }
}

for (const root of ROOTS) walk(root);

const show = (label: string, hits: Hit[]) => {
  console.log(`\n${label}: ${hits.length}`);
  for (const hit of hits) {
    console.log(
      `  ${hit.file.replace(/\\/g, "/")}:${hit.line}  ${hit.text.slice(0, 110)}`,
    );
  }
};

show(
  "Bracketed CSS variable — compiles to nothing, use ( ) not [ ]",
  bracketVars,
);
show("State change with no transition", missing);
show("Hardcoded timing", hardcoded);

process.exitCode =
  bracketVars.length + missing.length + hardcoded.length > 0 ? 1 : 0;
