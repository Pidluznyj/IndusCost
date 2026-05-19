import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";
import type { NomusBomClassification, NomusBomRiskLevel, ResolvedNomusComponent } from "@/src/lib/nomusBomClassification";
import {
  detectOperationalItem,
  detectPreparedComponent,
  detectKitOrPack,
  NOMUS_PRODUCT_EXISTENCE_SOURCE,
} from "@/src/lib/nomusBomClassification";

export type NomusBomPlanActionType =
  | "IMPORT_PRODUCT"
  | "CREATE_BOM"
  | "UPDATE_BOM_QUANTITY"
  | "ADD_BOM_LINE"
  | "REMOVE_BOM_LINE"
  | "KEEP_INDUS_LINE"
  | "IGNORE_OPERATIONAL_ITEM"
  | "KEEP_LOCAL_PRODUCT"
  | "BLOCKED"
  | "NO_ACTION";

export type NomusBomPlanAction = {
  type: NomusBomPlanActionType;
  parentCode: string;
  parentDescription?: string | null;
  componentCode?: string | null;
  componentDescription?: string | null;
  currentQuantity?: number | null;
  plannedQuantity?: number | null;
  diff?: number | null;
  reason: string;
  riskLevel: NomusBomRiskLevel;
  requiresApproval: boolean;
  blockedReason?: string | null;
};

export type NomusBomApplyPlan = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  indusProductName?: string | null;

  classification: NomusBomClassification;

  mode: "DRY_RUN";
  canApplyNow: false;
  canApplyWithApproval: boolean;
  isBlocked: boolean;

  selectedNomusList?: {
    listaMateriaisId?: number | null;
    listaMateriaisNome?: string | null;
    listaMateriaisPadrao?: boolean | null;
    listaMateriaisPadraoBlocoK?: boolean | null;
    linesCount: number;
  } | null;

  actions: NomusBomPlanAction[];

  summary: {
    importProductActions: number;
    createBomActions: number;
    updateQuantityActions: number;
    addBomLineActions: number;
    removeBomLineActions: number;
    keepIndusLineActions: number;
    ignoreOperationalItemActions: number;
    blockedActions: number;
    noActionCount: number;
  };

  warnings: string[];
  limitations: string[];
};

function resolvedMap(resolved: ResolvedNomusComponent[]): Map<string, ResolvedNomusComponent> {
  return new Map(resolved.map((r) => [normalizeComponentCode(r.componentCode), r]));
}

function isComponentResolved(map: Map<string, ResolvedNomusComponent>, componentCode: string): boolean {
  const item = map.get(normalizeComponentCode(componentCode));
  return item != null && item.resolvedKind !== "NONE";
}

