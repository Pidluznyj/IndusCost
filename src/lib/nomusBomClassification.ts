import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";

export type NomusBomActionClass =
  | "AUTO_APPLY_CANDIDATE"
  | "AUTO_UPDATE_QUANTITIES_CANDIDATE"
  | "CREATE_BOM_CANDIDATE"
  | "CREATE_PRODUCT_FROM_NOMUS_CANDIDATE"
  | "IMPORT_PRODUCT_THEN_CREATE_BOM_CANDIDATE"
  | "LOCAL_ONLY_KEEP"
  | "LOCAL_ONLY_REVIEW"
  | "REVIEW_STRUCTURE_DIFF"
  | "REVIEW_QUANTITY_DIFF"
  | "REVIEW_INDUS_OPERATIONAL_ITEM"
  | "REVIEW_PREPARED_COMPONENT"
  | "REVIEW_KIT_OR_PACK"
  | "BLOCKED_MISSING_PARENT_PRODUCT"
  | "BLOCKED_MISSING_NOMUS_COMPONENT"
  | "BLOCKED_AMBIGUOUS_NOMUS_LIST"
  | "BLOCKED_NO_NOMUS_BOM"
  | "NO_ACTION_OK";

export type NomusBomRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type NomusBomRecommendedAction =
  | "NO_ACTION"
  | "CAN_CREATE_BOM_FROM_NOMUS_AFTER_REVIEW"
  | "CAN_UPDATE_QUANTITIES_AFTER_REVIEW"
  | "CAN_REPLACE_BOM_AFTER_BACKUP_AND_APPROVAL"
  | "CREATE_OR_MAP_PARENT_PRODUCT_FIRST"
  | "CREATE_OR_MAP_COMPONENTS_FIRST"
  | "IMPORT_PRODUCT_FROM_NOMUS_FIRST"
  | "IMPORT_PRODUCT_AND_THEN_PLAN_BOM"
  | "KEEP_LOCAL_PRODUCT_DO_NOT_DELETE"
  | "REVIEW_LOCAL_PRODUCT_WITHOUT_NOMUS_REFERENCE"
  | "MOVE_OPERATIONAL_ITEM_TO_ROUTING_OR_IGNORE"
  | "REVIEW_PREPARED_COMPONENT_POLICY"
  | "REVIEW_KIT_OR_PACK_POLICY"
  | "MANUAL_ENGINEERING_REVIEW_REQUIRED"
  | "BLOCKED_DO_NOT_APPLY";

export type NomusBomClassificationIssue = {
  code: string;
  message: string;
  severity: NomusBomRiskLevel;
  componentCode?: string | null;
  evidence?: Record<string, unknown>;
};

export type ResolvedNomusComponent = {
  componentCode: string;
  productId?: string | null;
  materialId?: string | null;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
};

export type NomusBomClassification = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  indusProductName?: string | null;

  actionClass: NomusBomActionClass;
  riskLevel: NomusBomRiskLevel;
  recommendedAction: NomusBomRecommendedAction;

  canApplyAutomaticallyNow: boolean;
  canApplyWithApproval: boolean;
  /** Bloqueia aplicação de BOM nesta fase (não bloqueia plano de importação de produto). */
  isBlocked: boolean;
  isProductImportCandidate: boolean;
  isBlockedForBomApplication: boolean;

  reasons: string[];
  issues: NomusBomClassificationIssue[];

  metrics: {
    nomusLines: number;
    indusLines: number;
    matches: number;
    quantityDiffs: number;
    onlyInNomus: number;
    onlyInIndusCost: number;
    missingNomusComponentsCount: number;
    operationalIndusItemsCount: number;
    preparedComponentsCount: number;
    kitOrPackIndicatorsCount: number;
  };

  suggestedNextStepText: string;
};

const OPERATIONAL_DESC_PATTERN =
  /montagem|processo|opera[cç][aã]o|mao de obra|m[aã]o de obra|servi[cç]o/i;
const KIT_DESC_PATTERN = /c\/12|com acess[oó]rios|kit|conjunto|embalagem/i;
const PREPARED_DESC_PATTERN = /preparado/i;

