"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BASE_FONT_SIZE,
  FONT_SIZE_PRESETS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "@/lib/rich-text/schema";

/**
 * Text size.
 *
 * A number field with steppers, plus the sizes anyone actually reaches for.
 * The presets are there because "18" is a decision nobody wants to type, and
 * the free field is there because the one time a seller does want 23 there is
 * no reason to refuse.
 *
 * The field is clamped rather than validated: holding the down arrow stops at
 * the minimum instead of going invalid, which is what a stepper is expected to
 * do. An empty field means "no size set", which is different from zero.
 */
export function FontSizePicker({
  value,
  onChange,
  onClear,
}: {
  /** null when the selection carries no size of its own. */
  value: number | null;
  onChange: (size: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value ?? BASE_FONT_SIZE));
  const container = useRef<HTMLDivElement>(null);

  // Follow the cursor: moving into differently-sized text should update the
  // field, but not while the seller is mid-edit in it.
  useEffect(() => {
    setDraft(String(value ?? BASE_FONT_SIZE));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = value ?? BASE_FONT_SIZE;

  function commit(next: number) {
    const clamped = Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, Math.round(next)),
    );
    setDraft(String(clamped));
    onChange(clamped);
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Text size"
        aria-expanded={open}
        title="Text size"
        className="flex h-8 min-w-11 items-center justify-center gap-1 rounded px-2 text-muted-foreground text-xs tabular-nums transition-colors hover:bg-muted hover:text-foreground"
      >
        {value ?? BASE_FONT_SIZE}
      </button>

      {open ? (
        <div className="motion-popup absolute top-full left-0 z-50 mt-2 w-52 rounded-xl bg-popover p-3 text-popover-foreground shadow-e2 ring-1 ring-foreground/10">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => commit(current - 1)}
              aria-label="Smaller"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>

            <input
              type="number"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={draft}
              aria-label="Text size in pixels"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(draft);
                if (Number.isFinite(parsed) && draft.trim() !== "") {
                  commit(parsed);
                } else {
                  setDraft(String(current));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="h-9 w-full min-w-0 rounded-control border border-border-strong bg-surface-sunken px-3 text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />

            <button
              type="button"
              onClick={() => commit(current + 1)}
              aria-label="Larger"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-5 gap-1">
            {FONT_SIZE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  commit(preset);
                  setOpen(false);
                }}
                aria-label={`${preset} pixels`}
                aria-pressed={value === preset}
                className={`h-8 rounded-md text-xs tabular-nums transition-colors ${
                  value === preset
                    ? "bg-accent-muted text-accent-text"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md py-1.5 text-tertiary-text text-xs transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Reset to default
          </button>
        </div>
      ) : null}
    </div>
  );
}
