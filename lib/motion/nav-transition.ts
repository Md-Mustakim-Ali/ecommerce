/**
 * Runs an App Router navigation inside a view transition.
 *
 * Next 16.3.4 has no `experimental.viewTransition`, and React 19.2.8 ships no
 * `ViewTransition` component in its stable build — both were checked rather
 * than assumed. So the transition is driven here.
 *
 * The awkward part is knowing when the new page has rendered.
 * `startViewTransition` snapshots the old DOM, runs a callback, then snapshots
 * the new DOM once the callback's promise resolves. `router.push` returns
 * immediately, long before React has committed the new route, so the promise
 * has to be resolved from somewhere else — and it cannot be the link that was
 * clicked, because that link unmounts as part of the navigation it started.
 *
 * Hence a module-level handle, settled by <NavTransitionSettler> in the root
 * layout, which outlives any page.
 */

type Pending = {
  resolve: () => void;
  /** The element holding the shared name, cleared once this is over. */
  named: HTMLElement | null;
  timer: ReturnType<typeof setTimeout>;
};

let pending: Pending | null = null;

/** Called after the new route has painted. Safe to call when nothing is running. */
export function settleNavTransition(): void {
  if (!pending) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  current.resolve();
}

function clearName(node: HTMLElement | null) {
  if (node) node.style.viewTransitionName = "";
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function supportsViewTransitions(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function"
  );
}

/**
 * Navigates, morphing `named` into whatever carries the same name on the
 * next page.
 *
 * Falls back to a plain navigation when the API is missing or the user has
 * asked for reduced motion — the destination is identical either way, which is
 * the point of doing it this way rather than animating a route change by hand.
 */
export function navigateWithTransition(
  navigate: () => void,
  named: HTMLElement | null,
  name: string,
): void {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    navigate();
    return;
  }

  // Anything still running is abandoned rather than queued. A shopper clicking
  // a second card mid-transition wants the second card.
  settleNavTransition();

  if (named) named.style.viewTransitionName = name;

  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        pending = {
          resolve,
          named,
          // The safety valve. If the route never commits — a navigation to the
          // URL already showing, a thrown error in a server component — the
          // browser would hold the frozen old snapshot over a live page until
          // its own timeout. One second is well past any real navigation.
          timer: setTimeout(() => {
            settleNavTransition();
          }, 1000),
        };
        navigate();
      }),
  );

  // Both paths, because `finished` rejects when a transition is skipped and an
  // unremoved name would collide with the next click on the same grid.
  transition.finished.then(
    () => clearName(named),
    () => clearName(named),
  );

  // `updateCallbackDone` rejects on its own whenever the transition is
  // abandoned — the document going inactive mid-navigation is the common one,
  // and it is entirely expected. Left unhandled it surfaces as an uncaught
  // "InvalidStateError: Transition was aborted" in the console, which is noise
  // that would train someone to ignore real errors there.
  transition.updateCallbackDone.catch(() => {});
  transition.ready.catch(() => {});
}
