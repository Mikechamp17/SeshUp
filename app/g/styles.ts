import type { CSSProperties } from "react";
import { styles as base } from "@/app/auth/styles";

export const styles: Record<string, CSSProperties> = {
  ...base,
  main: { maxWidth: 560, margin: "0 auto", padding: 16 },
  card: { border: "1px solid #ccc", borderRadius: 8, padding: 12, marginBottom: 10 },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  small: { color: "#555", fontSize: 14 },
  secondary: { padding: 12, fontSize: 16, fontWeight: 600, border: "1px solid #111", borderRadius: 6, background: "#fff", color: "#111" },
};