const REVIEW_ACTION_CLASSES: NomusBomActionClass[] = [
  "REVIEW_STRUCTURE_DIFF",
  "REVIEW_QUANTITY_DIFF",
  "REVIEW_INDUS_OPERATIONAL_ITEM",
  "REVIEW_PREPARED_COMPONENT",
  "REVIEW_KIT_OR_PACK",
];

const CANDIDATE_ACTION_CLASSES: NomusBomActionClass[] = [
  "AUTO_APPLY_CANDIDATE",
  "AUTO_UPDATE_QUANTITIES_CANDIDATE",
  "CREATE_BOM_CANDIDATE",
  "CREATE_PRODUCT_FROM_NOMUS_CANDIDATE",
  "IMPORT_PRODUCT_THEN_CREATE_BOM_CANDIDATE",
];

/** Limitação documentada: Product não possui nomusId/sourceSystem; catálogo Nomus inferido via NomusBomComponentStage.parentCode. */
export const NOMUS_PRODUCT_EXISTENCE_SOURCE = "NomusBomComponentStage.parentCode" as const;

export function detectOperationalItem(componentCode: string, description?: string | null): boolean {
  const code = normalizeComponentCode(componentCode);
  if (code.startsWith("800.")) return true;
  const desc = (description ?? "").trim();
  return desc.length > 0 && OPERATIONAL_DESC_PATTERN.test(desc);
}

export function detectPreparedComponent(componentCode: string, description?: string | null): boolean {
  const code = normalizeComponentCode(componentCode);
  if (code.startsWith("150.")) return true;
  const desc = (description ?? "").trim();
  return desc.length > 0 && PREPARED_DESC_PATTERN.test(desc);
}

export function detectKitOrPack(parentCode: string, description?: string | null): boolean {
  const code = parentCode.trim();
  const digitsOnly = code.replace(/\D/g, "");
  if (digitsOnly.length >= 12 && digitsOnly.length <= 14 && /^\d+$/.test(digitsOnly)) {
    return true;
  }
  const desc = (description ?? "").trim();
  return desc.length > 0 && KIT_DESC_PATTERN.test(desc);
}

function nomusComponentCodesFromComparison(result: BomComparisonResult): string[] {
  const codes = new Set<string>();
  for (const line of result.lines) {
    if (line.nomusLineCount > 0) codes.add(line.componentCode);
  }
  return [...codes];
}

function unresolvedNomusComponents(
  componentCodes: string[],
  resolved: ResolvedNomusComponent[]
): ResolvedNomusComponent[] {
  const map = new Map(resolved.map((item) => [normalizeComponentCode(item.componentCode), item]));
  return componentCodes
    .map((code) => map.get(normalizeComponentCode(code)))
    .filter((item): item is ResolvedNomusComponent => item != null && item.resolvedKind === "NONE");
}

function allNomusComponentsResolved(
  componentCodes: string[],
  resolved: ResolvedNomusComponent[]
): boolean {
  return unresolvedNomusComponents(componentCodes, resolved).length === 0;
}

