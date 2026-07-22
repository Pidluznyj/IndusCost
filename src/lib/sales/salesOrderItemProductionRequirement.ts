/**
 * OP-48 — Resolvedor puro de necessidade de produção por SalesOrderItem.
 *
 * Fonte normativa:
 * - `docs/commercial/sales-order-flow/current-state-audit.md` (§6.4)
 * - `docs/commercial/sales-order-flow/state-machine.md` (WAITING_PRODUCTION_ORDER)
 *
 * Não cria cadastro novo. Consome evidências oficiais já existentes (produto,
 * roteiro, BOM, movimentação, vínculo OP, regra IndusCost explícita).
 *
 * Regras centrais:
 * - ausência de OP ≠ NOT_REQUIRED;
 * - existência de OP oficial = evidência de REQUIRED;
 * - estoque/revenda só NOT_REQUIRED com evidência real;
 * - UNKNOWN não conclui o fluxo (inconsistência auxiliar).
 */

import { PRODUCT_COSTING_MODE_VALUES } from "../productCostingModeValidation.js";

export const SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CLASSIFICATIONS = [
  "REQUIRED",
  "NOT_REQUIRED",
  "UNKNOWN",
] as const;

export type SalesOrderItemProductionRequirementClassification =
  (typeof SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CLASSIFICATIONS)[number];

export const SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CONFIDENCES = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export type SalesOrderItemProductionRequirementConfidence =
  (typeof SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CONFIDENCES)[number];

export const SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_SOURCE_ENTITIES = [
  "PRODUCT",
  "ROUTING",
  "BOM",
  "MOVEMENT",
  "PRODUCTION_ORDER_LINK",
  "INDUSCOST_RULE",
  "NONE",
] as const;

export type SalesOrderItemProductionRequirementSourceEntity =
  (typeof SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_SOURCE_ENTITIES)[number];

export const SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_REASON_CODES = [
  "PRODUCT_CLASS_MANUFACTURED",
  "PRODUCT_CLASS_RESALE",
  "PRODUCT_CLASS_STOCK",
  "COSTING_MODE_OWN_PROCESS",
  "COSTING_MODE_BOM_ONLY",
  "COSTING_MODE_FINISHING_SERVICE",
  "PRODUCT_ROUTING_PRESENT",
  "PRODUCT_BOM_PRESENT",
  "PRODUCTION_MOVEMENT_PRESENT",
  "OFFICIAL_PRODUCTION_ORDER_LINK",
  "EXPLICIT_REQUIRES_PRODUCTION_TRUE",
  "EXPLICIT_REQUIRES_PRODUCTION_FALSE",
  "NO_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "OP_ABSENCE_NOT_CONCLUSIVE",
] as const;

export type SalesOrderItemProductionRequirementReasonCode =
  (typeof SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_REASON_CODES)[number];

/** Classificação comercial comprovada (não inventar sem fonte). */
export type SalesOrderItemProductCommercialClass =
  | "MANUFACTURED"
  | "RESALE"
  | "STOCK";

export type ResolveSalesOrderItemProductionRequirementInput = {
  /** Tipo oficial Product.type */
  productType?: "PRODUCT" | "COMPONENT" | "MATERIAL" | null;
  /** Regra oficial Product.costingMode */
  costingMode?: string | null;
  /**
   * Classificação comercial comprovada (ex.: Nomus “mercadoria para revenda”,
   * política de estoque). Sem evidência → omitir.
   */
  productCommercialClass?: SalesOrderItemProductCommercialClass | null;

  /** Roteiro / processo produtivo (ProductRouting). */
  hasProductRouting?: boolean | null;
  routingStepCount?: number | null;

  /** Estrutura / BOM (ProductBOM). */
  hasProductBom?: boolean | null;
  bomLineCount?: number | null;

  /**
   * Tipo de movimentação de estoque relacionada ao item, quando houver.
   * Ex.: PRODUCTION_ENTRY, PRODUCTION_EXIT, PURCHASE_ENTRY.
   */
  inventoryMovementType?: string | null;

  /**
   * Vínculo oficial NomusProductionOrderSalesLink (preferir isCurrent).
   * Ausência não implica NOT_REQUIRED.
   */
  hasOfficialProductionOrderLink?: boolean | null;
  productionOrderLinkIsCurrent?: boolean | null;

  /**
   * Regra IndusCost já existente (ex.: parâmetro lifecycle quando alimentado).
   * null/undefined = não informado.
   */
  explicitRequiresProduction?: boolean | null;
};

