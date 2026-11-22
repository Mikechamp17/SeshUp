// Money is integer cents everywhere. No floats in fee math.

/** Fee in cents for a price and a rate in basis points, rounded half-up. */
export function computeFeeCents(priceCents: number, feeBps: number): number {
  return Math.floor((priceCents * feeBps + 5000) / 10000);
}

/** Display a cent amount as rand, e.g. 123456789 -> "R1 234 567.89". */
export function formatRand(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rand = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}R${rand}.${rest}`;
}
