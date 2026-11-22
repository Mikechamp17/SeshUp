/** A related row from a PostgREST embed, which arrives as one object or as a one-item array. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
