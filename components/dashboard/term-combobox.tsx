"use client";

import { Check, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  proposeTermAction,
  searchTermsAction,
} from "@/lib/actions/catalog-terms";
import type { SimilarTerm, Term, TermKind } from "@/lib/catalog/terms";
import { cn } from "@/lib/utils";

/**
 * Search-then-propose.
 *
 * The order matters and is the whole point: you cannot type a new brand until
 * you have seen what already exists. Proposing is the fallback, not the
 * default, and near-matches are surfaced before the button is reachable — the
 * unique slug stops "Samsung" twice, but only this stops "Samsng".
 *
 * Plain by design. AGENTS.md puts the design effort on the storefront; this
 * needs to be dense and fast.
 */

const LABELS: Record<TermKind, { singular: string; plural: string }> = {
  brand: { singular: "brand", plural: "brands" },
  tag: { singular: "tag", plural: "tags" },
};

export function TermCombobox({
  kind,
  storeId,
  value,
  onChange,
  disabled,
}: {
  kind: TermKind;
  storeId: string;
  value: Term | null;
  onChange: (term: Term | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Term[]>([]);
  const [similar, setSimilar] = useState<SimilarTerm[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [proposing, startProposing] = useTransition();
  const [activeIndex, setActiveIndex] = useState(-1);

  const listId = useId();
  const inputId = useId();
  const label = LABELS[kind];

  // Debounced. Every keystroke firing a trigram scan across the brand table
  // would be a lot of database work to render text nobody has read yet.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setMatches([]);
      setSimilar([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const result = await searchTermsAction({
          kind,
          storeId,
          query: trimmed,
        });
        // A slow response for an earlier query must not overwrite a newer one.
        if (cancelled) return;
        setMatches(result.matches);
        setSimilar(result.similar);
        setActiveIndex(-1);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind, storeId]);

  function select(term: Term) {
    onChange(term);
    setQuery("");
    setMatches([]);
    setSimilar([]);
    setNotice(null);
  }

  function propose() {
    const name = query.trim();
    if (name.length === 0) return;

    startProposing(async () => {
      const result = await proposeTermAction({ kind, storeId, name });

      if (result.term) {
        select(result.term);
        // "existing" and "resolved" both mean a duplicate was prevented. Say
        // so, rather than silently swapping what the seller typed.
        if (result.status !== "created") {
          setNotice({ tone: "info", text: result.message ?? "" });
        }
        return;
      }

      setNotice({
        tone: result.status === "rejected" ? "warning" : "error",
        text: result.message ?? "Could not add that.",
      });
    });
  }

  const exactMatch = matches.some(
    (m) => m.name.toLowerCase() === query.trim().toLowerCase(),
  );
  const canPropose = query.trim().length > 0 && !exactMatch && !searching;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(matches[activeIndex]);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={value.status === "approved" ? "neutral" : "muted"}>
          {value.name}
          {value.status === "pending" ? " · pending review" : ""}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${value.name}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          placeholder={`Search ${label.plural}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {searching ? (
          <Loader2
            className="-translate-y-1/2 absolute top-1/2 right-4 size-4 animate-spin text-tertiary-text"
            aria-hidden
          />
        ) : null}
      </div>

      {/*
        Divs rather than ul/li, and no nested button.

        An ARIA option must not contain its own interactive element — a button
        inside role="option" gives screen readers two conflicting things to
        announce and breaks the activedescendant model. Focus stays on the
        input throughout; the input's arrow-key handler moves activeIndex and
        aria-activedescendant points at the highlighted row, which is how a
        combobox is supposed to work.
      */}
      {matches.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          aria-label={`Matching ${label.plural}`}
          className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-border bg-surface-1"
        >
          {matches.map((term, index) => (
            <div
              key={term.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              onClick={() => select(term)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(term);
                }
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                index === activeIndex && "bg-surface-2",
              )}
            >
              <span>{term.name}</span>
              <Check className="size-3.5 text-tertiary-text" aria-hidden />
            </div>
          ))}
        </div>
      ) : null}

      {/*
        The near-match warning. Shown before the propose button so it is read
        first — a seller who scans downward hits the suggestion before the
        action that would create the duplicate.
      */}
      {similar.length > 0 && canPropose ? (
        <output className="flex flex-col gap-2 rounded-md border border-border bg-accent-muted p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-accent-text">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Did you mean one of these?
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {similar.map((term) => (
              <li key={term.id}>
                <button
                  type="button"
                  onClick={() => select(term)}
                  className="rounded-full border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-2"
                >
                  {term.name}
                  {term.status === "pending" ? " · pending" : ""}
                </button>
              </li>
            ))}
          </ul>
        </output>
      ) : null}

      {canPropose ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={proposing}
          onClick={propose}
          className="self-start"
        >
          {proposing ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Plus aria-hidden />
          )}
          Add "{query.trim()}" as a new {label.singular}
        </Button>
      ) : null}

      {notice ? (
        <output
          className={cn(
            "text-sm",
            notice.tone === "error" && "text-critical",
            notice.tone === "warning" && "text-warning",
            notice.tone === "info" && "text-secondary-text",
          )}
        >
          {notice.text}
        </output>
      ) : null}
    </div>
  );
}
