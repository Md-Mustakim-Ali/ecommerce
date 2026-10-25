"use client";

/**
 * The last boundary. Catches errors thrown by the root layout itself.
 *
 * It replaces the whole document, so it has to render <html> and <body> — the
 * layout that would normally provide them is the thing that failed.
 *
 * Consequently no fonts, no theme class, no design tokens: every one of those
 * comes from the layout. The styles here are inline and self-contained, which
 * is the only way this page renders at all when the reason for it is a broken
 * stylesheet or a missing font.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#0f141a",
          color: "#e8edf3",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: 600 }}>
            The page could not load
          </h1>
          <p
            style={{
              margin: "0 0 24px",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#9aa6b2",
            }}
          >
            Something failed before the page could be drawn. Reloading usually
            clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#e8edf3",
              color: "#0f141a",
              border: 0,
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p
              style={{
                margin: "20px 0 0",
                fontSize: "12px",
                color: "#6b7683",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
