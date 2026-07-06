/**
 * Plano de Ação de Equalização por produto — read-only.
 *
 * Fase NOMUS-ENGINEERING-EQUALIZATION-WORKFLOW-A.
 * - Orquestra libs read-only existentes (comparison, classification, apply plan,
 *   effective BOM, cost impact, import preview) para entregar um plano único
 *   por produto, em linguagem humana.
 * - NÃO grava nada — não chama create/update/delete/upsert/$transaction.
 * - NÃO executa apply real.
 * - NÃO altera ProductBOM, Product, Material, preço, proposta, pedido ou
 *   ProductCostingMode.
 */

import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  resolveNomusComponentCodes,
} from "@/src/lib/nomusBomComparisonLoad";
import {
  classifyBomComparison,
  type NomusBomActionClass,
  type NomusBomRiskLevel,
} from "@/src/lib/nomusBomClassification";
import { buildNomusBomApplyPlanForComparison } from "@/src/lib/nomusBomApplyPlan";
import { enrichNomusBomApplyPlanWithOptionalSelection } from "@/src/lib/nomusOptionalPricingSelection";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import { buildNomusEffectiveBomCostImpact } from "@/src/lib/nomusEffectiveBomCostImpact";
import { buildNomusProductImportSimulationPreview } from "@/src/lib/nomusProductImportSimulation";
import type {
  CockpitOperatorStatus,
  CockpitSeverity,
} from "@/src/lib/nomusEngineeringOperationsCockpitTypes";
import type {
  ActionPlanApplyPreviewSummary,
  ActionPlanCostImpactSummary,
  ActionPlanImportPreviewSummary,
  ActionPlanLocalExceptionSummary,
  ActionPlanNextAction,
  ActionPlanOptionalSummary,
  ActionPlanReadiness,
  ActionPlanStep,
  ActionPlanTargetTab,
  EngineeringEqualizationActionPlanResult,
} from "@/src/lib/nomusEngineeringEqualizationActionPlanTypes";
import {
  nextActionLabelFor,
  readinessLabelFor,
  targetTabFor,
} from "@/src/lib/nomusEngineeringEqualizationActionPlanShared";

const OPERATOR_STATUS_LABEL: Record<CockpitOperatorStatus, string> = {
  OK: "Sem alteração",
  READY: "Pronto para revisar",
  REVIEW: "Precisa análise",
  BLOCKED: "Bloqueado",
  NEW: "Produto novo",
  LOCAL: "Tem item local",
  OPTIONAL: "Escolha opcional pendente",
  AMBIGUOUS: "Código ambíguo",
};

function isAssemblyLocalCode(componentCode: string): boolean {
  return normalizeComponentCode(componentCode).startsWith("800.");
}

function mapActionClassToOperatorStatus(
  actionClass: NomusBomActionClass | null | undefined,
  context: {
    hasOptionalPending: boolean;
    hasAmbiguity: boolean;
    hasAssemblyLocal: boolean;
    hasLocalKeep: boolean;
    isNewProduct: boolean;
  }
): CockpitOperatorStatus {
  if (context.isNewProduct) return "NEW";
  if (context.hasOptionalPending) return "OPTIONAL";
  if (context.hasAmbiguity) return "AMBIGUOUS";

  switch (actionClass) {
    case "NO_ACTION_OK":
      return "OK";
    case "AUTO_APPLY_CANDIDATE":
    case "AUTO_UPDATE_QUANTITIES_CANDIDATE":
    case "CREATE_BOM_CANDIDATE":
      return "READY";
    case "CREATE_PRODUCT_FROM_NOMUS_CANDIDATE":
    case "IMPORT_PRODUCT_THEN_CREATE_BOM_CANDIDATE":
      return "NEW";
    case "LOCAL_ONLY_KEEP":
    case "LOCAL_ONLY_REVIEW":
      return "LOCAL";
    case "REVIEW_STRUCTURE_DIFF":
    case "REVIEW_QUANTITY_DIFF":
    case "REVIEW_INDUS_OPERATIONAL_ITEM":
    case "REVIEW_PREPARED_COMPONENT":
    case "REVIEW_KIT_OR_PACK":
      return "REVIEW";
    case "REVIEW_OPTIONAL_PRICING_SELECTION":
    case "BLOCKED_OPTIONAL_SELECTION_REQUIRED":
      return "OPTIONAL";
    case "BLOCKED_MISSING_PARENT_PRODUCT":
    case "BLOCKED_MISSING_NOMUS_COMPONENT":
    case "BLOCKED_AMBIGUOUS_NOMUS_LIST":
    case "BLOCKED_NO_NOMUS_BOM":
      return "BLOCKED";
    default:
      if (context.hasLocalKeep) return "LOCAL";
      return "REVIEW";
  }
}

