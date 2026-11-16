"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HEX_COLOR } from "@/lib/rich-text/schema";

/**
 * Choosing a colour the design system does not offer.
 *
 * One colour by default. The seller picks the colour they mean and the picker
 * makes it work in both themes — that is the whole job, and asking for two
 * values up front turned a simple wish ("I want my brand blue") into a colour
 * theory exercise.
 *
 * The adjustment only happens when it has to. A mid-tone that already reads on
 * both backgrounds is left exactly as chosen; only a colour that would vanish
 * against the dark page gets lifted, and the preview shows both results side
 * by side rather than asking the seller to imagine the one they cannot see.
 */

/** Relative luminance, per WCAG. 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (part: string) => {
    const srgb = Number.parseInt(part, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(value.slice(0, 2)) +
    0.7152 * channel(value.slice(2, 4)) +
    0.0722 * channel(value.slice(4, 6))
  );
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

// Approximations of the storefront's page background in each theme. Exact
// values are not needed — these drive a preview and a nudge, not rendering.
export const LIGHT_BACKGROUND = "#fbfaf9";
export const DARK_BACKGROUND = "#191817";

/** Below this, body text is hard to read. WCAG AA for normal text is 4.5. */
export const MIN_CONTRAST = 4.5;

/**
 * A starting palette, so the common case is one click rather than a hex code.
 *
 * Chosen at a lightness that reads on the light page, since that is the one
 * the seller is looking at while choosing. Each still passes through the same
 * dark-mode adjustment as a hand-typed value — a preset is a shortcut, not an
 * exemption.
 */
const PRESETS = [
  "#1a56db",
  "#0e7490",
  "#047857",
  "#4d7c0f",
  "#a16207",
  "#c2410c",
  "#b91c1c",
  "#be185d",
  "#7e22ce",
  "#4338ca",
  "#57534e",
  "#1c1917",
] as const;