function collectClassificationIssues(
  result: BomComparisonResult,
  resolved: ResolvedNomusComponent[],
  metrics: NomusBomClassification["metrics"]
): NomusBomClassificationIssue[] {
  const issues: NomusBomClassificationIssue[] = [];

  if (detectKitOrPack(result.parentCode, result.parentDescription)) {
    metrics.kitOrPackIndicatorsCount += 1;
    issues.push({
      code: "KIT_OR_PACK_PARENT",
      message: "Produto pai parece kit, pacote ou código comercial (EAN/embalagem).",
      severity: "HIGH",
      componentCode: result.parentCode,
    });
  }

  if (detectPreparedComponent(result.parentCode, result.parentDescription)) {
    metrics.preparedComponentsCount += 1;
    issues.push({
      code: "PREPARED_PARENT",
      message: "Produto pai na família 150.xx ou descrição de preparado — exige política antes de aplicar.",
      severity: "HIGH",
      componentCode: result.parentCode,
    });
  }

  for (const line of result.lines) {
    if (detectPreparedComponent(line.componentCode, line.componentDescription)) {
      metrics.preparedComponentsCount += 1;
      issues.push({
        code: "PREPARED_COMPONENT",
        message: "Componente preparado/composto (150.xx) — revisar política de aplicação.",
        severity: "HIGH",
        componentCode: line.componentCode,
      });
    }

    if (line.status === "ONLY_IN_INDUSCOST" && detectOperationalItem(line.componentCode, line.componentDescription)) {
      metrics.operationalIndusItemsCount += 1;
      issues.push({
        code: "OPERATIONAL_INDUS_ITEM",
        message: "Item só no IndusCost parece operacional/montagem — considerar roteiro ou ignorar na BOM.",
        severity: "HIGH",
        componentCode: line.componentCode,
        evidence: { indusQuantity: line.indusQuantity },
      });
    }
  }

  for (const item of resolved) {
    if (item.resolvedKind === "BOTH") {
      issues.push({
        code: "COMPONENT_RESOLVES_AS_BOTH",
        message: `Componente ${item.componentCode} resolve como Product e Material no IndusCost.`,
        severity: "MEDIUM",
        componentCode: item.componentCode,
        evidence: { productId: item.productId, materialId: item.materialId },
      });
    }
    if (item.resolvedKind === "NONE") {
      issues.push({
        code: "MISSING_NOMUS_COMPONENT",
        message: `Componente Nomus ${item.componentCode} não encontrado como Product.sku nem Material.code.`,
        severity: "BLOCKED",
        componentCode: item.componentCode,
      });
    }
  }

  metrics.missingNomusComponentsCount = unresolvedNomusComponents(
    nomusComponentCodesFromComparison(result),
    resolved
  ).length;

  if (result.summary.ambiguousNomusList) {
    issues.push({
      code: "AMBIGUOUS_NOMUS_LIST",
      message: "Lista de materiais Nomus ambígua após regras de desempate.",
      severity: "BLOCKED",
    });
  }

  return issues;
}

function hasPreparedPolicyPending(result: BomComparisonResult, metrics: NomusBomClassification["metrics"]): boolean {
  return (
    metrics.preparedComponentsCount > 0 ||
    detectPreparedComponent(result.parentCode, result.parentDescription)
  );
}

function hasKitOrPackPolicyPending(result: BomComparisonResult, metrics: NomusBomClassification["metrics"]): boolean {
  return metrics.kitOrPackIndicatorsCount > 0 || detectKitOrPack(result.parentCode, result.parentDescription);
}

function isCreateBomCandidate(
  result: BomComparisonResult,
  resolved: ResolvedNomusComponent[],
  metrics: NomusBomClassification["metrics"],
  noIndusBom: boolean
): boolean {
  if (result.summary.missingProductInIndusCost) return false;
  if (!noIndusBom) return false;
  if (result.summary.nomusLines === 0) return false;
  if (!allNomusComponentsResolved(nomusComponentCodesFromComparison(result), resolved)) return false;
  if (hasKitOrPackPolicyPending(result, metrics)) return false;
  if (hasPreparedPolicyPending(result, metrics)) return false;
  return true;
}

function isAutoUpdateQuantitiesCandidate(
  result: BomComparisonResult,
  resolved: ResolvedNomusComponent[],
  noIndusBom: boolean
): boolean {
  if (result.summary.missingProductInIndusCost || noIndusBom) return false;
  if (result.summary.onlyInNomus > 0 || result.summary.onlyInIndusCost > 0) return false;
  if (result.summary.quantityDiffs === 0) return false;
  return allNomusComponentsResolved(nomusComponentCodesFromComparison(result), resolved);
}

