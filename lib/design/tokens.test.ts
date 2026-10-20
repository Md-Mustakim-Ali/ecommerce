import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, isOutOfSrgbGamut, toHex } from "./color";

/**
 * Reads the real token layer rather than a copy of it. If someone edits a
 * colour in app/globals.css and drops below the accessibility floor, this
 * fails — which is the only way "contrast is checked" stays true over time.
 */
const CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

type Pair = { light: string; dark: string };

/**
 * Isolates a single rule block by selector.
 *
 * Necessary because `.theme-admin` redeclares the same token names as `:root`.
 * Scanning the whole file would let the admin values silently shadow the
 * storefront ones and this suite would then be testing the wrong palette.
 */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1)
    throw new Error(`No \`${selector} {\` block in globals.css`);

  let depth = 0;
  for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) return CSS.slice(start, i);
    }
  }
  throw new Error(`Unbalanced braces after \`${selector}\``);
}

/** Extracts `--name: light-dark(<light>, <dark>);` from one rule block. */
function tokens(selector: string): Map<string, Pair> {
  const source = block(selector);
  const found = new Map<string, Pair>();
  const re =
    /--([a-z0-9-]+):\s*light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)/gi;

  let match = re.exec(source);
  while (match !== null) {
    found.set(match[1], { light: match[2], dark: match[3] });
    match = re.exec(source);
  }
  return found;
}

const T = tokens(":root");
const ADMIN = tokens(".theme-admin");

function pairFrom(scope: Map<string, Pair>, name: string): Pair {
  const value = scope.get(name);
  if (!value) {
    throw new Error(
      `Token --${name} not found. If it was renamed, update this test.`,
    );
  }
  return value;
}

const pair = (name: string) => pairFrom(T, name);

/** Both themes of a foreground token against both themes of a background. */
function ratiosIn(
  scope: Map<string, Pair>,
  fg: string,
  bg: string,
): { light: number; dark: number } {
  const f = pairFrom(scope, fg);
  const b = pairFrom(scope, bg);
  return {
    light: contrastRatio(f.light, b.light),
    dark: contrastRatio(f.dark, b.dark),
  };
}

const ratios = (fg: string, bg: string) => ratiosIn(T, fg, bg);