function mapRiskToSeverity(
  risk: NomusBomRiskLevel | null | undefined,
  operatorStatus: CockpitOperatorStatus
): CockpitSeverity {
  if (operatorStatus === "BLOCKED") return "BLOCKED";
  if (operatorStatus === "OK") return "LOW";
  if (risk === "BLOCKED") return "BLOCKED";
  if (risk === "HIGH") return "HIGH";
  if (risk === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function summarySentence(input: {
  parentCode: string;
  productName: string | null;
  existsInIndusCost: boolean;
  existsInNomusStage: boolean;
  operatorStatusLabel: string;
  hasStructuralChanges: boolean;
  hasAssemblyLocal: boolean;
  costingMode: string | null;
}): string {
  const head = input.productName
    ? `${input.parentCode} — ${input.productName}`
    : input.parentCode;
  const parts: string[] = [head];

  if (!input.existsInNomusStage) {
    parts.push("não encontrado no stage Nomus.");
    return parts.join(" · ");
  }
  if (!input.existsInIndusCost) {
    parts.push("produto novo no Nomus, ainda não cadastrado no IndusCost.");
    return parts.join(" · ");
  }

  parts.push(`status: ${input.operatorStatusLabel}.`);
  if (!input.hasStructuralChanges) {
    parts.push("A ProductBOM já reflete a BOM efetiva — não há diferença estrutural.");
  } else {
    parts.push("Há diferenças estruturais entre Nomus e IndusCost — revisar antes de aplicar.");
  }
  if (input.hasAssemblyLocal) {
    parts.push("Possui montagem local (800.xx) que será preservada.");
  }
  if (input.costingMode === "FINISHING_SERVICE") {
    parts.push(
      "Produto configurado como acabamento/beneficiamento — processo próprio é ignorado no custo."
    );
  } else if (input.costingMode === "BOM_ONLY") {
    parts.push(
      "Produto configurado como somente BOM — processo próprio é ignorado no custo."
    );
  }
  return parts.join(" · ");
}

function buildSteps(input: {
  existsInNomusStage: boolean;
  existsInIndusCost: boolean;
  actionClass: NomusBomActionClass | null;
  hasOptionalPending: boolean;
  hasMissingMaterial: boolean;
  hasMissingChildProduct: boolean;
  hasAssemblyLocal: boolean;
  hasStructuralChanges: boolean;
  canApplyWithApproval: boolean;
  isBlocked: boolean;
}): ActionPlanStep[] {
  const steps: ActionPlanStep[] = [];

  steps.push({
    key: "PRODUCT_EXISTS",
    label: "Produto cadastrado no IndusCost",
    status: input.existsInIndusCost ? "DONE" : "PENDING",
    description: input.existsInIndusCost
      ? "Produto já existe no IndusCost."
      : "Produto novo no Nomus — precisa ser importado pelo fluxo controlado.",
    actionLabel: input.existsInIndusCost ? undefined : "Abrir importação do produto",
    targetTab: input.existsInIndusCost ? undefined : "product-import",
  });

  if (input.existsInIndusCost) {
    steps.push({
      key: "BOM_COMPARISON",
      label: "Comparação BOM Nomus × IndusCost",
      status: input.hasStructuralChanges ? "REVIEW" : "DONE",
      description: input.hasStructuralChanges
        ? "Estrutura/quantidade diferente entre Nomus e IndusCost. Abrir BOM efetiva para conferir."
        : "Sem diferenças estruturais entre Nomus e IndusCost.",
      actionLabel: input.hasStructuralChanges ? "Ver BOM efetiva" : undefined,
      targetTab: input.hasStructuralChanges ? "effective-pricing-bom" : undefined,
    });
  }

  if (input.hasOptionalPending) {
    steps.push({
      key: "OPTIONAL_SELECTION",
      label: "Escolha opcional pendente",
      status: "PENDING",
      description:
        "Há componentes opcionais Nomus — selecionar qual entra no custo antes de aplicar.",
      actionLabel: "Abrir opcionais",
      targetTab: "pending",
    });
  }

  if (input.hasMissingMaterial) {
    steps.push({
      key: "MATERIAL_MAPPING",
      label: "Mapear / cadastrar material",
      status: "BLOCKED",
      description:
        "Há componente Nomus sem cadastro como Material no IndusCost. Mapear/cadastrar antes de continuar.",
      actionLabel: "Ver diagnóstico técnico",
      targetTab: "diagnostic",
    });
  }

  if (input.hasMissingChildProduct) {
    steps.push({
      key: "CHILD_PRODUCT_IMPORT",
      label: "Importar componente filho",
      status: "BLOCKED",
      description:
        "Há componente que é produto e ainda não existe no IndusCost. Importar o componente antes de aplicar.",
      actionLabel: "Abrir importação do produto",
      targetTab: "product-import",
    });
  }

  if (input.hasAssemblyLocal) {
    steps.push({
      key: "LOCAL_ASSEMBLY",
      label: "Montagem local preservada",
      status: "DONE",
      description:
        "Produto possui linha 800.xx (Montagem). Item local é preservado — não é removido pelo Nomus.",
    });
  }

  if (input.existsInIndusCost && input.hasStructuralChanges) {
    steps.push({
      key: "COST_IMPACT",
      label: "Revisar impacto de custo",
      status: "REVIEW",
      description:
        "Há mudanças estruturais — abrir o Impacto de Custo para entender a diferença prevista.",
      actionLabel: "Ver impacto de custo",
      targetTab: "cost-impact",
    });
  }

  if (input.existsInIndusCost) {
    if (input.canApplyWithApproval) {
      steps.push({
        key: "APPLY_PLAN",
        label: "Revisar plano de aplicação",
        status: "REVIEW",
        description:
          "Há um plano de aplicação disponível. Revisar e aplicar manualmente, produto a produto, na aba Plano de aplicação.",
        actionLabel: "Abrir plano de aplicação",
        targetTab: "apply-plan",
      });
    } else if (!input.hasStructuralChanges && !input.isBlocked) {
      steps.push({
        key: "APPLY_PLAN",
        label: "Plano de aplicação",
        status: "NOT_REQUIRED",
        description:
          "A ProductBOM já reflete a BOM efetiva — nenhuma aplicação necessária neste produto.",
      });
    } else if (input.isBlocked) {
      steps.push({
        key: "APPLY_PLAN",
        label: "Plano de aplicação",
        status: "BLOCKED",
        description:
          "Aplicação bloqueada — resolver pendências (material/filho/opcional) antes de continuar.",
      });
    }
  }

  return steps;
}

function deriveReadinessAndAction(input: {
  existsInNomusStage: boolean;
  existsInIndusCost: boolean;
  operatorStatus: CockpitOperatorStatus;
  actionClass: NomusBomActionClass | null;
  isBlocked: boolean;
  canApplyWithApproval: boolean;
  hasStructuralChanges: boolean;
  hasOptionalPending: boolean;
  hasMissingMaterial: boolean;
  hasMissingChildProduct: boolean;
}): { readiness: ActionPlanReadiness; nextAction: ActionPlanNextAction } {
  if (!input.existsInNomusStage) {
    return {
      readiness: "NEEDS_ENGINEERING_REVIEW",
      nextAction: "OPEN_TECHNICAL_DIAGNOSTIC",
    };
  }

  if (!input.existsInIndusCost) {
    return {
      readiness: "NEEDS_PRODUCT_IMPORT",
      nextAction: "OPEN_PRODUCT_IMPORT",
    };
  }

  if (input.hasMissingChildProduct) {
    return {
      readiness: "NEEDS_CHILD_PRODUCT_IMPORT",
      nextAction: "IMPORT_CHILD_PRODUCT",
    };
  }

  if (input.hasMissingMaterial) {
    return {
      readiness: "NEEDS_MATERIAL_MAPPING",
      nextAction: "MAP_MATERIAL",
    };
  }

  if (input.hasOptionalPending) {
    return {
      readiness: "NEEDS_OPTIONAL_SELECTION",
      nextAction: "OPEN_OPTIONAL_SELECTION",
    };
  }

  if (input.actionClass === "BLOCKED_AMBIGUOUS_NOMUS_LIST") {
    return {
      readiness: "NEEDS_ENGINEERING_REVIEW",
      nextAction: "ASK_ENGINEERING_REVIEW",
    };
  }

  if (input.isBlocked) {
    return {
      readiness: "BLOCKED",
      nextAction: "OPEN_TECHNICAL_DIAGNOSTIC",
    };
  }

  if (!input.hasStructuralChanges) {
    return {
      readiness: "NO_ACTION_REQUIRED",
      nextAction: "NONE",
    };
  }

  if (input.canApplyWithApproval) {
    return {
      readiness: "READY_FOR_CONTROLLED_APPLY",
      nextAction: "OPEN_APPLY_PLAN",
    };
  }

  return {
    readiness: "READY_FOR_MANUAL_REVIEW",
    nextAction: "OPEN_EFFECTIVE_BOM",
  };
}

async function loadParentDescription(parentCode: string): Promise<string | null> {
  const row = await prisma.nomusBomComponentStage.findFirst({
    where: {
      OR: [
        { parentCode: parentCode },
        { parentCode: normalizeSku(parentCode) },
      ],
    },
    select: { parentDescription: true },
  });
  return row?.parentDescription ?? null;
}

async function loadProductInfo(parentCode: string): Promise<{
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  costingMode: "OWN_PROCESS" | "BOM_ONLY" | "FINISHING_SERVICE" | null;
}> {
  const trimmed = parentCode.trim();
  const norm = normalizeSku(trimmed);
  const product = await prisma.product.findFirst({
    where: {
      OR: [{ sku: trimmed }, { sku: norm }],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      costingMode: true,
    },
  });
  if (!product) {
    return { productId: null, productName: null, productSku: null, costingMode: null };
  }
  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    costingMode: product.costingMode as
      | "OWN_PROCESS"
      | "BOM_ONLY"
      | "FINISHING_SERVICE",
  };
}

export type BuildEngineeringEqualizationActionPlanInput = {
  parentCode: string;
  includeCostImpact?: boolean;
  includeApplyPreview?: boolean;
  includeImportPreview?: boolean;
};

export async function buildNomusEngineeringEqualizationActionPlan(
  input: BuildEngineeringEqualizationActionPlanInput
): Promise<EngineeringEqualizationActionPlanResult> {
  const generatedAt = new Date().toISOString();
  const trimmed = input.parentCode.trim();
  if (!trimmed) {
    throw new Error("parentCode é obrigatório.");
  }

  const includeApplyPreview = input.includeApplyPreview !== false;
  const includeCostImpact = input.includeCostImpact !== false;
  // Por padrão, só calcula import preview quando produto for novo (resolvido abaixo).
  const explicitImportPreview = input.includeImportPreview;

  const [parentDescription, product] = await Promise.all([
    loadParentDescription(trimmed),
    loadProductInfo(trimmed),
  ]);

  // Detecta existência no stage Nomus.
  const stageCount = await prisma.nomusBomComponentStage.count({
    where: {
      OR: [{ parentCode: trimmed }, { parentCode: normalizeSku(trimmed) }],
    },
  });
  const existsInNomusStage = stageCount > 0;
  const existsInIndusCost = product.productId != null;

  if (!existsInNomusStage && !existsInIndusCost) {
    // Produto fora dos dois universos — devolve plano informativo, sem crash.
    return {
      mode: "READ_ONLY",
      generatedAt,
      parentCode: trimmed,
      parentDescription: null,
      product,
      existsInIndusCost,
      existsInNomusStage,
      operatorStatus: "BLOCKED",
      operatorStatusLabel: "Não encontrado",
      severity: "BLOCKED",
      summary: `${trimmed} não foi encontrado nem no stage Nomus nem no IndusCost.`,
      readiness: "ERROR",
      readinessLabel: readinessLabelFor("ERROR"),
      nextRecommendedAction: "OPEN_TECHNICAL_DIAGNOSTIC",
      nextRecommendedActionLabel: nextActionLabelFor("OPEN_TECHNICAL_DIAGNOSTIC"),
      nextRecommendedActionTargetTab: targetTabFor("OPEN_TECHNICAL_DIAGNOSTIC"),
      canProceedManually: false,
      requiresHumanDecision: true,
      blockers: ["Produto não encontrado no stage Nomus."],
      warnings: [],
      steps: [
        {
          key: "PRODUCT_EXISTS",
          label: "Produto cadastrado no IndusCost",
          status: "BLOCKED",
          description: "Produto não foi localizado em nenhum dos lados.",
        },
      ],
      technicalRefs: {
        cockpitRowAvailable: false,
        costImpactAvailable: false,
        applyPreviewAvailable: false,
        importPreviewAvailable: false,
        effectiveBomAvailable: false,
      },
      costImpactSummary: null,
      applyPreviewSummary: null,
      importPreviewSummary: null,
      localExceptionSummary: {
        hasAssemblyLocal: false,
        hasLocalKeep: false,
        assemblyLocalLines: [],
      },
      optionalSummary: { status: "UNKNOWN", hasOptionalPending: false },
    };
  }

  // BOM efetiva — fonte canônica para detectar 800.xx preservado.
  let effectiveBom: Awaited<ReturnType<typeof buildEffectivePricingBomForParentCode>> | null =
    null;
  let effectiveBomError: string | null = null;
  if (existsInNomusStage) {
    try {
      effectiveBom = await buildEffectivePricingBomForParentCode(trimmed, {
        recursive: false,
      });
    } catch (err) {
      effectiveBomError = err instanceof Error ? err.message : String(err);
    }
  }

  const assemblyLocalLines: ActionPlanLocalExceptionSummary["assemblyLocalLines"] = [];
  let hasAssemblyLocal = false;
  let hasLocalKeep = false;
  if (effectiveBom) {
    for (const line of effectiveBom.directLines) {
      if (isAssemblyLocalCode(line.componentCode)) {
        hasAssemblyLocal = true;
        assemblyLocalLines.push({
          componentCode: line.componentCode,
          componentDescription: line.componentDescription ?? null,
          quantity: line.quantity ?? null,
        });
      }
      if (typeof line.source === "string" && line.source.startsWith("LOCAL_ONLY_")) {
        hasLocalKeep = true;
      }
    }
  }

  // Comparação + classificação (sempre disponíveis quando há stage Nomus).
  let actionClass: NomusBomActionClass | null = null;
  let riskLevel: NomusBomRiskLevel | null = null;
  let isBlocked = false;
  let canApplyWithApproval = false;
  let hasStructuralChanges = false;
  let hasOptionalPending = false;
  let optionalStatus: ActionPlanOptionalSummary["status"] = "UNKNOWN";
  let classificationReasons: string[] = [];
  let applyPreviewSummary: ActionPlanApplyPreviewSummary | null = null;

  if (existsInNomusStage && includeApplyPreview) {
    try {
      const comparison = await buildBomComparisonForParentCode(trimmed);
      const componentCodes = comparison.lines
        .filter((l) => l.nomusLineCount > 0)
        .map((l) => l.componentCode);
      const resolved = await resolveNomusComponentCodes(componentCodes);
      const classification = classifyBomComparison(comparison, {
        resolvedNomusComponents: resolved,
      });
      const rawPlan = buildNomusBomApplyPlanForComparison(
        comparison,
        classification,
        resolved
      );
      const plan = await enrichNomusBomApplyPlanWithOptionalSelection(rawPlan);

      actionClass = classification.actionClass;
      riskLevel = classification.riskLevel;
      isBlocked = classification.isBlocked;
      canApplyWithApproval = classification.canApplyWithApproval;
      classificationReasons = classification.reasons;

      hasStructuralChanges =
        comparison.summary.onlyInNomus > 0 ||
        comparison.summary.onlyInIndusCost > 0 ||
        comparison.summary.quantityDiffs > 0 ||
        comparison.summary.missingProductInIndusCost;

      hasOptionalPending =
        classification.actionClass === "REVIEW_OPTIONAL_PRICING_SELECTION" ||
        classification.actionClass === "BLOCKED_OPTIONAL_SELECTION_REQUIRED" ||
        plan.optionalPricingStatus === "PENDING" ||
        plan.optionalPricingStatus === "STALE";

      optionalStatus = (plan.optionalPricingStatus ?? "UNKNOWN") as ActionPlanOptionalSummary["status"];

      const totalActions = plan.actions.length;
      applyPreviewSummary = {
        actionClass: String(classification.actionClass),
        riskLevel: String(classification.riskLevel),
        canApplyWithApproval: classification.canApplyWithApproval,
        isBlocked: classification.isBlocked,
        isProductImportCandidate: classification.isProductImportCandidate,
        optionalPricingStatus: plan.optionalPricingStatus ?? null,
        importProductActions: plan.summary.importProductActions,
        createBomActions: plan.summary.createBomActions,
        updateQuantityActions: plan.summary.updateQuantityActions,
        addBomLineActions: plan.summary.addBomLineActions,
        removeBomLineActions: plan.summary.removeBomLineActions,
        keepIndusLineActions: plan.summary.keepIndusLineActions,
        ignoreOperationalItemActions: plan.summary.ignoreOperationalItemActions,
        blockedActions: plan.summary.blockedActions,
        noActionCount: plan.summary.noActionCount,
        optionalSelectionRequiredActions: plan.summary.optionalSelectionRequiredActions,
        optionalItemNotAutoAppliedActions: plan.summary.optionalItemNotAutoAppliedActions,
        totalActions,
        reasons: classification.reasons.slice(0, 8),
      };
    } catch (err) {
      classificationReasons.push(
        `Falha ao montar plano: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const hasMissingMaterial = actionClass === "BLOCKED_MISSING_NOMUS_COMPONENT";
  const hasMissingChildProduct = actionClass === "BLOCKED_MISSING_PARENT_PRODUCT";
  const hasAmbiguity = actionClass === "BLOCKED_AMBIGUOUS_NOMUS_LIST";

  // Impacto de custo (opcional).
  let costImpactSummary: ActionPlanCostImpactSummary | null = null;
  if (existsInIndusCost && existsInNomusStage && includeCostImpact && !hasMissingMaterial && !hasMissingChildProduct) {
    try {
      const impact = await buildNomusEffectiveBomCostImpact(trimmed);
      costImpactSummary = {
        hasStructuralChanges: impact.hasStructuralChanges,
        deltaTotalCost: impact.delta?.totalCost ?? null,
        deltaMaterialCost: impact.delta?.materialCost ?? null,
        impactStatus: String(impact.status),
        optionalPricingStatus: String(impact.optionalPricingStatus),
        effectiveBomStatus: String(impact.effectiveBomStatus),
        noOpReason: impact.noOpReason ?? null,
        warnings: impact.warnings ?? [],
      };
      // Se a fonte canônica disse que não há mudanças estruturais, normalizamos.
      if (impact.hasStructuralChanges === false) {
        hasStructuralChanges = false;
      }
    } catch (err) {
      classificationReasons.push(
        `Falha ao montar impacto de custo: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Import preview (apenas quando faz sentido).
  const shouldComputeImportPreview =
    explicitImportPreview ?? (!existsInIndusCost && existsInNomusStage);
  let importPreviewSummary: ActionPlanImportPreviewSummary | null = null;
  if (shouldComputeImportPreview) {
    try {
      const preview = await buildNomusProductImportSimulationPreview({
        parentCode: trimmed,
        recursive: false,
      });
      importPreviewSummary = {
        productProposedAction: String(preview.productAction.proposedAction),
        productReason: preview.productAction.reason,
        isBlocked: preview.blockingReasons.length > 0,
        blockingReasons: preview.blockingReasons,
        warnings: preview.warnings,
        engineeringPending: preview.engineeringPending,
      };
    } catch (err) {
      classificationReasons.push(
        `Falha ao montar pré-visualização de importação: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const operatorStatus = mapActionClassToOperatorStatus(actionClass, {
    hasOptionalPending,
    hasAmbiguity,
    hasAssemblyLocal,
    hasLocalKeep,
    isNewProduct: existsInNomusStage && !existsInIndusCost,
  });
  const operatorStatusLabel = OPERATOR_STATUS_LABEL[operatorStatus];
  const severity = mapRiskToSeverity(riskLevel, operatorStatus);

  const { readiness, nextAction } = deriveReadinessAndAction({
    existsInNomusStage,
    existsInIndusCost,
    operatorStatus,
    actionClass,
    isBlocked,
    canApplyWithApproval,
    hasStructuralChanges,
    hasOptionalPending,
    hasMissingMaterial,
    hasMissingChildProduct,
  });

  const steps = buildSteps({
    existsInNomusStage,
    existsInIndusCost,
    actionClass,
    hasOptionalPending,
    hasMissingMaterial,
    hasMissingChildProduct,
    hasAssemblyLocal,
    hasStructuralChanges,
    canApplyWithApproval,
    isBlocked,
  });

  const blockers: string[] = [];
  if (isBlocked) {
    blockers.push(...classificationReasons.slice(0, 5));
  }
  if (hasMissingMaterial) {
    blockers.push("Material faltante no IndusCost — cadastrar/mapear antes de aplicar.");
  }
  if (hasMissingChildProduct) {
    blockers.push("Produto filho faltante — importar componente antes de aplicar.");
  }
  if (hasAmbiguity) {
    blockers.push("Código ambíguo (existe como Produto e Material) — decidir manualmente.");
  }

  const warnings: string[] = [];
  if (effectiveBomError) {
    warnings.push(`Não foi possível carregar a BOM efetiva: ${effectiveBomError}`);
  }
  if (costImpactSummary?.warnings?.length) {
    warnings.push(...costImpactSummary.warnings.slice(0, 5));
  }

  const summary = summarySentence({
    parentCode: trimmed,
    productName: product.productName,
    existsInIndusCost,
    existsInNomusStage,
    operatorStatusLabel,
    hasStructuralChanges,
    hasAssemblyLocal,
    costingMode: product.costingMode,
  });

  const technicalRefs = {
    cockpitRowAvailable: existsInNomusStage,
    costImpactAvailable: costImpactSummary != null,
    applyPreviewAvailable: applyPreviewSummary != null,
    importPreviewAvailable: importPreviewSummary != null,
    effectiveBomAvailable: effectiveBom != null,
  };

  const canProceedManually =
    !isBlocked &&
    !hasMissingMaterial &&
    !hasMissingChildProduct &&
    (readiness === "READY_FOR_CONTROLLED_APPLY" ||
      readiness === "READY_FOR_MANUAL_REVIEW" ||
      readiness === "NO_ACTION_REQUIRED");

  const requiresHumanDecision =
    readiness !== "NO_ACTION_REQUIRED" && readiness !== "ERROR";

  const targetTab: ActionPlanTargetTab | null = targetTabFor(nextAction);

  return {
    mode: "READ_ONLY",
    generatedAt,
    parentCode: trimmed,
    parentDescription,
    product,
    existsInIndusCost,
    existsInNomusStage,

    operatorStatus,
    operatorStatusLabel,
    severity,

    summary,
    readiness,
    readinessLabel: readinessLabelFor(readiness),

    nextRecommendedAction: nextAction,
    nextRecommendedActionLabel: nextActionLabelFor(nextAction),
    nextRecommendedActionTargetTab: targetTab,

    canProceedManually,
    requiresHumanDecision,

    blockers,
    warnings,

    steps,

    technicalRefs,

    costImpactSummary,
    applyPreviewSummary,
    importPreviewSummary,
    localExceptionSummary: {
      hasAssemblyLocal,
      hasLocalKeep,
      assemblyLocalLines,
    },
    optionalSummary: {
      status: optionalStatus,
      hasOptionalPending,
    },
  };
}
