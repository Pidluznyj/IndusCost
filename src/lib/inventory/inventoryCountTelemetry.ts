/**
 * OP-10 — telemetria do fallback legado da conferência física.
 *
 * Objetivo: medir quando as sessões anteriores ao OP-10 deixam de existir
 * naturalmente. Só identificadores de domínio — nada de dado pessoal.
 */

export const INVENTORY_COUNT_LEGACY_BASIS_EVENT = "inventory.count.adjustment_basis.legacy";

export type LegacyCountBasisEventInput = {
  sessionId: string;
  sessionCode: string;
  lineId: string;
  itemId: string;
  warehouseId: string;
};

export type LegacyCountBasisEvent = LegacyCountBasisEventInput & {
  event: typeof INVENTORY_COUNT_LEGACY_BASIS_EVENT;
  basis: "LEGACY_SYSTEM_QUANTITY";
};

export function buildLegacyCountBasisEvent(
  input: LegacyCountBasisEventInput
): LegacyCountBasisEvent {
  return {
    event: INVENTORY_COUNT_LEGACY_BASIS_EVENT,
    basis: "LEGACY_SYSTEM_QUANTITY",
    sessionId: input.sessionId,
    sessionCode: input.sessionCode,
    lineId: input.lineId,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
  };
}

/** Emite o evento de fallback — sessão antiga ajustada pela semântica anterior. */
export function logLegacyCountBasis(input: LegacyCountBasisEventInput): void {
  console.warn(
    INVENTORY_COUNT_LEGACY_BASIS_EVENT,
    JSON.stringify(buildLegacyCountBasisEvent(input))
  );
}
