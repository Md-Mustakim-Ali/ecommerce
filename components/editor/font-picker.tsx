"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FONT_CATALOGUE,
  FONT_FAMILY_VARS,
  type FontFamily,
} from "@/lib/rich-text/schema";

/**
 * Picking a typeface.
 *
 * Every option is rendered in the face it names. A list of font names set in
 * the interface font tells the seller nothing — the whole decision is what the
 * letters look like, and they would otherwise have to apply each one to find
 * out. That is also why the preview text is a real word rather than "Aa": the
 * shape of a lowercase g or a two-storey a is most of what separates these.
 *
 * Grouped and searchable because fifteen is past the point where a flat list
 * scans. The search matches the family name and the category, so typing
 * "serif" finds the serif group and typing "mono" finds the monospace.
 */

export function FontPicker({
  value,
  onChange,
}: {
  value: FontFamily;
  onChange: (family: FontFamily) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const active = FONT_CATALOGUE.find((font) => font.id === value);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = FONT_CATALOGUE.filter(
      (font) =>
        !needle ||
        font.label.toLowerCase().includes(needle) ||
        font.category.toLowerCase().includes(needle),
    );

    const byCategory = new Map<string, typeof matches>();
    for (const font of matches) {
      byCategory.set(font.category, [
        ...(byCategory.get(font.category) ?? []),
        font,
      ]);
    }
    return [...byCategory.entries()];
  }, [query]);

  useEffect(() => {
    if (!open) return;

    // Focus the search on open, so typing filters immediately rather than
    // going nowhere.
    searchInput.current?.focus();

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

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        aria-label="Font"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Font"
        className="flex h-8 min-w-28 items-center justify-between gap-1.5 rounded px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
      >
        <span
          className="truncate"
          style={{ fontFamily: FONT_FAMILY_VARS[value] }}
        >
          {active?.label ?? "Font"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      </button>

      {open ? (
        <div className="motion-popup absolute top-full left-0 z-50 mt-2 w-64 rounded-xl bg-popover p-2 text-popover-foreground shadow-e2 ring-1 ring-foreground/10">
          <div className="flex items-center gap-2 rounded-control border border-border-strong bg-surface-sunken px-3">
            <Search className="h-3.5 w-3.5 text-tertiary-text" aria-hidden />
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search fonts"
              aria-label="Search fonts"
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
          </div>

          <div
            role="listbox"
            aria-label="Font"
            className="mt-2 max-h-64 overflow-y-auto"
          >
            {groups.length === 0 ? (
              <p className="px-2 py-4 text-center text-muted-foreground text-xs">
                No font matches “{query}”.
              </p>
            ) : null}

            {groups.map(([category, fonts]) => (
              <div key={category}>
                <p className="px-2 pt-2 pb-1 font-medium text-[0.7rem] text-tertiary-text uppercase tracking-wide">
                  {category}
                </p>
                {fonts.map((font) => {
                  const selected = font.id === value;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(font.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        selected
                          ? "bg-accent-muted text-accent-text"
                          : "hover:bg-surface-2"
                      }`}
                    >
                      <span className="min-w-0">
                        {/* The name, set in the face it names. */}
                        <span
                          className="block truncate text-sm"
                          style={{ fontFamily: FONT_FAMILY_VARS[font.id] }}
                        >
                          {font.label}
                        </span>
                        <span
                          className="block truncate text-tertiary-text text-xs"
                          style={{ fontFamily: FONT_FAMILY_VARS[font.id] }}
                        >
                          Handwoven glass jar 38
                        </span>
                      </span>
                      {selected ? (
                        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
