import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";

export type NomusApplyProductBomRowSnapshot = {
  id: string;
  componentCode: string;
  materialId: string | null;
  childProductId: string | null;
  quantity: number | null;
  isNomusControlled: boolean;
  nomusComponentCode: string | null;
};

export type NomusIncludedComponentApplyResolutionKind =
  | "MATERIAL"
  | "PRODUCT"
  | "EXISTING_PRODUCT_BOM_LINE"
  | "UNRESOLVED";

export type NomusIncludedComponentApplyResolution = {
  resolutionKind: NomusIncludedComponentApplyResolutionKind;
  materialId: string | null;
  childProductId: string | null;
  productBomLineId: string | null;
  hasExistingProductBomLine: boolean;
  quantityMatches: boolean;
  diagnostics: string | null;
};

const QTY_TOLERANCE = 1e-9;

export function quantitiesMatchForNomusApply(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance = QTY_TOLERANCE
): boolean {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
}

/** Linhas ProductBOM que representam o mesmo componente Nomus (código Nomus ou código IndusCost). */
export function findProductBomRowsForNomusComponent(
  componentCode: string,
  currentRows: NomusApplyProductBomRowSnapshot[]
): NomusApplyProductBomRowSnapshot[] {
  const key = normalizeComponentCode(componentCode);
  return currentRows.filter((row) => {
    const byIndus = normalizeComponentCode(row.componentCode) === key;
    const byNomus =
      row.nomusComponentCode != null &&
      normalizeComponentCode(row.nomusComponentCode) === key;
    return byIndus || byNomus;
  });
}

function pickCanonicalProductBomRow(
  rows: NomusApplyProductBomRowSnapshot[]
): NomusApplyProductBomRowSnapshot {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id))[0]!;
}

function isEligibleExistingNomusControlledRow(
  row: NomusApplyProductBomRowSnapshot
): boolean {
  if (!row.materialId && !row.childProductId) return false;
  return row.isNomusControlled === true;
}

/**
 * Quando o cadastro mestre (Material/Product por SKU) não resolve o apply,
 * reutiliza a linha ProductBOM já sincronizada com Nomus (nomusComponentCode + vínculo).
 */
export function resolveNomusIncludedComponentFromProductBom(
  componentCode: string,
  effectiveQuantity: number,
  currentRows: NomusApplyProductBomRowSnapshot[]
): NomusIncludedComponentApplyResolution {
  const matches = findProductBomRowsForNomusComponent(componentCode, currentRows);
  if (matches.length === 0) {
    return {
      resolutionKind: "UNRESOLVED",
      materialId: null,
      childProductId: null,
      productBomLineId: null,
      hasExistingProductBomLine: false,
      quantityMatches: false,
      diagnostics: "Nenhuma linha ProductBOM para o componente.",
    };
  }

  const invalidOnly = matches.every((row) => !row.materialId && !row.childProductId);
  if (invalidOnly) {
    return {
      resolutionKind: "UNRESOLVED",
      materialId: null,
      childProductId: null,
      productBomLineId: null,
      hasExistingProductBomLine: true,
      quantityMatches: false,
      diagnostics:
        "Linha ProductBOM existe, mas sem materialId nem childProductId — vínculo inválido.",
    };
  }

  const eligible = matches.filter(isEligibleExistingNomusControlledRow);
  if (eligible.length === 0) {
    return {
      resolutionKind: "UNRESOLVED",
      materialId: null,
      childProductId: null,
      productBomLineId: null,
      hasExistingProductBomLine: true,
      quantityMatches: false,
      diagnostics:
        "Linha ProductBOM existe, mas não está elegível (isNomusControlled=false ou sem vínculo).",
    };
  }

  const qtyMatches = eligible.filter((row) =>
    quantitiesMatchForNomusApply(row.quantity, effectiveQuantity)
  );
  const pool = qtyMatches.length > 0 ? qtyMatches : eligible;
  const row = pickCanonicalProductBomRow(pool);
  const quantityMatches = quantitiesMatchForNomusApply(row.quantity, effectiveQuantity);

  if (row.materialId) {
    return {
      resolutionKind: "MATERIAL",
      materialId: row.materialId,
      childProductId: null,
      productBomLineId: row.id,
      hasExistingProductBomLine: true,
      quantityMatches,
      diagnostics: null,
    };
  }

  if (row.childProductId) {
    return {
      resolutionKind: "PRODUCT",
      materialId: null,
      childProductId: row.childProductId,
      productBomLineId: row.id,
      hasExistingProductBomLine: true,
      quantityMatches,
      diagnostics: null,
    };
  }

  return {
    resolutionKind: "UNRESOLVED",
    materialId: null,
    childProductId: null,
    productBomLineId: null,
    hasExistingProductBomLine: true,
    quantityMatches: false,
    diagnostics: "Linha ProductBOM sem materialId nem childProductId.",
  };
}