export type SalesOrderItemProductionRequirementSignal = {
  side: "REQUIRED" | "NOT_REQUIRED";
  sourceEntity: SalesOrderItemProductionRequirementSourceEntity;
  reasonCode: SalesOrderItemProductionRequirementReasonCode;
  confidence: SalesOrderItemProductionRequirementConfidence;
  detail: string;
};

export type SalesOrderItemProductionRequirementEvidence = {
  signals: SalesOrderItemProductionRequirementSignal[];
  requiredSignalCount: number;
  notRequiredSignalCount: number;
  hasOfficialProductionOrderLink: boolean;
  hasManufacturingStructure: boolean;
  productCommercialClass: SalesOrderItemProductCommercialClass | null;
  costingMode: string | null;
  inventoryMovementType: string | null;
  explicitRequiresProduction: boolean | null;
};

export type ResolveSalesOrderItemProductionRequirementResult = {
  classification: SalesOrderItemProductionRequirementClassification;
  reasonCode: SalesOrderItemProductionRequirementReasonCode;
  evidence: SalesOrderItemProductionRequirementEvidence;
  sourceEntity: SalesOrderItemProductionRequirementSourceEntity;
  confidence: SalesOrderItemProductionRequirementConfidence;
  /** true somente quando classification === REQUIRED */
  requiresProduction: boolean | null;
  /** UNKNOWN deve gerar inconsistência auxiliar no fluxo (Kanban). */
  impliesInconsistency: boolean;
};

const CONFIDENCE_RANK: Record<SalesOrderItemProductionRequirementConfidence, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const PRODUCTION_MOVEMENT_TYPES = new Set([
  "PRODUCTION_ENTRY",
  "PRODUCTION_EXIT",
]);

function normalizeCostingMode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  if ((PRODUCT_COSTING_MODE_VALUES as readonly string[]).includes(t)) return t;
  return t;
}

function hasRouting(input: ResolveSalesOrderItemProductionRequirementInput): boolean {
  if (input.hasProductRouting === true) return true;
  if (typeof input.routingStepCount === "number" && input.routingStepCount > 0) {
    return true;
  }
  return false;
}

function hasBom(input: ResolveSalesOrderItemProductionRequirementInput): boolean {
  if (input.hasProductBom === true) return true;
  if (typeof input.bomLineCount === "number" && input.bomLineCount > 0) return true;
  return false;
}

function hasOfficialOpLink(
  input: ResolveSalesOrderItemProductionRequirementInput
): boolean {
  if (input.hasOfficialProductionOrderLink !== true) return false;
  if (input.productionOrderLinkIsCurrent === false) return false;
  return true;
}

/** Estoque/revenda comprovados não herdam exigência de OP por BOM/roteiro legado de custeio. */
function shouldInferManufacturingFromStructure(
  input: ResolveSalesOrderItemProductionRequirementInput
): boolean {
  if (
    input.productCommercialClass === "STOCK" ||
    input.productCommercialClass === "RESALE"
  ) {
    return hasOfficialOpLink(input);
  }
  return true;
}

