/**
 * OP-10 — consistência temporal da conferência física. Motor puro (sem Prisma).
 *
 * A contagem não pode ser interpretada contra a fotografia tirada no START da
 * sessão: entre o START e a contagem o saldo pode ter se movimentado por
 * motivos legítimos. A autoridade do ajuste passa a ser o `adjustmentDelta`
 * gravado na InventoryCountObservation, calculado contra o saldo materializado
 * lido SOB LOCK no instante da contagem.
 */
import { computeCountDifference } from "./inventoryCountMath.js";
import { roundInventoryQuantity, safeInventoryNumber } from "./inventoryTypes.js";

/** Base usada para decidir o ajuste de uma linha de conferência. */
export const COUNT_ADJUSTMENT_BASIS = {
  /** Linha com Observation vigente — semântica temporal correta. */
  observation: "OBSERVATION",
  /** Linha anterior ao OP-10 — diferença contra a foto do START. */
  legacy: "LEGACY_SYSTEM_QUANTITY",
  /** Linha nunca contada — não gera ajuste. */
  notCounted: "NOT_COUNTED",
} as const;

export type CountAdjustmentBasis =
  (typeof COUNT_ADJUSTMENT_BASIS)[keyof typeof COUNT_ADJUSTMENT_BASIS];

export type CountAdjustmentResolution = {
  basis: CountAdjustmentBasis;
  delta: number;
};

/** Linha mínima necessária para resolver a base do ajuste. */
export type CountLineAdjustmentSource = {
  systemQuantity: unknown;
  countedQuantity?: unknown;
  differenceQuantity?: unknown;
  currentObservation?: { adjustmentDelta: unknown } | null;
};

/**
 * Delta do ajuste no instante da contagem.
 * `expectedQuantity` é o saldo materializado sob lock — nunca a foto do START.
 */
export function computeObservationDelta(
  expectedQuantity: number,
  countedQuantity: number
): number {
  return roundInventoryQuantity(
    roundInventoryQuantity(countedQuantity) - roundInventoryQuantity(expectedQuantity)
  );
}

/**
 * Resolve explicitamente de onde vem o delta do ajuste.
 *
 * Com Observation vigente, o delta é o gravado na contagem — movimentações
 * ocorridas depois da contagem sobrevivem ao ajuste. Sem Observation (sessões
 * anteriores ao OP-10) o comportamento legado é preservado byte a byte: nada de
 * Observation sintética, nada de reescrita de histórico.
 */
export function resolveCountAdjustmentBasis(
  line: CountLineAdjustmentSource
): CountAdjustmentResolution {
  const observationDelta = line.currentObservation?.adjustmentDelta;
  if (observationDelta != null) {
    return {
      basis: COUNT_ADJUSTMENT_BASIS.observation,
      delta: roundInventoryQuantity(safeInventoryNumber(observationDelta) ?? 0),
    };
  }

  if (line.differenceQuantity != null) {
    return {
      basis: COUNT_ADJUSTMENT_BASIS.legacy,
      delta: roundInventoryQuantity(safeInventoryNumber(line.differenceQuantity) ?? 0),
    };
  }

  if (line.countedQuantity != null) {
    return {
      basis: COUNT_ADJUSTMENT_BASIS.legacy,
      delta: computeCountDifference(
        safeInventoryNumber(line.systemQuantity) ?? 0,
        safeInventoryNumber(line.countedQuantity) ?? 0
      ).differenceQuantity,
    };
  }

  return { basis: COUNT_ADJUSTMENT_BASIS.notCounted, delta: 0 };
}