function summarizeActions(actions: NomusBomPlanAction[]): NomusBomApplyPlan["summary"] {
  const summary = {
    importProductActions: 0,
    createBomActions: 0,
    updateQuantityActions: 0,
    addBomLineActions: 0,
    removeBomLineActions: 0,
    keepIndusLineActions: 0,
    ignoreOperationalItemActions: 0,
    blockedActions: 0,
    noActionCount: 0,
  };

  for (const action of actions) {
    switch (action.type) {
      case "IMPORT_PRODUCT":
        summary.importProductActions += 1;
        break;
      case "CREATE_BOM":
        summary.createBomActions += 1;
        break;
      case "UPDATE_BOM_QUANTITY":
        summary.updateQuantityActions += 1;
        break;
      case "ADD_BOM_LINE":
        summary.addBomLineActions += 1;
        break;
      case "REMOVE_BOM_LINE":
        summary.removeBomLineActions += 1;
        break;
      case "KEEP_INDUS_LINE":
        summary.keepIndusLineActions += 1;
        break;
      case "IGNORE_OPERATIONAL_ITEM":
        summary.ignoreOperationalItemActions += 1;
        break;
      case "BLOCKED":
        summary.blockedActions += 1;
        break;
      case "NO_ACTION":
        summary.noActionCount += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

export function buildNomusBomApplyPlanForComparison(
  result: BomComparisonResult,
  classification: NomusBomClassification,
  resolved: ResolvedNomusComponent[] = []
): NomusBomApplyPlan {
  const actions: NomusBomPlanAction[] = [];
  const warnings: string[] = [];
  const limitations: string[] = [
    `Existência de produto no Nomus inferida por ${NOMUS_PRODUCT_EXISTENCE_SOURCE} (Product.sku no sync Nomus).`,
    "Produtos IndusCost-only (sem parentCode no stage) não são varridos neste lote — LOCAL_ONLY_KEEP fica para fase com catálogo Nomus confiável.",
    "Nenhuma ação REMOVE_BOM_LINE ou exclusão de produto é gerada nesta fase.",
  ];

  const resolvedByCode = resolvedMap(resolved);
  const parentCode = result.parentCode;
  const parentDescription = result.parentDescription;
  const risk = classification.riskLevel;

  const pushBlockedBom = (reason: string, componentCode?: string) => {
    actions.push({
      type: "BLOCKED",
      parentCode,
      parentDescription,
      componentCode: componentCode ?? null,
      reason,
      riskLevel: "BLOCKED",
      requiresApproval: false,
      blockedReason: reason,
    });
  };

  if (classification.isProductImportCandidate) {
    const isPrepared = detectPreparedComponent(parentCode, parentDescription);
    const isKit = detectKitOrPack(parentCode, parentDescription);

    actions.push({
      type: "IMPORT_PRODUCT",
      parentCode,
      parentDescription,
      reason:
        "Produto deve ser importado do Nomus antes de planejar BOM (dry-run — não cria Product nesta fase).",
      riskLevel: isPrepared || isKit ? "BLOCKED" : "MEDIUM",
      requiresApproval: true,
    });

    if (isPrepared) {
      warnings.push("Produto preparado 150.xx requer política de preparado/mistura antes de aplicar BOM.");
    }
    if (isKit) {
      warnings.push("Kit/pacote requer política comercial/engenharia antes da BOM.");
    }

    for (const line of result.lines) {
      if (line.nomusLineCount > 0) {
        pushBlockedBom(
          "BOM bloqueada até importação do produto pai no IndusCost.",
          line.componentCode
        );
      }
    }

    return finalizePlan(result, classification, actions, warnings, limitations);
  }

  if (
    classification.actionClass === "LOCAL_ONLY_REVIEW" ||
    classification.actionClass === "LOCAL_ONLY_KEEP"
  ) {
    actions.push({
      type: "KEEP_LOCAL_PRODUCT",
      parentCode,
      parentDescription,
      reason:
        "Produto IndusCost mantido — sem referência Nomus no stage ou política local-only.",
      riskLevel: "MEDIUM",
      requiresApproval: false,
    });
    return finalizePlan(result, classification, actions, warnings, limitations);
  }

  if (classification.isBlockedForBomApplication && classification.actionClass !== "CREATE_BOM_CANDIDATE") {
    if (classification.actionClass === "BLOCKED_MISSING_NOMUS_COMPONENT") {
      for (const line of result.lines) {
        if (line.status === "ONLY_IN_NOMUS" && !isComponentResolved(resolvedByCode, line.componentCode)) {
          pushBlockedBom(
            `Componente ${line.componentCode} não resolve para Product/Material no IndusCost.`,
            line.componentCode
          );
        }
      }
    } else {
      pushBlockedBom(classification.suggestedNextStepText || classification.reasons[0] || "Bloqueado.");
    }
    return finalizePlan(result, classification, actions, warnings, limitations);
  }

  const canPlanBom =
    !classification.isBlockedForBomApplication ||
    classification.actionClass === "CREATE_BOM_CANDIDATE" ||
    classification.actionClass === "AUTO_UPDATE_QUANTITIES_CANDIDATE";

  if (canPlanBom && classification.actionClass === "CREATE_BOM_CANDIDATE") {
    actions.push({
      type: "CREATE_BOM",
      parentCode,
      parentDescription,
      reason: "Planejamento de criação da BOM IndusCost a partir da lista Nomus efetiva.",
      riskLevel: "MEDIUM",
      requiresApproval: true,
    });
    for (const line of result.lines) {
      if (line.nomusLineCount === 0) continue;
      if (!isComponentResolved(resolvedByCode, line.componentCode)) {
        pushBlockedBom(
          `Componente ${line.componentCode} não cadastrado — bloqueia criação da linha.`,
          line.componentCode
        );
        continue;
      }
      actions.push({
        type: "ADD_BOM_LINE",
        parentCode,
        parentDescription,
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        currentQuantity: null,
        plannedQuantity: line.nomusQuantity,
        diff: line.nomusQuantity,
        reason: "Linha Nomus a incluir na BOM IndusCost após aprovação.",
        riskLevel: "MEDIUM",
        requiresApproval: true,
      });
    }
    return finalizePlan(result, classification, actions, warnings, limitations);
  }

  for (const line of result.lines) {
    const code = line.componentCode;

    if (line.status === "MATCH") {
      actions.push({
        type: "NO_ACTION",
        parentCode,
        componentCode: code,
        componentDescription: line.componentDescription,
        currentQuantity: line.indusQuantity,
        plannedQuantity: line.nomusQuantity,
        reason: "Quantidades alinhadas.",
        riskLevel: "LOW",
        requiresApproval: false,
      });
      continue;
    }

    if (line.status === "QUANTITY_DIFF") {
      if (classification.actionClass === "AUTO_UPDATE_QUANTITIES_CANDIDATE") {
        actions.push({
          type: "UPDATE_BOM_QUANTITY",
          parentCode,
          parentDescription,
          componentCode: code,
          componentDescription: line.componentDescription,
          currentQuantity: line.indusQuantity,
          plannedQuantity: line.nomusQuantity,
          diff: line.quantityDiff,
          reason: "Atualizar quantidade IndusCost para valor Nomus agregado.",
          riskLevel: "MEDIUM",
          requiresApproval: true,
        });
      } else {
        pushBlockedBom(
          "Diferença de quantidade exige revisão antes de atualizar.",
          code
        );
      }
      continue;
    }

    if (line.status === "ONLY_IN_NOMUS") {
      if (isComponentResolved(resolvedByCode, code)) {
        actions.push({
          type: "ADD_BOM_LINE",
          parentCode,
          parentDescription,
          componentCode: code,
          componentDescription: line.componentDescription,
          currentQuantity: null,
          plannedQuantity: line.nomusQuantity,
          diff: line.nomusQuantity,
          reason: "Componente só no Nomus — adicionar linha após aprovação.",
          riskLevel: "HIGH",
          requiresApproval: true,
        });
      } else {
        pushBlockedBom(`Componente ${code} não resolvido no IndusCost.`, code);
      }
      continue;
    }

    if (line.status === "ONLY_IN_INDUSCOST") {
      if (detectOperationalItem(code, line.componentDescription)) {
        actions.push({
          type: "IGNORE_OPERATIONAL_ITEM",
          parentCode,
          parentDescription,
          componentCode: code,
          componentDescription: line.componentDescription,
          currentQuantity: line.indusQuantity,
          reason:
            "Item local/operacional detectado (ex. montagem 800.xx) — manter até revisão de roteiro/processo.",
          riskLevel: "HIGH",
          requiresApproval: false,
        });
      } else {
        actions.push({
          type: "KEEP_INDUS_LINE",
          parentCode,
          parentDescription,
          componentCode: code,
          componentDescription: line.componentDescription,
          currentQuantity: line.indusQuantity,
          reason:
            "Linha existe apenas no IndusCost. Pela regra oficial, não remover automaticamente.",
          riskLevel: "HIGH",
          requiresApproval: false,
        });
        warnings.push(
          `Componente ${code}: somente IndusCost — mantido por política (sem DELETE).`
        );
      }
    }
  }

  if (detectPreparedComponent(parentCode, parentDescription)) {
    warnings.push("Preparado 150.xx — não aplicar BOM automaticamente sem política definida.");
  }
  if (detectKitOrPack(parentCode, parentDescription)) {
    warnings.push("Kit/pacote/EAN — não aplicar BOM automaticamente sem política definida.");
  }

  return finalizePlan(result, classification, actions, warnings, limitations);
}

function finalizePlan(
  result: BomComparisonResult,
  classification: NomusBomClassification,
  actions: NomusBomPlanAction[],
  warnings: string[],
  limitations: string[]
): NomusBomApplyPlan {
  const canApplyWithApproval =
    classification.canApplyWithApproval &&
    actions.some((a) => a.requiresApproval && a.type !== "BLOCKED" && a.type !== "IMPORT_PRODUCT");

  return {
    parentCode: result.parentCode,
    parentDescription: result.parentDescription,
    indusProductId: result.indusProductId,
    indusProductName: result.indusProductName,
    classification,
    mode: "DRY_RUN",
    canApplyNow: false,
    canApplyWithApproval,
    isBlocked: classification.isBlockedForBomApplication,
    selectedNomusList: result.selectedNomusList
      ? {
          listaMateriaisId: result.selectedNomusList.listaMateriaisId,
          listaMateriaisNome: result.selectedNomusList.listaMateriaisNome,
          listaMateriaisPadrao: result.selectedNomusList.listaMateriaisPadrao,
          listaMateriaisPadraoBlocoK: result.selectedNomusList.listaMateriaisPadraoBlocoK,
          linesCount: result.selectedNomusList.linesCount,
        }
      : null,
    actions,
    summary: summarizeActions(actions),
    warnings,
    limitations,
  };
}

export function aggregateApplyPlansSummary(plans: NomusBomApplyPlan[]) {
  const totals = {
    importProductActions: 0,
    createBomActions: 0,
    updateQuantityActions: 0,
    addBomLineActions: 0,
    keepIndusLineActions: 0,
    ignoreOperationalItemActions: 0,
    blockedActions: 0,
    noActionCount: 0,
    plansWithApproval: 0,
    blockedPlans: 0,
  };

  for (const plan of plans) {
    totals.importProductActions += plan.summary.importProductActions;
    totals.createBomActions += plan.summary.createBomActions;
    totals.updateQuantityActions += plan.summary.updateQuantityActions;
    totals.addBomLineActions += plan.summary.addBomLineActions;
    totals.keepIndusLineActions += plan.summary.keepIndusLineActions;
    totals.ignoreOperationalItemActions += plan.summary.ignoreOperationalItemActions;
    totals.blockedActions += plan.summary.blockedActions;
    totals.noActionCount += plan.summary.noActionCount;
    if (plan.canApplyWithApproval) totals.plansWithApproval += 1;
    if (plan.isBlocked) totals.blockedPlans += 1;
  }

  return totals;
}
