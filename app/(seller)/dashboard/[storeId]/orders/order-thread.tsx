"use client";

import { Loader2, Lock, Send, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deleteOrderNoteAction,
  listNotesForStore,
  markThreadReadAction,
  type OrderNote,
  postOrderNoteAction,
} from "@/lib/actions/order-notes";

/**
 * Notes and buyer messages on one order, in date order.
 *
 * Internal notes and buyer messages share the thread because they describe the
 * same order and reading them apart loses the sequence — "buyer asked for a
 * different size", then internally "we have it in stock", then the reply, is
 * one story. What separates them is how they look: an internal note is visibly
 * marked, in a muted block, so nobody types one thinking the buyer will read it
 * or the other way round.
 *
 * Loaded on expand rather than with the page. Forty orders' worth of threads
 * fetched to render nothing is forty queries wasted.
 */
export function OrderThread({
  storeId,
  subOrderId,
  buyerContact,
  buyerHasEmail,
  permissions,
}: {
  storeId: string;
  subOrderId: string;
  /** Whichever contact the order carries — an address or a number. */
  buyerContact: string;
  /**
   * Whether a message actually leaves as mail.
   *
   * A buyer who checked out with a number alone gets nothing in an inbox: the
   * message appears on their order page and that is all. Telling a seller "goes
   * to 01712345678" when no SMS gateway exists would be a promise the platform
   * does not keep, and sellers chase orders on the strength of it.
   */
  buyerHasEmail: boolean;
  permissions: { note: boolean; contact: boolean };
}) {
  const [notes, setNotes] = useState<OrderNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [toBuyer, setToBuyer] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    listNotesForStore(storeId, subOrderId)
      .then((rows) => {
        if (!live) return;
        setNotes(rows);
        // Opening the thread is reading it. Only marks the buyer's messages.
        if (rows.some((n) => n.authorRole === "buyer" && !n.readAt)) {
          void markThreadReadAction({ subOrderId, as: "staff" });
        }
      })
      .catch(() => {
        if (live) setError("Could not load the thread.");
      });
    return () => {
      live = false;
    };
  }, [storeId, subOrderId]);

  // A role with neither permission gets the thread read-only, which is the
  // right default: seeing why an order was held is part of fulfilling it.
  const canWrite = permissions.note || permissions.contact;
  const visibility = toBuyer && permissions.contact ? "buyer" : "internal";

  function refresh() {
    listNotesForStore(storeId, subOrderId)
      .then(setNotes)
      .catch(() => {});
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm">Notes and messages</h4>
        {notes ? (
          <span className="text-tertiary-text text-xs">
            {notes.length === 0
              ? "Nothing yet"
              : `${notes.length} ${notes.length === 1 ? "entry" : "entries"}`}
          </span>
        ) : null}
      </div>

      {notes === null && !error ? (
        <p className="text-tertiary-text text-xs">Loading…</p>
      ) : null}

      {notes && notes.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className={`rounded-md border px-3 py-2 text-sm ${
                note.visibility === "internal"
                  ? "border-border border-dashed bg-surface-1"
                  : note.authorRole === "buyer"
                    ? "border-border bg-surface-1"
                    : "border-accent/30 bg-accent-muted/30"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-medium text-xs">{note.authorName}</span>
                {note.visibility === "internal" ? (
                  <Badge variant="outline" className="gap-1">
                    <Lock aria-hidden className="size-3" />
                    Internal
                  </Badge>
                ) : note.authorRole === "buyer" ? (
                  <Badge variant="neutral">Buyer</Badge>
                ) : (
                  <Badge variant="muted">Sent to buyer</Badge>
                )}
                <span className="text-tertiary-text text-xs">
                  {new Date(note.createdAt).toLocaleString()}
                </span>

                {note.visibility === "internal" &&
                note.mine &&
                permissions.note ? (
                  <button
                    type="button"
                    className="ml-auto text-tertiary-text hover:text-critical"
                    aria-label="Remove note"
                    onClick={() => {
                      startTransition(async () => {
                        const result = await deleteOrderNoteAction({
                          storeId,
                          noteId: note.id,
                        });
                        if (!result.ok) {
                          setError(result.message);
                          return;
                        }
                        refresh();
                      });
                    }}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-secondary-text">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-critical text-xs">
          {error}
        </p>
      ) : null}

      {canWrite ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await postOrderNoteAction({
                storeId,
                subOrderId,
                body,
                visibility,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setBody("");
              refresh();
            });
          }}
        >
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={4000}
            required
            placeholder={
              visibility === "buyer"
                ? `Message ${buyerContact}…`
                : "Internal note — the buyer never sees this."
            }
            className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none placeholder:text-tertiary-text focus-visible:border-accent"
          />

          <div className="flex flex-wrap items-center gap-3">
            {permissions.contact && permissions.note ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={toBuyer}
                  onChange={(event) => setToBuyer(event.target.checked)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                Send to the buyer
              </label>
            ) : null}

            {/*
              When a role holds only one of the two, say which it is rather
              than showing a toggle that does nothing.
            */}
            {permissions.contact && !permissions.note ? (
              <span className="text-tertiary-text text-xs">
                {buyerHasEmail
                  ? `Goes to ${buyerContact}.`
                  : "Shows on the buyer's order page. They gave no email address, so nothing is sent."}
              </span>
            ) : null}
            {permissions.note && !permissions.contact ? (
              <span className="text-tertiary-text text-xs">
                Internal only — your role cannot message buyers.
              </span>
            ) : null}

            <Button
              type="submit"
              size="sm"
              variant={visibility === "buyer" ? "default" : "outline"}
              disabled={pending || body.trim().length === 0}
              className="ml-auto"
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : visibility === "buyer" ? (
                <Send aria-hidden />
              ) : null}
              {visibility === "buyer" ? "Send" : "Save note"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-tertiary-text text-xs">
          Your role can read this thread but not add to it.
        </p>
      )}
    </div>
  );
}
