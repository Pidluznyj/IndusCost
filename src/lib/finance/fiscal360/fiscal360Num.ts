/** Conversão numérica tolerante (Prisma.Decimal, bigint, string) — compartilhada por fontes e consultas. */
export function num(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  return num(value);
}