function mix(hex: string, towards: number, amount: number): string {
  const value = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) =>
    Number.parseInt(value.slice(i, i + 2), 16),
  );
  const moved = parts.map((c) => Math.round(c + (towards - c) * amount));
  return `#${moved.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The same colour, made readable on a dark background.
 *
 * Returns the input untouched when it already passes — most colours a seller
 * would actually choose do, and changing them anyway would be the picker
 * overriding a decision it was not asked to make. Only when the colour would
 * genuinely disappear does it get lifted toward white, in small steps,
 * stopping at the first value that clears the threshold so the result stays as
 * close to the original as legibility allows.
 */
export function adaptForDark(light: string): string {
  if (!HEX_COLOR.test(light)) return light;
  if (contrastRatio(light, DARK_BACKGROUND) >= MIN_CONTRAST) return light;

  for (let amount = 0.1; amount <= 1; amount += 0.1) {
    const candidate = mix(light, 255, amount);
    if (contrastRatio(candidate, DARK_BACKGROUND) >= MIN_CONTRAST) {
      return candidate;
    }
  }
  return "#ffffff";
}

export function CustomColorPicker({
  mode = "text",
  tokens,
  tokenVars,
  activeToken,
  initialLight,
  initialDark,
  onApplyToken,
  onApply,
  onClear,
  onCancel,
}: {
  /** Text colour, or the background behind it. */
  mode?: "text" | "highlight";
  /** The named options for whichever mark this is driving. */
  tokens: readonly string[];
  tokenVars: Record<string, string>;
  /** The named colour currently under the cursor, if any. */
  activeToken?: string | null;
  initialLight?: string | null;
  initialDark?: string | null;
  onApplyToken: (token: string) => void;
  onApply: (light: string, dark: string) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [light, setLight] = useState(initialLight ?? PRESETS[0]);
  // Split only when the existing pair genuinely differs from what the
  // automatic adjustment would have produced — otherwise reopening a colour
  // the seller never split would present as though they had.
  const [split, setSplit] = useState(
    Boolean(
      initialLight && initialDark && initialDark !== adaptForDark(initialLight),
    ),
  );
  const [dark, setDark] = useState(
    initialDark ?? adaptForDark(initialLight ?? PRESETS[0]),
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // What actually gets stored for dark: the seller's own when they split it,
  // the adapted one otherwise.
  const effectiveDark = split ? dark : adaptForDark(light);
  const adjusted = !split && HEX_COLOR.test(light) && effectiveDark !== light;
  const valid = HEX_COLOR.test(light) && HEX_COLOR.test(effectiveDark);

  return (
    <div className="motion-popup absolute top-full left-0 z-50 mt-2 w-[19rem] rounded-xl bg-popover p-4 text-popover-foreground shadow-e2 ring-1 ring-foreground/10">
      <p className="font-medium text-sm">
        {mode === "text" ? "Text colour" : "Highlight"}
      </p>
      <p className="mt-0.5 text-tertiary-text text-xs">
        Readable in both themes, whichever you pick.
      </p>

      {/*
        The theme's own colours first, and they are not the same kind of thing
        as the swatches below: these store a meaning rather than a value, so
        they follow the store's palette if it ever changes and carry their own
        dark variant. A custom colour is frozen at whatever was picked.
      */}
      <p className="mt-3 font-medium text-tertiary-text text-xs">Theme</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {tokens.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => onApplyToken(token)}
            aria-label={`${token} ${mode === "text" ? "text" : "highlight"}`}
            aria-pressed={activeToken === token}
            title={token}
            className={`h-8 flex-1 rounded-md ring-offset-2 ring-offset-popover transition-transform hover:scale-105 ${
              activeToken === token
                ? "ring-2 ring-accent"
                : "ring-1 ring-foreground/10"
            }`}
            style={{ backgroundColor: tokenVars[token] }}
          />
        ))}
      </div>

      <p className="mt-3 font-medium text-tertiary-text text-xs">Custom</p>
      <div className="mt-1.5 grid grid-cols-6 gap-1.5">
        {PRESETS.map((preset) => {
          const active = light.toLowerCase() === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => setLight(preset)}
              aria-label={`Preset ${preset}`}
              aria-pressed={active}
              className={`h-8 rounded-md ring-offset-2 ring-offset-popover transition-transform hover:scale-105 ${
                active ? "ring-2 ring-accent" : "ring-1 ring-foreground/10"
              }`}
              style={{ backgroundColor: preset }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label
          className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-control shadow-well ring-1 ring-foreground/15"
          style={{ backgroundColor: HEX_COLOR.test(light) ? light : undefined }}
        >
          <span className="sr-only">{split ? "Light mode" : "Colour"}</span>
          <input
            id="custom-light"
            type="color"
            value={HEX_COLOR.test(light) ? light : "#000000"}
            onChange={(event) => setLight(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <input
          type="text"
          value={light}
          onChange={(event) => setLight(event.target.value)}
          spellCheck={false}
          aria-label={split ? "Light mode hex value" : "Colour hex value"}
          className="h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface-sunken px-4 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </div>

      {/* Both results at once. The seller cannot see the theme they are not
          in, so showing it is the only way the choice is informed. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Preview
          mode={mode}
          label="Light"
          page={LIGHT_BACKGROUND}
          colour={light}
          note={null}
        />
        <Preview
          mode={mode}
          label="Dark"
          page={DARK_BACKGROUND}
          colour={effectiveDark}
          note={adjusted ? "adjusted" : null}
        />
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
        <input
          type="checkbox"
          checked={split}
          onChange={(event) => {
            const next = event.target.checked;
            setSplit(next);
            // Seeded with what was already in use, so turning the option on
            // never changes the colour by itself.
            if (next) setDark(adaptForDark(light));
          }}
          className="size-4 accent-[var(--color-accent)]"
        />
        <span className="text-secondary-text">
          Pick the dark mode colour myself
        </span>
      </label>

      {split ? (
        <div className="mt-2 flex items-center gap-2">
          <label
            className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-control shadow-well ring-1 ring-foreground/15"
            style={{ backgroundColor: HEX_COLOR.test(dark) ? dark : undefined }}
          >
            <span className="sr-only">Dark mode</span>
            <input
              id="custom-dark"
              type="color"
              value={HEX_COLOR.test(dark) ? dark : "#000000"}
              onChange={(event) => setDark(event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            type="text"
            value={dark}
            onChange={(event) => setDark(event.target.value)}
            spellCheck={false}
            aria-label="Dark mode hex value"
            className="h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface-sunken px-4 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </div>
      ) : null}

      <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-2 rounded-b-xl border-border border-t bg-muted/50 p-3">
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!valid}
          onClick={() => onApply(light, effectiveDark)}
        >
          <Check aria-hidden />
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * The colour on the background it will actually sit on.
 *
 * A swatch floating on the panel proves nothing about legibility, which is the
 * only question worth answering here. For a highlight the question flips: what
 * matters is whether ordinary body text stays readable ON the colour, so the
 * preview paints it that way round.
 */
function Preview({
  mode,
  label,
  page,
  colour,
  note,
}: {
  mode: "text" | "highlight";
  label: string;
  page: string;
  colour: string;
  note: string | null;
}) {
  const bodyText = page === LIGHT_BACKGROUND ? "#1c1917" : "#e7e5e4";
  const valid = HEX_COLOR.test(colour);

  // Text on the page for a colour; body text on the colour for a highlight.
  const readable = valid
    ? mode === "text"
      ? contrastRatio(colour, page) >= MIN_CONTRAST
      : contrastRatio(bodyText, colour) >= MIN_CONTRAST
    : true;

  return (
    <div
      className="flex flex-col gap-1 rounded-lg p-2.5 ring-1 ring-foreground/10"
      style={{ backgroundColor: page }}
    >
      <span
        className="font-medium text-[0.7rem] uppercase tracking-wide opacity-60"
        style={{ color: bodyText }}
      >
        {label}
        {note ? ` · ${note}` : ""}
      </span>
      <span
        className="w-fit rounded px-1 font-medium text-sm"
        style={
          mode === "text"
            ? { color: colour }
            : { backgroundColor: colour, color: bodyText }
        }
      >
        Aa Sample
      </span>
      {!readable ? (
        <span className="text-[0.7rem] text-critical">Hard to read</span>
      ) : null}
    </div>
  );
}
