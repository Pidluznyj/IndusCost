/**
 * Helpers puros da Conferência de Estoque (cadastro Material).
 * Não alteram fórmulas de custo / BOM. Diferença e arredondamento alinhados a Decimal(20,6).
 */

const SCALE = 1_000_000;

function toFiniteNumber(value: unknown): number {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "toString" in value) {
    return Number(String(value));
  }
  return Number(value);
}

/** Arredonda para 6 casas decimais (mesma escala monetária/quantidade do cadastro). */
export function roundMaterialStockQuantity(value: unknown): number {
  const n = toFiniteNumber(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * SCALE) / SCALE;
}

/**
 * diferença = saldo informado − saldo anterior (6 casas).
 * Aceita number ou string decimal (ex.: "10.123456") sem perda além da escala oficial.
 */
export function computeStockConferenceDifference(
  previousQuantity: unknown,
  reportedQuantity: unknown
): number {
  const prev = roundMaterialStockQuantity(previousQuantity);
  const reported = roundMaterialStockQuantity(reportedQuantity);
  if (!Number.isFinite(prev) || !Number.isFinite(reported)) return NaN;
  return roundMaterialStockQuantity(reported - prev);
}

/** null = parâmetro não configurado (não tratar 0 como default implícito de schema). */
export function isStockLevelConfigured(value: unknown): boolean {
  return value != null && value !== "";
}
