"use client";

import { Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { replyToStoreAction } from "@/lib/actions/order-notes";
import { formatDateTime } from "@/lib/datetime/format";

export type BuyerMessage = {
  id: string;
  authorRole: "staff" | "buyer";
  authorName: string;
  body: string;
  createdAt: string;
};

/**
 * The buyer's half of an order thread.
 *
 * Only the messages the store chose to send are here — internal notes are
 * excluded in SQL, not by this component, so nothing about the markup can
 * expose them.
 *
 * Shown per store rather than per order, because with three sellers in one
 * cart there are three separate conversations, and merging them would put a
 * reply in front of whoever did not ask.
 */
export function MessageThread({
  subOrderId,
  storeName,
  messages,
}: {
  subOrderId: string;
  storeName: string;
  messages: BuyerMessage[];
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(messages.length > 0);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-secondary-text text-sm underline underline-offset-4 hover:text-primary-text"
      >
        Message {storeName}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-border border-t pt-4">
      <h3 className="font-medium text-sm">Messages with {storeName}</h3>

      {messages.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                message.authorRole === "buyer"
                  ? "self-end bg-surface-3"
                  : "self-start bg-accent-muted/40"
              }`}
            >
              <span className="mb-0.5 block text-tertiary-text text-xs">
                {message.authorRole === "buyer" ? "You" : storeName} ·{" "}
                {formatDateTime(message.createdAt)}
              </span>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-tertiary-text text-sm">
          Ask about this order and the seller will see it alongside your items.
        </p>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await replyToStoreAction({ subOrderId, body });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setBody("");
          });
        }}
      >
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          maxLength={4000}
          required
          placeholder="Ask about delivery, sizing, anything…"
          className="w-full resize-y rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm outline-none placeholder:text-tertiary-text focus-visible:border-accent"
        />
        {error ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          size="sm"
          className="self-start"
          disabled={pending || body.trim().length === 0}
        >
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Send aria-hidden />
          )}
          Send
        </Button>
      </form>
    </div>
  );
}
