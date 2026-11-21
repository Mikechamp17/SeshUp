import type { CSSProperties } from "react";

// Same look as the sign-in pages, with a wider column for lists and tables.
export const operatorStyles: Record<string, CSSProperties> = {
  main: { maxWidth: 640, margin: "0 auto", padding: 16 },
  row: { display: "flex", gap: 16, flexWrap: "wrap" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: { padding: 12, border: "1px solid #ccc", borderRadius: 6, overflowWrap: "anywhere" },
  section: { marginTop: 24 },
};