describe("token layer", () => {
  it("parses light-dark() pairs out of globals.css", () => {
    // Guards against the regex silently matching nothing after a refactor,
    // which would make every assertion below vacuously pass.
    expect(T.size).toBeGreaterThan(15);
  });

  it("declares every colour token in both themes", () => {
    for (const [name, { light, dark }] of T) {
      expect(light, `--${name} light`).toMatch(/^oklch\(/);
      expect(dark, `--${name} dark`).toMatch(/^oklch\(/);
    }
  });
});

describe("contrast — WCAG AA body text (4.5:1)", () => {
  const surfaces = ["surface-0", "surface-1", "surface-2", "surface-3"];

  for (const surface of surfaces) {
    it(`--text-primary on --${surface}`, () => {
      const { light, dark } = ratios("text-primary", surface);
      expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`--text-secondary on --${surface}`, () => {
      const { light, dark } = ratios("text-secondary", surface);
      expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("--accent-text on --surface-0", () => {
    const { light, dark } = ratios("accent-text", "surface-0");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("--text-on-accent on the --accent fill", () => {
    // The accent is a fill that always carries dark text. If this fails the
    // accent is too dark to use as a button background.
    const { light, dark } = ratios("text-on-accent", "accent");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("--critical on --surface-0", () => {
    const { light, dark } = ratios("critical", "surface-0");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("--positive on --surface-0", () => {
    const { light, dark } = ratios("positive", "surface-0");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrast — WCAG AA non-text (3:1)", () => {
  it("--text-tertiary on --surface-0 clears the large-text floor", () => {
    // Tertiary is for de-emphasised metadata at >=18.66px bold or 24px, plus
    // disabled states. It is deliberately not held to 4.5:1.
    const { light, dark } = ratios("text-tertiary", "surface-0");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it("--ring is visible against every surface", () => {
    // Focus rings are a non-text UI component: 3:1 per WCAG 1.4.11. This is
    // the keyboard accessibility floor, so it is checked on all surfaces.
    for (const surface of [
      "surface-0",
      "surface-1",
      "surface-2",
      "surface-3",
    ]) {
      const { light, dark } = ratios("ring", surface);
      expect(
        light,
        `${surface} light: ${light.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        dark,
        `${surface} dark: ${dark.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("--border-strong separates surfaces well enough to read as a control", () => {
    const { light, dark } = ratios("border-strong", "surface-1");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

describe("gamut", () => {
  it("every colour token is representable in sRGB", () => {
    // An out-of-gamut oklch() gets clipped by the browser, which silently
    // changes both the hue and the contrast ratio this suite just verified.
    //
    // Collected rather than asserted per token: failing on the first one hides
    // the rest, which turns fixing the palette into a guessing loop.
    const offenders: string[] = [];
    for (const [name, { light, dark }] of T) {
      if (isOutOfSrgbGamut(light)) offenders.push(`--${name} light: ${light}`);
      if (isOutOfSrgbGamut(dark)) offenders.push(`--${name} dark: ${dark}`);
    }
    expect(
      offenders,
      `out of sRGB gamut:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("browser theme-color", () => {
  it("matches --surface-0 in both themes", () => {
    // The <meta name="theme-color"> values in app/layout.tsx are the one place
    // a literal hex is unavoidable: the browser paints its chrome with them
    // before any CSS is parsed, so a var() is not an option. Pinning them here
    // means the browser chrome cannot silently drift away from the page it
    // sits above.
    const layout = readFileSync(
      fileURLToPath(new URL("../../app/layout.tsx", import.meta.url)),
      "utf8",
    );

    const surface0 = pair("surface-0");
    const declared = [...layout.matchAll(/color:\s*"(#[0-9a-f]{6})"/gi)].map(
      (m) => m[1].toLowerCase(),
    );

    expect(
      declared,
      `app/layout.tsx declares ${declared.join(", ")} but --surface-0 is ` +
        `${toHex(surface0.light)} (light) and ${toHex(surface0.dark)} (dark)`,
    ).toEqual([toHex(surface0.light), toHex(surface0.dark)]);
  });
});

describe("admin scope", () => {
  it("overrides the storefront palette rather than inheriting it", () => {
    // If these ever match, the admin panel has silently picked up the warm
    // storefront accent, which is the opposite of the brief.
    expect(ADMIN.get("accent")?.light).not.toBe(T.get("accent")?.light);
    expect(ADMIN.size).toBeGreaterThan(10);
  });

  it("is monochrome — every admin colour has zero chroma", () => {
    // Status colours are inherited from :root and stay coloured on purpose;
    // only the tokens the admin scope redeclares are held to monochrome.
    const coloured: string[] = [];
    for (const [name, { light, dark }] of ADMIN) {
      for (const [theme, value] of [
        ["light", light],
        ["dark", dark],
      ] as const) {
        const chroma = Number.parseFloat(
          value.match(/oklch\(\s*[\d.]+\s+([\d.]+)/)?.[1] ?? "0",
        );
        if (chroma > 0.001) coloured.push(`--${name} ${theme}: ${value}`);
      }
    }
    expect(coloured, `not monochrome:\n  ${coloured.join("\n  ")}`).toEqual([]);
  });

  it("still meets AA for body text in both themes", () => {
    // Internal tooling is not an excuse to drop the accessibility floor.
    for (const surface of ["surface-0", "surface-1", "surface-2"]) {
      const { light, dark } = ratiosIn(ADMIN, "text-primary", surface);
      expect(
        light,
        `${surface} light: ${light.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        dark,
        `${surface} dark: ${dark.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    const secondary = ratiosIn(ADMIN, "text-secondary", "surface-0");
    expect(secondary.light).toBeGreaterThanOrEqual(4.5);
    expect(secondary.dark).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the primary button legible", () => {
    const { light, dark } = ratiosIn(ADMIN, "text-on-accent", "accent");
    expect(light, `light: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(dark, `dark: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("dark theme is designed, not inverted", () => {
  it("surface elevation increases in lightness in dark mode", () => {
    // In light mode elevation moves toward white and gains shadow. In dark
    // mode shadows do not read, so elevation has to be carried by lightness.
    // If someone "fixes" dark mode by inverting the light ramp, this fails.
    const order = ["surface-0", "surface-1", "surface-2", "surface-3"];
    const lightness = order.map((name) => {
      const dark = pair(name).dark;
      return Number.parseFloat(dark.match(/oklch\(\s*([\d.]+)/)?.[1] ?? "0");
    });

    for (let i = 1; i < lightness.length; i++) {
      expect(
        lightness[i],
        `--${order[i]} (${lightness[i]}) must be lighter than --${order[i - 1]} (${lightness[i - 1]})`,
      ).toBeGreaterThan(lightness[i - 1]);
    }
  });

  it("sunken sits below surface-0 in both themes", () => {
    const lightnessOf = (value: string) =>
      Number.parseFloat(value.match(/oklch\(\s*([\d.]+)/)?.[1] ?? "0");

    expect(lightnessOf(pair("surface-sunken").light)).toBeLessThan(
      lightnessOf(pair("surface-0").light),
    );
    expect(lightnessOf(pair("surface-sunken").dark)).toBeLessThan(
      lightnessOf(pair("surface-0").dark),
    );
  });
});