function collectSignals(
  input: ResolveSalesOrderItemProductionRequirementInput
): SalesOrderItemProductionRequirementSignal[] {
  const signals: SalesOrderItemProductionRequirementSignal[] = [];
  const costingMode = normalizeCostingMode(input.costingMode);
  const inferStructure = shouldInferManufacturingFromStructure(input);

  // 1. Regra / classificação oficial do produto
  if (input.productCommercialClass === "MANUFACTURED") {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "PRODUCT",
      reasonCode: "PRODUCT_CLASS_MANUFACTURED",
      confidence: "HIGH",
      detail: "Classificação comercial comprovada: fabricado.",
    });
  } else if (input.productCommercialClass === "RESALE") {
    signals.push({
      side: "NOT_REQUIRED",
      sourceEntity: "PRODUCT",
      reasonCode: "PRODUCT_CLASS_RESALE",
      confidence: "HIGH",
      detail: "Classificação comercial comprovada: revenda.",
    });
  } else if (input.productCommercialClass === "STOCK") {
    signals.push({
      side: "NOT_REQUIRED",
      sourceEntity: "PRODUCT",
      reasonCode: "PRODUCT_CLASS_STOCK",
      confidence: "HIGH",
      detail: "Classificação comercial comprovada: estoque/pronto.",
    });
  }

  if (inferStructure) {
    if (costingMode === "OWN_PROCESS") {
      signals.push({
        side: "REQUIRED",
        sourceEntity: "PRODUCT",
        reasonCode: "COSTING_MODE_OWN_PROCESS",
        confidence: "MEDIUM",
        detail: "Product.costingMode = OWN_PROCESS (regra oficial de custeio/processo).",
      });
    } else if (costingMode === "BOM_ONLY") {
      signals.push({
        side: "REQUIRED",
        sourceEntity: "PRODUCT",
        reasonCode: "COSTING_MODE_BOM_ONLY",
        confidence: "MEDIUM",
        detail: "Product.costingMode = BOM_ONLY implica estrutura produtiva.",
      });
    } else if (costingMode === "FINISHING_SERVICE") {
      signals.push({
        side: "REQUIRED",
        sourceEntity: "PRODUCT",
        reasonCode: "COSTING_MODE_FINISHING_SERVICE",
        confidence: "MEDIUM",
        detail: "Product.costingMode = FINISHING_SERVICE implica operação produtiva.",
      });
    }
  }

  // 2. Roteiro / processo
  if (inferStructure && hasRouting(input)) {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "ROUTING",
      reasonCode: "PRODUCT_ROUTING_PRESENT",
      confidence: "HIGH",
      detail: "ProductRouting / processo produtivo presente.",
    });
  }

  // 3. BOM / estrutura
  if (inferStructure && hasBom(input)) {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "BOM",
      reasonCode: "PRODUCT_BOM_PRESENT",
      confidence: "HIGH",
      detail: "ProductBOM / estrutura comprovada presente.",
    });
  }

  // 4. Tipo de movimentação
  const movement =
    typeof input.inventoryMovementType === "string" && input.inventoryMovementType.trim()
      ? input.inventoryMovementType.trim()
      : null;
  if (movement && PRODUCTION_MOVEMENT_TYPES.has(movement)) {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "MOVEMENT",
      reasonCode: "PRODUCTION_MOVEMENT_PRESENT",
      confidence: "MEDIUM",
      detail: `Movimentação de produção: ${movement}.`,
    });
  }

  // 5. OP oficialmente vinculada
  if (hasOfficialOpLink(input)) {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "PRODUCTION_ORDER_LINK",
      reasonCode: "OFFICIAL_PRODUCTION_ORDER_LINK",
      confidence: "HIGH",
      detail: "NomusProductionOrderSalesLink oficial (isCurrent).",
    });
  }

  // 6. Regra IndusCost explícita
  if (input.explicitRequiresProduction === true) {
    signals.push({
      side: "REQUIRED",
      sourceEntity: "INDUSCOST_RULE",
      reasonCode: "EXPLICIT_REQUIRES_PRODUCTION_TRUE",
      confidence: "HIGH",
      detail: "Regra IndusCost explícita: requiresProduction = true.",
    });
  } else if (input.explicitRequiresProduction === false) {
    signals.push({
      side: "NOT_REQUIRED",
      sourceEntity: "INDUSCOST_RULE",
      reasonCode: "EXPLICIT_REQUIRES_PRODUCTION_FALSE",
      confidence: "HIGH",
      detail: "Regra IndusCost explícita: requiresProduction = false.",
    });
  }

  return signals;
}

