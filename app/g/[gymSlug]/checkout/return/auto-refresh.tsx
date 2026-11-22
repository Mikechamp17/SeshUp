"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-checks the page every few seconds while a payment is still being confirmed. */
export function AutoRefresh({ href, seconds }: { href: string; seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.replace(href), seconds * 1000);
    return () => clearTimeout(timer);
  }, [href, seconds, router]);
  return null;
}
