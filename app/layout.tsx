import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "SeshUp",
  description: "Book boxing gym classes from your phone.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