function pickStrongest(
  signals: SalesOrderItemProductionRequirementSignal[]
): SalesOrderItemProductionRequirementSignal | null {
  if (signals.length === 0) return null;
  return [...signals].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
  )[0]!;
}

/**
 * Determina se o item exige produção.
 * Puro — sem I/O. Precedência por confiança das evidências coletadas.
 */
export function resolveSalesOrderItemProductionRequirement(
  input: ResolveSalesOrderItemProductionRequirementInput = {}
): ResolveSalesOrderItemProductionRequirementResult {
  const signals = collectSignals(input);
  const required = signals.filter((s) => s.side === "REQUIRED");
  const notRequired = signals.filter((s) => s.side === "NOT_REQUIRED");
  const costingMode = normalizeCostingMode(input.costingMode);
  const movement =
    typeof input.inventoryMovementType === "string" && input.inventoryMovementType.trim()
      ? input.inventoryMovementType.trim()
      : null;

  const evidence: SalesOrderItemProductionRequirementEvidence = {
    signals,
    requiredSignalCount: required.length,
    notRequiredSignalCount: notRequired.length,
    hasOfficialProductionOrderLink: hasOfficialOpLink(input),
    hasManufacturingStructure: hasRouting(input) || hasBom(input),
    productCommercialClass: input.productCommercialClass ?? null,
    costingMode,
    inventoryMovementType: movement,
    explicitRequiresProduction:
      input.explicitRequiresProduction === true
        ? true
        : input.explicitRequiresProduction === false
          ? false
          : null,
  };

  // Conflito: evidência real de NÃO exigir + evidência de exigir.
  if (required.length > 0 && notRequired.length > 0) {
    const strongestRequired = pickStrongest(required)!;
    return {
      classification: "UNKNOWN",
      reasonCode: "CONFLICTING_EVIDENCE",
      evidence,
      sourceEntity: strongestRequired.sourceEntity,
      confidence: "LOW",
      requiresProduction: null,
      impliesInconsistency: true,
    };
  }

  if (required.length > 0) {
    const strongest = pickStrongest(required)!;
    return {
      classification: "REQUIRED",
      reasonCode: strongest.reasonCode,
      evidence,
      sourceEntity: strongest.sourceEntity,
      confidence: strongest.confidence,
      requiresProduction: true,
      impliesInconsistency: false,
    };
  }

  if (notRequired.length > 0) {
    const strongest = pickStrongest(notRequired)!;
    return {
      classification: "NOT_REQUIRED",
      reasonCode: strongest.reasonCode,
      evidence,
      sourceEntity: strongest.sourceEntity,
      confidence: strongest.confidence,
      requiresProduction: false,
      impliesInconsistency: false,
    };
  }

  // Sem evidência: ausência de OP sozinha não decide.
  const reasonCode: SalesOrderItemProductionRequirementReasonCode =
    input.hasOfficialProductionOrderLink === false
      ? "OP_ABSENCE_NOT_CONCLUSIVE"
      : "NO_EVIDENCE";

  return {
    classification: "UNKNOWN",
    reasonCode,
    evidence,
    sourceEntity: "NONE",
    confidence: "LOW",
    requiresProduction: null,
    impliesInconsistency: true,
  };
}

/** Helper para o fluxo Kanban: UNKNOWN → código auxiliar REQUIRES_PRODUCTION_UNKNOWN. */
export function salesOrderItemProductionRequirementInconsistencyCode(
  result: ResolveSalesOrderItemProductionRequirementResult
): "REQUIRES_PRODUCTION_UNKNOWN" | null {
  return result.impliesInconsistency ? "REQUIRES_PRODUCTION_UNKNOWN" : null;
}
