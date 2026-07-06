/**
 * Classificação de alertas de custo na Engenharia de Produto — pura, sem Prisma.
 */

export const PRODUCT_ENGINEERING_COST_TOLERANCE = 0.000001;

export const PRODUCT_ENGINEERING_COST_MESSAGES = {
  COST_DIFF_PENDING_PUBLICATION: "Custo pendente para publicação",
  TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT: "Snapshot técnico pendente sem impacto de custo",
  COST_PUBLISHED_OK: "Custo oficial atualizado",
} as const;

export type ProductEngineeringCostWarningStatus =
  | "NONE"
  | "COST_DIFF_PENDING_PUBLICATION"
  | "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT"
  | "COST_PUBLISHED_OK"
  | "MISSING_OFFICIAL_COST"
  | "ERROR";

export type ProductEngineeringCostWarningSeverity = "none" | "info" | "attention" | "error";

export type ProductEngineeringCostWarningInput = {
  officialCost: number | null;
  calculatedCost: number | null;
  officialHash?: string | null;
  calculatedHash?: string | null;
  hasDraft?: boolean;
  hasOfficialPublished?: boolean;
  errorMessage?: string | null;
};

export type ProductEngineeringCostWarningResult = {
  officialCost: number | null;
  calculatedCost: number | null;
  difference: number | null;
  hasCostImpact: boolean;
  hasTechnicalSnapshotPending: boolean;
  warningStatus: ProductEngineeringCostWarningStatus;
  warningSeverity: ProductEngineeringCostWarningSeverity;
  message: string | null;
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function isFiniteProductionCost(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function hasProductionCostDifference(
  officialCost: number | null | undefined,
  calculatedCost: number | null | undefined,
  tolerance = PRODUCT_ENGINEERING_COST_TOLERANCE
): boolean {
  if (!isFiniteProductionCost(calculatedCost)) return false;
  if (!isFiniteProductionCost(officialCost)) return true;
  return Math.abs(calculatedCost - officialCost) > tolerance;
}

export function computeProductionCostWarningDifference(
  officialCost: number | null,
  calculatedCost: number | null
): number | null {
  if (!isFiniteProductionCost(calculatedCost)) return null;
  if (!isFiniteProductionCost(officialCost)) return round6(calculatedCost);
  return round6(calculatedCost - officialCost);
}

export function hasTechnicalSnapshotPending(input: {
  hasDraft?: boolean;
  officialHash?: string | null;
  calculatedHash?: string | null;
  hasCostImpact: boolean;
}): boolean {
  if (input.hasCostImpact) return false;
  if (input.hasDraft) return true;
  if (
    input.officialHash &&
    input.calculatedHash &&
    input.officialHash.trim() !== "" &&
    input.calculatedHash.trim() !== "" &&
    input.officialHash !== input.calculatedHash
  ) {
    return true;
  }
  return false;
}

export function resolveProductEngineeringCostWarning(
  input: ProductEngineeringCostWarningInput
): ProductEngineeringCostWarningResult {
  const officialCost = isFiniteProductionCost(input.officialCost) ? input.officialCost : null;
  const calculatedCost = isFiniteProductionCost(input.calculatedCost) ? input.calculatedCost : null;
  const difference = computeProductionCostWarningDifference(officialCost, calculatedCost);
  const hasOfficialPublished = input.hasOfficialPublished === true;

  if (input.errorMessage?.trim()) {
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: false,
      hasTechnicalSnapshotPending: false,
      warningStatus: "ERROR",
      warningSeverity: "error",
      message: input.errorMessage.trim(),
    };
  }

  if (calculatedCost == null) {
    if (!hasOfficialPublished) {
      return {
        officialCost,
        calculatedCost,
        difference,
        hasCostImpact: false,
        hasTechnicalSnapshotPending: false,
        warningStatus: "MISSING_OFFICIAL_COST",
        warningSeverity: "attention",
        message: "Sem custo oficial publicado.",
      };
    }
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: false,
      hasTechnicalSnapshotPending: false,
      warningStatus: "NONE",
      warningSeverity: "none",
      message: null,
    };
  }

  const hasCostImpact = hasProductionCostDifference(officialCost, calculatedCost);
  const technicalPending = hasTechnicalSnapshotPending({
    hasDraft: input.hasDraft,
    officialHash: input.officialHash,
    calculatedHash: input.calculatedHash,
    hasCostImpact,
  });

  if (!hasOfficialPublished && officialCost == null) {
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: true,
      hasTechnicalSnapshotPending: false,
      warningStatus: "MISSING_OFFICIAL_COST",
      warningSeverity: "attention",
      message: "Sem custo oficial publicado.",
    };
  }

  if (hasCostImpact) {
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: true,
      hasTechnicalSnapshotPending: false,
      warningStatus: "COST_DIFF_PENDING_PUBLICATION",
      warningSeverity: "attention",
      message: PRODUCT_ENGINEERING_COST_MESSAGES.COST_DIFF_PENDING_PUBLICATION,
    };
  }

  if (technicalPending) {
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: false,
      hasTechnicalSnapshotPending: true,
      warningStatus: "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT",
      warningSeverity: "info",
      message: PRODUCT_ENGINEERING_COST_MESSAGES.TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT,
    };
  }

  if (hasOfficialPublished) {
    return {
      officialCost,
      calculatedCost,
      difference,
      hasCostImpact: false,
      hasTechnicalSnapshotPending: false,
      warningStatus: "COST_PUBLISHED_OK",
      warningSeverity: "none",
      message: PRODUCT_ENGINEERING_COST_MESSAGES.COST_PUBLISHED_OK,
    };
  }

  return {
    officialCost,
    calculatedCost,
    difference,
    hasCostImpact: false,
    hasTechnicalSnapshotPending: false,
    warningStatus: "NONE",
    warningSeverity: "none",
    message: null,
  };
}