export function buildSuggestedNextStepText(classification: NomusBomClassification): string {
  switch (classification.recommendedAction) {
    case "NO_ACTION":
      return "BOM alinhada entre Nomus e IndusCost. Nenhuma ação necessária.";
    case "CREATE_OR_MAP_PARENT_PRODUCT_FIRST":
      return "Cadastre ou vincule o produto pai no IndusCost antes de aplicar a BOM Nomus.";
    case "IMPORT_PRODUCT_FROM_NOMUS_FIRST":
      return "Importe o produto do Nomus no IndusCost antes de planejar ou aplicar a BOM.";
    case "IMPORT_PRODUCT_AND_THEN_PLAN_BOM":
      return "Importe o produto Nomus e, após cadastro, revise o plano de criação da BOM.";
    case "KEEP_LOCAL_PRODUCT_DO_NOT_DELETE":
      return "Produto existe apenas no IndusCost — manter conforme regra oficial; não excluir automaticamente.";
    case "REVIEW_LOCAL_PRODUCT_WITHOUT_NOMUS_REFERENCE":
      return "Produto IndusCost sem referência Nomus no stage de BOM — revisar manualmente.";
    case "CREATE_OR_MAP_COMPONENTS_FIRST":
      return "Cadastre ou mapeie os componentes Nomus ausentes (Product/Material) antes de aplicar.";
    case "CAN_CREATE_BOM_FROM_NOMUS_AFTER_REVIEW":
      return "Após revisão de engenharia, a BOM Nomus pode ser criada no IndusCost (com aprovação).";
    case "CAN_UPDATE_QUANTITIES_AFTER_REVIEW":
      return "Após revisão, as quantidades da BOM IndusCost podem ser atualizadas a partir do Nomus.";
    case "CAN_REPLACE_BOM_AFTER_BACKUP_AND_APPROVAL":
      return "Faça backup da BOM atual e substitua somente após aprovação de engenharia.";
    case "MOVE_OPERATIONAL_ITEM_TO_ROUTING_OR_IGNORE":
      return "Revise itens operacionais (ex.: 800.xx montagem) — mover para roteiro ou manter fora da BOM.";
    case "REVIEW_PREPARED_COMPONENT_POLICY":
      return "Defina política para preparados 150.xx antes de qualquer aplicação automática.";
    case "REVIEW_KIT_OR_PACK_POLICY":
      return "Defina política para kits/pacotes/EAN antes de aplicar BOM de engenharia.";
    case "MANUAL_ENGINEERING_REVIEW_REQUIRED":
      return "Revisão manual de engenharia necessária antes de qualquer alteração.";
    case "BLOCKED_DO_NOT_APPLY":
      return "Não aplicar até resolver bloqueios indicados.";
    default:
      return classification.reasons[0] ?? "Revisar divergências.";
  }
}

