import type { CSSProperties } from "react";
import { styles as base } from "@/app/auth/styles";

export const styles: Record<string, CSSProperties> = {
  ...base,
  main: { maxWidth: 560, margin: "0 auto", padding: 16 },
  card: { border: "2px solid var(--ink)", borderRadius: 16, padding: 12, marginBottom: 10, background: "var(--paper)" },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  small: { color: "var(--ink-3)", fontSize: 14 },
  secondary: {
    padding: 12,
    minHeight: 48,
    fontSize: 16,
    fontWeight: 700,
    border: "2px solid var(--ink)",
    borderRadius: 12,
    background: "var(--paper)",
    color: "var(--ink)",
  },
};
