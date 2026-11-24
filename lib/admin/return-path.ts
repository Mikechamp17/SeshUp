import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Where an owner action sends the owner afterwards. The path must stay inside the same gym's admin area and carry no
 * query or fragment, because the result message adds its own. Anything else gives the fallback.
 */
export function adminReturnPath(slug: string, raw: string, fallback: string): string {
  if (raw === "" || safeNextPath(raw) !== raw) return fallback;
  if (raw.includes("?") || raw.includes("#")) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (decoded.split("/").includes("..") || decoded.includes("\\")) return fallback;

  const prefix = `/admin/${slug}`;
  return raw === prefix || raw.startsWith(`${prefix}/`) ? raw : fallback;
}
