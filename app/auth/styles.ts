import type { CSSProperties } from "react";

// Shared by the admin and operator pages, which keep their own layout. The values follow the design tokens in globals.css.
export const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 420, margin: "0 auto", padding: 16 },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontWeight: 700 },
  input: { padding: 12, minHeight: 48, fontSize: 16, border: "2px solid var(--ink)", borderRadius: 12, background: "var(--paper)", color: "var(--ink)" },
  button: {
    padding: 14,
    minHeight: 48,
    fontSize: 18,
    fontWeight: 800,
    fontFamily: "var(--font-display)",
    textTransform: "uppercase",
    letterSpacing: ".05em",
    border: "2px solid var(--ink)",
    borderRadius: 12,
    background: "var(--accent)",
    color: "var(--on-accent)",
    boxShadow: "0 3px 0 var(--ink)",
  },
  error: { padding: 12, border: "2px solid var(--cancel)", borderRadius: 12, background: "var(--cancel-bg)", color: "var(--cancel)", fontWeight: 600 },
  notice: { padding: 12, border: "2px solid var(--ok)", borderRadius: 12, background: "var(--ok-bg)", color: "var(--ok)", fontWeight: 600 },
  footer: { marginTop: 16 },
};
