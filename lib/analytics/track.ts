"use client";

import type { EventType } from "./ingest";

/**
 * The browser half of event capture.
 *
 * ── Batched, because a request per click is not acceptable ───────────────
 *
 * Somebody browsing a category page produces a dozen events in a few seconds.
 * Sending each one immediately would put a dozen requests in front of the ones
 * that matter — the images, the add-to-cart — on connections where that is the
 * difference between a sale and a bounce. Events queue and flush on a timer, or
 * when the page goes away, whichever comes first.
 *
 * ── Why sendBeacon on the way out ────────────────────────────────────────
 *
 * The last events of a visit are the interesting ones: the thing they looked at
 * before leaving, the button they pressed and then closed the tab. A normal
 * fetch is cancelled when the document unloads, so those would be exactly the
 * events that never arrive. `sendBeacon` hands the payload to the browser to
 * deliver after the page is gone.
 *
 * `visibilitychange` rather than `unload`: mobile browsers routinely discard a
 * backgrounded tab without ever firing unload, so an unload-only flush loses
 * every phone session. This is the pattern the Page Lifecycle API documents.
 *
 * ── It never throws ──────────────────────────────────────────────────────
 *
 * Every entry point swallows its own errors. Analytics failing must not break a
 * checkout, and a tracking call sitting in an event handler is one `throw` away
 * from doing exactly that.
 */

type QueuedEvent = {
  type: EventType;
  storeId?: string;
  productId?: string;
  variantId?: string;
  path?: string;
  label?: string;
  meta?: Record<string, unknown>;
};

const ENDPOINT = "/api/events";
/** Long enough to collect a burst, short enough to survive a fast exit. */
const FLUSH_MS = 4000;
/** Matches the server's cap; a longer batch would be truncated anyway. */
const MAX_QUEUE = 40;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/** Records an event. Fire and forget — this never throws and never awaits. */
export function track(event: QueuedEvent): void {
  try {
    if (typeof window === "undefined") return;

    queue.push({
      ...event,
      path: event.path ?? window.location.pathname,
    });

    listen();

    // A full queue goes now rather than waiting for the timer, so a burst
    // cannot silently drop its own tail.
    if (queue.length >= MAX_QUEUE) {
      flush();
      return;
    }

    if (timer === null) {
      timer = setTimeout(flush, FLUSH_MS);
    }
  } catch {
    // Deliberately silent. See the note at the top.
  }
}

/** Sends whatever is queued. Safe to call at any time, including with nothing. */
export function flush(): void {
  try {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;

    const body = JSON.stringify({ events: queue });
    queue = [];

    /*
      Beacon first, and not only when leaving. It is fire-and-forget by
      definition, cannot be cancelled by a navigation that starts a moment
      later, and does not compete with page requests for a connection.
      `fetch` with keepalive is the fallback for browsers without it.
    */
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Nothing to do and nobody to tell.
    });
  } catch {
    // Deliberately silent.
  }
}

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;

  // `hidden` covers closing, switching tab, and a phone locking — the last of
  // which never fires unload at all.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // Belt and braces for desktop browsers that do fire it.
  window.addEventListener("pagehide", flush);
}

/**
 * Click tracking, opt-in per element.
 *
 * Attach `data-track="some label"` to anything worth counting and it is
 * counted; everything else is ignored. A global click listener that records
 * every element in the document produces a table nobody can read and a bill
 * somebody pays — "every button" is only useful if somebody chose which
 * buttons.
 *
 * Delegated from the document, so elements rendered later are covered without
 * anything re-binding.
 */
export function trackClicks(): () => void {
  if (typeof document === "undefined") return () => {};

  const onClick = (event: MouseEvent) => {
    try {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const tracked = target.closest<HTMLElement>("[data-track]");
      if (!tracked) return;

      track({
        type: "ui_click",
        label: tracked.dataset.track?.slice(0, 120),
        productId: tracked.dataset.trackProduct,
        storeId: tracked.dataset.trackStore,
      });
    } catch {
      // A tracking failure must never stop the click it is observing.
    }
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  return () =>
    document.removeEventListener("click", onClick, { capture: true });
}
