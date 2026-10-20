/**
 * Minimal OKLCH -> sRGB -> WCAG contrast, used by the token contrast test.
 *
 * This exists so the palette in app/globals.css is verified rather than
 * asserted. AGENTS.md treats contrast as a floor, and a floor that nothing
 * checks is a floor that eventually gives way.
 */

export type Rgb = { r: number; g: number; b: number };

/** Parses `oklch(L C H)` and `oklch(L C H / A)`. L may be a percentage. */
export function parseOklch(input: string): {
  l: number;
  c: number;
  h: number;
  alpha: number;
} {
  const match = input.trim().match(/^oklch\(\s*([^)]+)\)$/i);
  if (!match) throw new Error(`Not an oklch() color: ${input}`);

  const [coords, alphaPart] = match[1].split("/");
  const parts = coords.trim().split(/\s+/);
  if (parts.length < 3) throw new Error(`Expected 3 components in: ${input}`);

  const num = (token: string) =>
    token.endsWith("%")
      ? Number.parseFloat(token) / 100
      : Number.parseFloat(token);

  return {
    l: num(parts[0]),
    c: Number.parseFloat(parts[1]),
    h: Number.parseFloat(parts[2]),
    alpha: alphaPart === undefined ? 1 : num(alphaPart.trim()),
  };
}

/** OKLCH -> linear sRGB. Values are not clamped; out-of-gamut is detectable. */
function oklchToLinearRgb(l: number, c: number, h: number): Rgb {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lCbrt = l + 0.3963377774 * a + 0.2158037573 * b;
  const mCbrt = l - 0.1055613458 * a - 0.0638541728 * b;
  const sCbrt = l - 0.0894841775 * a - 1.291485548 * b;

  const lLms = lCbrt ** 3;
  const mLms = mCbrt ** 3;
  const sLms = sCbrt ** 3;

  return {
    r: 4.0767416621 * lLms - 3.3077115913 * mLms + 0.2309699292 * sLms,
    g: -1.2684380046 * lLms + 2.6097574011 * mLms - 0.3413193965 * sLms,
    b: -0.0041960863 * lLms - 0.7034186147 * mLms + 1.707614701 * sLms,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function gammaEncode(v: number): number {
  const c = clamp01(v);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function oklchToSrgb(input: string): Rgb {
  const { l, c, h } = parseOklch(input);
  const linear = oklchToLinearRgb(l, c, h);
  return {
    r: gammaEncode(linear.r),
    g: gammaEncode(linear.g),
    b: gammaEncode(linear.b),
  };
}

/** True when the colour cannot be represented in sRGB and will be clipped. */
export function isOutOfSrgbGamut(input: string, tolerance = 0.001): boolean {
  const { l, c, h } = parseOklch(input);
  const { r, g, b } = oklchToLinearRgb(l, c, h);
  return [r, g, b].some((v) => v < -tolerance || v > 1 + tolerance);
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = clamp01(v);
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(oklchToSrgb(a));
  const lb = relativeLuminance(oklchToSrgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `#rrggbb`. For the few places that cannot take a CSS variable. */
export function toHex(input: string): string {
  const { r, g, b } = oklchToSrgb(input);
  const channel = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Flattens a translucent colour over an opaque backdrop before measuring. */
export function compositeOver(fg: string, bg: string): Rgb {
  const { alpha } = parseOklch(fg);
  const f = oklchToSrgb(fg);
  const b = oklchToSrgb(bg);
  return {
    r: f.r * alpha + b.r * (1 - alpha),
    g: f.g * alpha + b.g * (1 - alpha),
    b: f.b * alpha + b.b * (1 - alpha),
  };
}
