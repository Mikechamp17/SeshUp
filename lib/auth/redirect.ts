// Only same-origin relative paths are allowed as a post-login destination, so a
// crafted `next` value can never send a member to another site.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /[a-z][a-z0-9+.-]*:/i;

export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next === "") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  if (CONTROL_CHARACTERS.test(next)) return "/";
  if (SCHEME.test(next)) return "/";
  return next;
}
