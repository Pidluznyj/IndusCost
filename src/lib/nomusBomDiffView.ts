import type { BomComparisonStatus } from "@/src/lib/nomusBomComparison";
import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";
import type { NomusBomApplyPlan, NomusBomPlanAction, NomusBomPlanActionType } from "@/src/lib/nomusBomApplyPlan";

export type NomusBomDiffRow = {
  componentCode: string;
  componentDescription?: string | null;
  comparisonStatus: BomComparisonStatus | null;
  indusQuantity: number | null;
  nomusQuantity: number | null;
  quantityDiff: number | null;
  planActionType: NomusBomPlanActionType | null;
  planDecisionLabel: string;
  observation: string;
  hasDuplicateNomusLines: boolean;
  hasDuplicateIndusLines: boolean;
  hasOptionalNomusLines: boolean;
  hasAlternativeNomusLines: boolean;
  hasPreferredNomusLines: boolean;
  hasShipmentItemNomusLines: boolean;
};

const ACTION_PRIORITY: Record<NomusBomPlanActionType, number> = {
  BLOCKED: 10,
  IMPORT_PRODUCT: 9,
  OPTIONAL_SELECTION_REQUIRED: 9,
  OPTIONAL_ITEM_NOT_AUTO_APPLIED: 9,
  REMOVE_BOM_LINE: 8,
  IGNORE_OPERATIONAL_ITEM: 7,
  KEEP_INDUS_LINE: 6,
  ADD_BOM_LINE: 5,
  UPDATE_BOM_QUANTITY: 4,
  CREATE_BOM: 3,
  KEEP_LOCAL_PRODUCT: 2,
  NO_ACTION: 1,
};

export function planActionTypeLabel(type: NomusBomPlanActionType | null): string {
  switch (type) {
    case "NO_ACTION":
      return "Sem alteração";
    case "UPDATE_BOM_QUANTITY":
      return "Atualizar quantidade (futuro)";
    case "ADD_BOM_LINE":
      return "Adicionar linha (futuro)";
    case "KEEP_INDUS_LINE":
      return "Manter linha local";
    case "IGNORE_OPERATIONAL_ITEM":
      return "Item operacional — manter";
    case "IMPORT_PRODUCT":
      return "Importar produto primeiro";
    case "CREATE_BOM":
      return "Criar BOM (futuro)";
    case "OPTIONAL_SELECTION_REQUIRED":
      return "Seleção opcional necessária";
    case "OPTIONAL_ITEM_NOT_AUTO_APPLIED":
      return "Opcional — não auto na precificação";
    case "BLOCKED":
      return "Bloqueado";
    case "KEEP_LOCAL_PRODUCT":
      return "Manter produto local";
    case "REMOVE_BOM_LINE":
      return "Remover linha (não planejado)";
    default:
      return "—";
  }
}

