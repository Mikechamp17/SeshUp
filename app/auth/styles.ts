import type { CSSProperties } from "react";

export const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 420, margin: "0 auto", padding: 16 },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 },
  input: { padding: 12, fontSize: 16, border: "1px solid #888", borderRadius: 6 },
  button: { padding: 14, fontSize: 16, fontWeight: 700, border: 0, borderRadius: 6, background: "#111", color: "#fff" },
  error: { padding: 12, border: "1px solid #b00020", borderRadius: 6, color: "#b00020" },
  notice: { padding: 12, border: "1px solid #2e7d32", borderRadius: 6, color: "#2e7d32" },
  footer: { marginTop: 16 },
};
