/**
 * Resolve frete % da formação comercial a partir do snapshot / defaults da tabela.
 * Preferência: proposalDefaults.freightPercent → formulaSnapshot.freightPercent → rates.freightRate.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrai frete percentual (0–100) do payload published-price ou pricingSnapshotJson.
 */
export function resolveProposalFreightPercent(snapshot: unknown): number {
  const root = asRecord(snapshot);
  if (!root) return 0;

  const fromDefaults = asFiniteNumber(asRecord(root.proposalDefaults)?.freightPercent);
  if (fromDefaults != null && fromDefaults >= 0) return fromDefaults;

  const item = asRecord(root.item);
  const formula =
    asRecord(item?.formulaSnapshotJson) ??
    asRecord(root.formulaSnapshotJson) ??
    asRecord(root.formulaSnapshot);

  const fromFormulaPct = asFiniteNumber(formula?.freightPercent);
  if (fromFormulaPct != null && fromFormulaPct >= 0) return fromFormulaPct;

  const rates = asRecord(formula?.rates);
  const freightRate = asFiniteNumber(rates?.freightRate);
  if (freightRate != null && freightRate >= 0) {
    // rates.freightRate é fração (0.03 = 3%)
    return freightRate <= 1 ? freightRate * 100 : freightRate;
  }

  const topLevel = asFiniteNumber(root.freightPercent);
  if (topLevel != null && topLevel >= 0) return topLevel;

  return 0;
}

/** Frete R$ absoluto legado (numerador da formação antiga), se houver. */
export function resolveProposalFreightAbsolute(snapshot: unknown): number {
  const root = asRecord(snapshot);
  if (!root) return 0;

  const fromDefaults = asFiniteNumber(asRecord(root.proposalDefaults)?.freightAbsolute);
  if (fromDefaults != null && fromDefaults >= 0) return fromDefaults;

  const item = asRecord(root.item);
  const formula =
    asRecord(item?.formulaSnapshotJson) ??
    asRecord(root.formulaSnapshotJson) ??
    asRecord(root.formulaSnapshot);

  const fromFormula = asFiniteNumber(formula?.freight);
  if (fromFormula != null && fromFormula >= 0) return fromFormula;

  return 0;
}
