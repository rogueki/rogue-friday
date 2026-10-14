"use client";

/** Last resort when the root layout itself fails: plain markup, no providers, no design system dependencies. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="de">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#01060c", color: "#d7f6ff", fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Jarvis konnte nicht gestartet werden</h1>
          <p style={{ opacity: 0.8 }}>{error.message}</p>
          <button type="button" onClick={reset} style={{ padding: "8px 16px", cursor: "pointer" }}>
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