export function classifyBomComparison(
  result: BomComparisonResult,
  options?: { resolvedNomusComponents?: ResolvedNomusComponent[] }
): NomusBomClassification {
  const resolved = options?.resolvedNomusComponents ?? [];
  const summary = result.summary;
  const noNomusBom = summary.nomusLines === 0;
  const noIndusBom = summary.indusLines === 0 && !summary.missingProductInIndusCost;

  const metrics: NomusBomClassification["metrics"] = {
    nomusLines: summary.nomusLines,
    indusLines: summary.indusLines,
    matches: summary.matches,
    quantityDiffs: summary.quantityDiffs,
    onlyInNomus: summary.onlyInNomus,
    onlyInIndusCost: summary.onlyInIndusCost,
    missingNomusComponentsCount: 0,
    operationalIndusItemsCount: 0,
    preparedComponentsCount: 0,
    kitOrPackIndicatorsCount: 0,
  };

  const issues = collectClassificationIssues(result, resolved, metrics);
  const reasons: string[] = [];

  let actionClass: NomusBomActionClass;
  let recommendedAction: NomusBomRecommendedAction;
  let riskLevel: NomusBomRiskLevel;
  let isBlocked = false;
  let isBlockedForBomApplication = false;
  let isProductImportCandidate = false;
  let canApplyWithApproval = false;

  const isOk =
    summary.status === "OK" &&
    summary.quantityDiffs === 0 &&
    summary.onlyInNomus === 0 &&
    summary.onlyInIndusCost === 0;

  if (isOk) {
    actionClass = "NO_ACTION_OK";
    recommendedAction = "NO_ACTION";
    riskLevel = "LOW";
    reasons.push("BOM Nomus e IndusCost estão alinhadas.");
  } else if (summary.ambiguousNomusList) {
    actionClass = "BLOCKED_AMBIGUOUS_NOMUS_LIST";
    recommendedAction = "MANUAL_ENGINEERING_REVIEW_REQUIRED";
    riskLevel = "BLOCKED";
    isBlocked = true;
    isBlockedForBomApplication = true;
    reasons.push("Lista Nomus ambígua — não aplicar até escolher lista efetiva.");
  } else if (noNomusBom && !summary.missingProductInIndusCost) {
    actionClass = "LOCAL_ONLY_REVIEW";
    recommendedAction = "REVIEW_LOCAL_PRODUCT_WITHOUT_NOMUS_REFERENCE";
    riskLevel = "MEDIUM";
    isBlocked = true;
    isBlockedForBomApplication = true;
    reasons.push(
      "Produto existe no IndusCost sem BOM Nomus no stage — manter; revisar referência Nomus."
    );
  } else if (noNomusBom) {
    actionClass = "BLOCKED_NO_NOMUS_BOM";
    recommendedAction = "BLOCKED_DO_NOT_APPLY";
    riskLevel = "BLOCKED";
    isBlocked = true;
    isBlockedForBomApplication = true;
    reasons.push("Sem BOM no stage Nomus para este produto pai.");
  } else if (summary.missingProductInIndusCost) {
    const hasResolvableBom =
      summary.nomusLines > 0 && metrics.missingNomusComponentsCount === 0;
    const isPrepared = hasPreparedPolicyPending(result, metrics);
    const isKit = hasKitOrPackPolicyPending(result, metrics);

    if (hasResolvableBom && !isPrepared && !isKit) {
      actionClass = "IMPORT_PRODUCT_THEN_CREATE_BOM_CANDIDATE";
      recommendedAction = "IMPORT_PRODUCT_AND_THEN_PLAN_BOM";
    } else {
      actionClass = "CREATE_PRODUCT_FROM_NOMUS_CANDIDATE";
      recommendedAction = "IMPORT_PRODUCT_FROM_NOMUS_FIRST";
    }

    isProductImportCandidate = true;
    isBlocked = true;
    isBlockedForBomApplication = true;
    riskLevel = isPrepared || isKit ? "BLOCKED" : "MEDIUM";
    canApplyWithApproval = false;
    reasons.push(
      "Produto existe no Nomus e ainda não existe no IndusCost; deve ser importado antes de aplicar BOM."
    );
    if (isPrepared) {
      reasons.push("Preparado 150.xx — política de mistura pendente antes da BOM.");
    }
    if (isKit) {
      reasons.push("Kit/pacote/EAN — política comercial/engenharia pendente antes da BOM.");
    }
  } else if (metrics.missingNomusComponentsCount > 0) {
    actionClass = "BLOCKED_MISSING_NOMUS_COMPONENT";
    recommendedAction = "CREATE_OR_MAP_COMPONENTS_FIRST";
    riskLevel = "BLOCKED";
    isBlocked = true;
    isBlockedForBomApplication = true;
    reasons.push(
      `${metrics.missingNomusComponentsCount} componente(s) Nomus sem cadastro Product/Material no IndusCost.`
    );
  } else if (isCreateBomCandidate(result, resolved, metrics, noIndusBom)) {
    actionClass = "CREATE_BOM_CANDIDATE";
    recommendedAction = "CAN_CREATE_BOM_FROM_NOMUS_AFTER_REVIEW";
    riskLevel = "MEDIUM";
    canApplyWithApproval = true;
    reasons.push("Produto existe, sem BOM IndusCost, componentes Nomus resolvidos.");
  } else if (isAutoUpdateQuantitiesCandidate(result, resolved, noIndusBom)) {
    actionClass = "AUTO_UPDATE_QUANTITIES_CANDIDATE";
    recommendedAction = "CAN_UPDATE_QUANTITIES_AFTER_REVIEW";
    riskLevel = "MEDIUM";
    canApplyWithApproval = true;
    reasons.push("Somente divergências de quantidade; estrutura alinhada.");
  } else if (
    summary.quantityDiffs > 0 &&
    (summary.onlyInNomus > 0 ||
      summary.onlyInIndusCost > 0 ||
      metrics.missingNomusComponentsCount > 0)
  ) {
    actionClass = "REVIEW_QUANTITY_DIFF";
    recommendedAction = "MANUAL_ENGINEERING_REVIEW_REQUIRED";
    riskLevel = "HIGH";
    reasons.push("Diferenças de quantidade combinadas com outros problemas estruturais.");
  } else if (summary.quantityDiffs > 0) {
    actionClass = "REVIEW_QUANTITY_DIFF";
    recommendedAction = "MANUAL_ENGINEERING_REVIEW_REQUIRED";
    riskLevel = "HIGH";
    reasons.push("Diferenças de quantidade exigem revisão antes de atualizar.");
  } else if (
    metrics.operationalIndusItemsCount > 0 &&
    metrics.operationalIndusItemsCount === summary.onlyInIndusCost &&
    summary.onlyInNomus === 0
  ) {
    actionClass = "REVIEW_INDUS_OPERATIONAL_ITEM";
    recommendedAction = "MOVE_OPERATIONAL_ITEM_TO_ROUTING_OR_IGNORE";
    riskLevel = "HIGH";
    reasons.push("Itens operacionais/montagem só no IndusCost — não remover automaticamente.");
  } else if (summary.onlyInNomus > 0 || summary.onlyInIndusCost > 0) {
    actionClass = "REVIEW_STRUCTURE_DIFF";
    recommendedAction =
      metrics.operationalIndusItemsCount > 0
        ? "CAN_REPLACE_BOM_AFTER_BACKUP_AND_APPROVAL"
        : "MANUAL_ENGINEERING_REVIEW_REQUIRED";
    riskLevel = "HIGH";
    reasons.push("Divergência estrutural (itens só Nomus e/ou só IndusCost).");
  } else {
    actionClass = "REVIEW_STRUCTURE_DIFF";
    recommendedAction = "MANUAL_ENGINEERING_REVIEW_REQUIRED";
    riskLevel = "HIGH";
    reasons.push("Divergência não classificada em candidato automático — revisar manualmente.");
  }

  if (
    hasPreparedPolicyPending(result, metrics) &&
    !isProductImportCandidate &&
    actionClass !== "LOCAL_ONLY_REVIEW"
  ) {
    if (!reasons.some((r) => r.includes("150"))) {
      reasons.push("Família preparados 150.xx — política pendente.");
    }
    if (riskLevel === "MEDIUM") riskLevel = "HIGH";
  }

  if (hasKitOrPackPolicyPending(result, metrics) && !isBlocked) {
    if (!reasons.some((r) => r.includes("kit"))) {
      reasons.push("Indicador de kit/pacote/EAN — política pendente.");
    }
    if (riskLevel === "MEDIUM") riskLevel = "HIGH";
  }

  if (metrics.operationalIndusItemsCount > 0 && actionClass === "REVIEW_STRUCTURE_DIFF") {
    recommendedAction = "MOVE_OPERATIONAL_ITEM_TO_ROUTING_OR_IGNORE";
  }

  const classification: NomusBomClassification = {
    parentCode: result.parentCode,
    parentDescription: result.parentDescription,
    indusProductId: result.indusProductId,
    indusProductName: result.indusProductName,
    actionClass,
    riskLevel,
    recommendedAction,
    canApplyAutomaticallyNow: false,
    canApplyWithApproval,
    isBlocked,
    isProductImportCandidate,
    isBlockedForBomApplication: isBlockedForBomApplication || isBlocked,
    reasons,
    issues,
    metrics,
    suggestedNextStepText: "",
  };

  classification.suggestedNextStepText = buildSuggestedNextStepText(classification);
  return classification;
}

export function classificationSeverityBonus(classification: NomusBomClassification): number {
  let bonus = 0;
  if (classification.isBlocked) bonus += 80;
  if (classification.riskLevel === "HIGH") bonus += 25;
  if (classification.metrics.preparedComponentsCount > 0) bonus += 15;
  if (classification.metrics.kitOrPackIndicatorsCount > 0) bonus += 15;
  if (classification.metrics.operationalIndusItemsCount > 0) bonus += 10;
  return bonus;
}

export function isReviewActionClass(actionClass: NomusBomActionClass): boolean {
  return REVIEW_ACTION_CLASSES.includes(actionClass);
}

export function isCandidateActionClass(actionClass: NomusBomActionClass): boolean {
  return CANDIDATE_ACTION_CLASSES.includes(actionClass);
}