export function planActionBadgeClass(type: NomusBomPlanActionType | null): string {
  switch (type) {
    case "NO_ACTION":
      return "bg-green-100 text-green-800";
    case "UPDATE_BOM_QUANTITY":
      return "bg-amber-100 text-amber-900";
    case "ADD_BOM_LINE":
    case "CREATE_BOM":
    case "IMPORT_PRODUCT":
      return "bg-blue-100 text-blue-900";
    case "OPTIONAL_SELECTION_REQUIRED":
    case "OPTIONAL_ITEM_NOT_AUTO_APPLIED":
      return "bg-fuchsia-100 text-fuchsia-950";
    case "KEEP_INDUS_LINE":
      return "bg-slate-100 text-slate-800";
    case "IGNORE_OPERATIONAL_ITEM":
      return "bg-violet-100 text-violet-900";
    case "BLOCKED":
      return "bg-red-100 text-red-900";
    case "KEEP_LOCAL_PRODUCT":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function nomusLineFlagBadgeClass(flag: "optional" | "alternative" | "preferred" | "shipment"): string {
  switch (flag) {
    case "optional":
      return "bg-fuchsia-100 text-fuchsia-900";
    case "alternative":
      return "bg-indigo-100 text-indigo-900";
    case "preferred":
      return "bg-teal-100 text-teal-900";
    case "shipment":
      return "bg-cyan-100 text-cyan-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function nomusLineFlagLabel(flag: "optional" | "alternative" | "preferred" | "shipment"): string {
  switch (flag) {
    case "optional":
      return "Opcional";
    case "alternative":
      return "Alternativo";
    case "preferred":
      return "Preferencial";
    case "shipment":
      return "Item de embarque";
    default:
      return "";
  }
}

export function comparisonStatusLabel(status: BomComparisonStatus | null): string {
  switch (status) {
    case "MATCH":
      return "Igual";
    case "QUANTITY_DIFF":
      return "Qtd. diferente";
    case "ONLY_IN_NOMUS":
      return "Só Nomus";
    case "ONLY_IN_INDUSCOST":
      return "Só IndusCost";
    default:
      return "—";
  }
}

function pickPrimaryActionForComponent(
  actions: NomusBomPlanAction[],
  componentCode: string
): NomusBomPlanAction | null {
  const key = normalizeComponentCode(componentCode);
  const matches = actions.filter(
    (a) => a.componentCode && normalizeComponentCode(a.componentCode) === key
  );
  if (matches.length === 0) return null;
  return [...matches].sort(
    (a, b) => (ACTION_PRIORITY[b.type] ?? 0) - (ACTION_PRIORITY[a.type] ?? 0)
  )[0];
}

function formatQty(value: number | null | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.000001 && value !== 0) return value.toExponential(4);
  const decimals = Math.abs(value) < 0.01 ? 6 : 4;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatQtyDisplay(value: number | null | undefined): string {
  return formatQty(value);
}

function buildObservation(
  primary: NomusBomPlanAction | null,
  line: NomusBomApplyPlan["comparison"]["lines"][number]
): string {
  const parts: string[] = [];
  if (primary?.reason) parts.push(primary.reason);
  else if (primary?.blockedReason) parts.push(primary.blockedReason);

  if (line.hasOptionalNomusLines) {
    parts.push(
      "Este item é opcional no Nomus e não entra automaticamente na precificação."
    );
  } else if (line.hasAlternativeNomusLines) {
    parts.push("Item alternativo no Nomus — requer seleção/política antes da precificação.");
  }

  return parts.filter(Boolean).join(" ");
}

export function buildNomusBomDiffRows(plan: NomusBomApplyPlan): NomusBomDiffRow[] {
  const { comparison, actions } = plan;
  const rows: NomusBomDiffRow[] = [];

  for (const line of comparison.lines) {
    const primary = pickPrimaryActionForComponent(actions, line.componentCode);
    const planType = primary?.type ?? inferPlanTypeFromComparison(line);
    rows.push({
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      comparisonStatus: line.status,
      indusQuantity: line.indusQuantity ?? null,
      nomusQuantity: line.nomusQuantity ?? null,
      quantityDiff: line.quantityDiff ?? null,
      planActionType: planType,
      planDecisionLabel: planActionTypeLabel(planType),
      observation: buildObservation(primary, line),
      hasDuplicateNomusLines: line.hasDuplicateNomusLines,
      hasDuplicateIndusLines: line.hasDuplicateIndusLines,
      hasOptionalNomusLines: line.hasOptionalNomusLines,
      hasAlternativeNomusLines: line.hasAlternativeNomusLines,
      hasPreferredNomusLines: line.hasPreferredNomusLines,
      hasShipmentItemNomusLines: line.hasShipmentItemNomusLines,
    });
  }

  rows.sort((a, b) => {
    const priority = (t: NomusBomPlanActionType | null) => ACTION_PRIORITY[t ?? "NO_ACTION"] ?? 0;
    const diff = priority(b.planActionType) - priority(a.planActionType);
    if (diff !== 0) return diff;
    return a.componentCode.localeCompare(b.componentCode, "pt-BR");
  });

  return rows;
}

function inferPlanTypeFromComparison(
  line: NomusBomApplyPlan["comparison"]["lines"][number]
): NomusBomPlanActionType | null {
  if (line.nomusLineCount > 0 && (line.hasOptionalNomusLines || line.hasAlternativeNomusLines)) {
    return line.status === "MATCH" ? "OPTIONAL_ITEM_NOT_AUTO_APPLIED" : "OPTIONAL_SELECTION_REQUIRED";
  }
  switch (line.status) {
    case "MATCH":
      return "NO_ACTION";
    case "QUANTITY_DIFF":
      return "UPDATE_BOM_QUANTITY";
    case "ONLY_IN_NOMUS":
      return "ADD_BOM_LINE";
    case "ONLY_IN_INDUSCOST":
      return "KEEP_INDUS_LINE";
    default:
      return null;
  }
}

export function hasImportProductOnly(plan: NomusBomApplyPlan): boolean {
  return plan.classification.isProductImportCandidate;
}

export function pendingOptionalSummaryCount(plan: NomusBomApplyPlan): number {
  return (
    plan.summary.optionalSelectionRequiredActions + plan.summary.optionalItemNotAutoAppliedActions
  );
}
