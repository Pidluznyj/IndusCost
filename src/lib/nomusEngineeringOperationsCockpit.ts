/**
 * Central de Atualização Nomus (read-only).
 *
 * Lê o classification report Nomus × IndusCost e mapeia para linguagem operacional
 * (fila de trabalho com status + próxima ação recomendada) sem inventar dados.
 *
 * Esta lib NÃO grava nada — somente leitura. Não altera ProductBOM, preço, propostas
 * ou pedidos. POST/apply NÃO está coberto nesta fase.
 */

import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";
import {
  buildNomusBomClassificationReport,
  type NomusBomBatchReportRow,
} from "@/src/lib/nomusBomBatchReport";
import type {
  NomusBomActionClass,
  NomusBomRiskLevel,
} from "@/src/lib/nomusBomClassification";
import type {
  CockpitOperatorStatus,
  CockpitResult,
  CockpitRow,
  CockpitScope,
  CockpitSeverity,
  CockpitSituationLabel,
  CockpitTechnicalRef,
  CockpitTotals,
} from "@/src/lib/nomusEngineeringOperationsCockpitTypes";

const COCKPIT_DEFAULT_LIMIT = 100;
const COCKPIT_MAX_LIMIT = 500;
const COCKPIT_ONE_PRODUCT_LIMIT = 1;

/** Códigos que identificam montagem local (regra de negócio confirmada: 800.xx). */
function isAssemblyLocalCode(componentCode: string): boolean {
  return normalizeComponentCode(componentCode).startsWith("800.");
}

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

/** Mapeia actionClass técnico → status operacional. */
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
      return context.hasAssemblyLocal ? "LOCAL" : "LOCAL";
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

/** Texto humano para a próxima ação, sem siglas técnicas. */
function nextActionFor(
  operatorStatus: CockpitOperatorStatus,
  context: {
    hasAssemblyLocal: boolean;
    hasMissingMaterials: boolean;
    hasMissingChildProducts: boolean;
  }
): string {
  if (context.hasMissingMaterials) {
    return "Cadastrar ou mapear o material faltante antes de continuar.";
  }
  if (context.hasMissingChildProducts) {
    return "Importar o componente dependente antes de continuar.";
  }

  switch (operatorStatus) {
    case "OK":
      return "Nenhuma ação necessária.";
    case "READY":
      return "Revisar o plano de aplicação antes de qualquer alteração.";
    case "REVIEW":
      return context.hasAssemblyLocal
        ? "Manter item local de montagem e revisar alterações Nomus."
        : "Revisar diferenças e decidir o que aplicar.";
    case "BLOCKED":
      return "Resolver pendências antes de qualquer atualização.";
    case "NEW":
      return "Importar produto pelo fluxo controlado.";
    case "LOCAL":
      return context.hasAssemblyLocal
        ? "Manter montagem local (800.xx). Apenas conferir alterações Nomus."
        : "Conferir item local e decidir se mantém na BOM.";
    case "OPTIONAL":
      return "Ir para Opcionais de Precificação e escolher qual entra no custo.";
    case "AMBIGUOUS":
      return "Resolver mapeamento manual — decidir se é Produto ou Material.";
    default:
      return "Abrir o produto para analisar.";
  }
}

/** Lê os indicadores do row e os topIssues para descobrir as situações operacionais. */
function buildSituationLabels(
  row: NomusBomBatchReportRow,
  context: {
    hasAssemblyLocal: boolean;
    hasOptionalPending: boolean;
    hasAmbiguity: boolean;
    hasLocalKeep: boolean;
    isNewProduct: boolean;
  }
): CockpitSituationLabel[] {
  const labels: CockpitSituationLabel[] = [];
  const cls = row.classification;

  if (cls?.actionClass === "NO_ACTION_OK") {
    labels.push({ kind: "NO_CHANGES", label: "Sem alteração estrutural" });
  }
  if (
    cls?.actionClass === "AUTO_APPLY_CANDIDATE" ||
    cls?.actionClass === "AUTO_UPDATE_QUANTITIES_CANDIDATE" ||
    cls?.actionClass === "CREATE_BOM_CANDIDATE"
  ) {
    labels.push({ kind: "READY_TO_REVIEW", label: "Alterações simples para revisar" });
  }
  if (context.isNewProduct) {
    labels.push({ kind: "NEW_PRODUCT", label: "Produto novo no Nomus (ausente no IndusCost)" });
  }
  if (row.onlyInNomus > 0 || row.onlyInIndusCost > 0) {
    labels.push({ kind: "BOM_CHANGED", label: "Estrutura de componentes mudou" });
  }
  if (row.quantityDiffs > 0) {
    labels.push({ kind: "QUANTITY_CHANGED", label: "Há componentes com quantidade diferente" });
  }
  if (context.hasAssemblyLocal) {
    labels.push({
      kind: "ASSEMBLY_LOCAL_PRESERVED",
      label: "Possui 800.xx — Montagem (item local preservado)",
    });
  } else if (context.hasLocalKeep) {
    labels.push({ kind: "LOCAL_ITEM_PRESERVED", label: "Possui item local do IndusCost preservado" });
  }
  if (context.hasOptionalPending) {
    labels.push({
      kind: "OPTIONAL_PENDING",
      label: "Há componentes opcionais — escolha pendente",
    });
  }
  if (context.hasAmbiguity) {
    labels.push({
      kind: "AMBIGUOUS_CODE",
      label: "Mesmo código existe como Produto e Material",
    });
  }
  if (cls?.actionClass === "BLOCKED_MISSING_NOMUS_COMPONENT") {
    labels.push({ kind: "MISSING_MATERIAL", label: "Material faltante" });
  }
  if (cls?.actionClass === "BLOCKED_MISSING_PARENT_PRODUCT") {
    labels.push({ kind: "MISSING_CHILD_PRODUCT", label: "Produto filho faltante" });
  }
  if (cls?.isBlocked && !labels.some((l) => l.kind.startsWith("MISSING"))) {
    labels.push({ kind: "BLOCKED_GENERIC", label: "Bloqueado — resolver pendências" });
  }

  return labels;
}

/** Resumo curto, em PT-BR, do que mudou (1-2 linhas). */
function buildWhatChangedSummary(row: NomusBomBatchReportRow): string {
  const cls = row.classification;
  if (!cls) {
    return "Comparação Nomus × IndusCost realizada.";
  }

  const parts: string[] = [];
  if (row.onlyInNomus > 0) {
    parts.push(`${row.onlyInNomus} componente(s) novo(s) no Nomus`);
  }
  if (row.onlyInIndusCost > 0) {
    parts.push(`${row.onlyInIndusCost} item(ns) local(is) no IndusCost`);
  }
  if (row.quantityDiffs > 0) {
    parts.push(`${row.quantityDiffs} diferença(s) de quantidade`);
  }
  if (row.missingProductInIndusCost) {
    parts.push("produto ainda não cadastrado no IndusCost");
  }
  if (row.noNomusBom) {
    parts.push("BOM Nomus indisponível para este produto");
  }
  if (parts.length === 0) {
    return cls.suggestedNextStepText ?? "Sem diferenças relevantes.";
  }
  return parts.join("; ") + ".";
}

function buildTechnicalRefs(operatorStatus: CockpitOperatorStatus): CockpitTechnicalRef[] {
  switch (operatorStatus) {
    case "OK":
      return [
        { tab: "effective-pricing-bom", label: "Ver BOM efetiva" },
        { tab: "diagnostic", label: "Ver diagnóstico técnico" },
      ];
    case "READY":
      return [
        { tab: "apply-plan", label: "Ver plano de aplicação", primary: true },
        { tab: "cost-impact", label: "Ver impacto de custo" },
        { tab: "effective-pricing-bom", label: "Ver BOM efetiva" },
      ];
    case "REVIEW":
      return [
        { tab: "pending", label: "Resolver pendências", primary: true },
        { tab: "effective-pricing-bom", label: "Ver BOM efetiva" },
        { tab: "cost-impact", label: "Ver impacto de custo" },
        { tab: "diagnostic", label: "Ver diagnóstico técnico" },
      ];
    case "BLOCKED":
      return [
        { tab: "diagnostic", label: "Ver diagnóstico técnico", primary: true },
        { tab: "pending", label: "Resolver pendências" },
      ];
    case "NEW":
      return [
        { tab: "product-import", label: "Importar produto do Nomus", primary: true },
        { tab: "diagnostic", label: "Ver diagnóstico técnico" },
      ];
    case "LOCAL":
      return [
        { tab: "pending", label: "Revisar itens locais", primary: true },
        { tab: "effective-pricing-bom", label: "Ver BOM efetiva" },
      ];
    case "OPTIONAL":
      return [
        { tab: "pending", label: "Selecionar opcional", primary: true },
        { tab: "effective-pricing-bom", label: "Ver BOM efetiva" },
      ];
    case "AMBIGUOUS":
      return [
        { tab: "diagnostic", label: "Ver diagnóstico técnico", primary: true },
        { tab: "pending", label: "Resolver pendências" },
      ];
    default:
      return [{ tab: "diagnostic", label: "Ver diagnóstico técnico" }];
  }
}

function buildBlockingDetails(row: NomusBomBatchReportRow): string[] {
  const cls = row.classification;
  if (!cls) return [];
  const out: string[] = [];
  if (cls.isBlocked) {
    if (cls.reasons.length > 0) {
      out.push(...cls.reasons.slice(0, 5));
    } else if (cls.suggestedNextStepText) {
      out.push(cls.suggestedNextStepText);
    }
  }
  return out;
}

function buildRowWarnings(row: NomusBomBatchReportRow): string[] {
  const out: string[] = [];
  if (row.hasDuplicateNomusLines) {
    out.push(
      `${row.duplicateNomusComponentsCount} componente(s) Nomus com linhas duplicadas — revisar antes de aplicar.`
    );
  }
  if (row.hasDuplicateIndusLines) {
    out.push(
      `${row.duplicateIndusComponentsCount} componente(s) IndusCost com linhas duplicadas — consolidar.`
    );
  }
  return out;
}

function buildOperatorRow(row: NomusBomBatchReportRow): CockpitRow {
  const cls = row.classification;
  const actionClass = cls?.actionClass ?? null;
  const riskLevel = cls?.riskLevel ?? null;

  const isNewProduct = row.missingProductInIndusCost;
  const hasOptionalPending =
    actionClass === "REVIEW_OPTIONAL_PRICING_SELECTION" ||
    actionClass === "BLOCKED_OPTIONAL_SELECTION_REQUIRED";
  const hasAmbiguity = actionClass === "BLOCKED_AMBIGUOUS_NOMUS_LIST";

  const hasAssemblyLocal =
    row.topIssues.some((issue) => isAssemblyLocalCode(issue.componentCode)) ||
    actionClass === "REVIEW_INDUS_OPERATIONAL_ITEM";

  const hasLocalKeep =
    actionClass === "LOCAL_ONLY_KEEP" ||
    actionClass === "LOCAL_ONLY_REVIEW" ||
    row.onlyInIndusCost > 0;

  const operatorStatus = mapActionClassToOperatorStatus(actionClass, {
    hasOptionalPending,
    hasAmbiguity,
    hasAssemblyLocal,
    hasLocalKeep,
    isNewProduct,
  });
  const severity = mapRiskToSeverity(riskLevel, operatorStatus);
  const situationLabels = buildSituationLabels(row, {
    hasAssemblyLocal,
    hasOptionalPending,
    hasAmbiguity,
    hasLocalKeep,
    isNewProduct,
  });
  const whatChangedSummary = buildWhatChangedSummary(row);
  const hasMissingMaterials =
    actionClass === "BLOCKED_MISSING_NOMUS_COMPONENT";
  const hasMissingChildProducts =
    actionClass === "BLOCKED_MISSING_PARENT_PRODUCT";

  const nextRecommendedAction = nextActionFor(operatorStatus, {
    hasAssemblyLocal,
    hasMissingMaterials,
    hasMissingChildProducts,
  });
  const blockingDetails = buildBlockingDetails(row);
  const warnings = buildRowWarnings(row);
  const technicalRefs = buildTechnicalRefs(operatorStatus);

  const hasStructuralChanges =
    row.onlyInNomus > 0 ||
    row.onlyInIndusCost > 0 ||
    row.quantityDiffs > 0 ||
    row.missingProductInIndusCost;

  return {
    parentCode: row.parentCode,
    parentDescription: row.parentDescription ?? null,
    productId: row.indusProductId ?? null,
    productName: row.indusProductName ?? null,

    operatorStatus,
    operatorStatusLabel: hasMissingMaterials
      ? "Material faltante"
      : hasMissingChildProducts
        ? "Produto filho faltante"
        : OPERATOR_STATUS_LABEL[operatorStatus],
    severity,

    situationLabels,
    whatChangedSummary,
    nextRecommendedAction,

    hasStructuralChanges,
    hasLocalException: hasLocalKeep || hasAssemblyLocal,
    hasAssemblyLocalException: hasAssemblyLocal,
    hasOptionalPending,
    hasBlockingIssues: Boolean(cls?.isBlocked),
    hasAmbiguity,
    hasMissingMaterials,
    hasMissingChildProducts,

    blockingDetails,
    warnings,
    technicalRefs,

    technicalMeta: {
      actionClass,
      riskLevel,
      quantityDiffs: row.quantityDiffs,
      onlyInNomus: row.onlyInNomus,
      onlyInIndusCost: row.onlyInIndusCost,
      missingProductInIndusCost: row.missingProductInIndusCost,
      noNomusBom: row.noNomusBom,
      noIndusBom: row.noIndusBom,
      reasons: cls?.reasons ?? [],
    },
  };
}

export function aggregateCockpitTotals(rows: CockpitRow[]): CockpitTotals {
  let noChanges = 0;
  let ready = 0;
  let needsReview = 0;
  let blocked = 0;
  let newProducts = 0;
  let bomChanged = 0;
  let optionalPending = 0;
  let localExceptions = 0;
  let assemblyLocalExceptions = 0;
  let ambiguous = 0;
  let missingMaterials = 0;
  let missingProducts = 0;

  for (const r of rows) {
    switch (r.operatorStatus) {
      case "OK":
        noChanges += 1;
        break;
      case "READY":
        ready += 1;
        break;
      case "REVIEW":
        needsReview += 1;
        break;
      case "BLOCKED":
        blocked += 1;
        break;
      case "NEW":
        newProducts += 1;
        break;
      case "LOCAL":
        localExceptions += 1;
        break;
      case "OPTIONAL":
        optionalPending += 1;
        break;
      case "AMBIGUOUS":
        ambiguous += 1;
        break;
    }
    if (r.hasStructuralChanges) bomChanged += 1;
    if (r.hasAssemblyLocalException) assemblyLocalExceptions += 1;
    if (r.hasMissingMaterials) missingMaterials += 1;
    if (r.hasMissingChildProducts) missingProducts += 1;
  }

  return {
    total: rows.length,
    noChanges,
    ready,
    needsReview,
    blocked,
    newProducts,
    bomChanged,
    optionalPending,
    localExceptions,
    assemblyLocalExceptions,
    ambiguous,
    missingMaterials,
    missingProducts,
  };
}

export type BuildCockpitInput = {
  scope?: CockpitScope;
  parentCode?: string;
  limit?: number;
  offset?: number;
  /** Reservado para evolução futura — atualmente sem efeito (lib é read-only). */
  includeCostImpact?: boolean;
};

function clampLimit(input: BuildCockpitInput): number {
  if (input.scope === "ONE_PRODUCT") return COCKPIT_ONE_PRODUCT_LIMIT;
  const raw = Number.isFinite(input.limit ?? NaN) ? Number(input.limit) : COCKPIT_DEFAULT_LIMIT;
  return Math.min(Math.max(raw, 1), COCKPIT_MAX_LIMIT);
}

function clampOffset(offset?: number): number {
  const raw = Number.isFinite(offset ?? NaN) ? Number(offset) : 0;
  return Math.max(0, Math.floor(raw));
}

export async function buildNomusEngineeringOperationsCockpit(
  input: BuildCockpitInput = {}
): Promise<CockpitResult> {
  const scope: CockpitScope = input.scope ?? "CHANGED_ONLY";
  const parentCode = input.parentCode?.trim() || null;
  const limitApplied = clampLimit(input);
  const offsetApplied = clampOffset(input.offset);
  const includeCostImpact = input.includeCostImpact === true;

  const emptyPagination = {
    offsetApplied,
    hasMore: false,
    nextOffset: null as number | null,
  };

  if (scope === "ONE_PRODUCT" && !parentCode) {
    return {
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY",
      scope,
      parentCode: null,
      totalParentsInStage: 0,
      comparedCount: 0,
      limitApplied,
      ...emptyPagination,
      totals: aggregateCockpitTotals([]),
      rows: [],
      warnings: ["Escopo ONE_PRODUCT exige parentCode."],
    };
  }

  const report = await buildNomusBomClassificationReport({
    limit: limitApplied,
    offset: offsetApplied,
    search: scope === "ONE_PRODUCT" ? (parentCode ?? undefined) : undefined,
  });

  let rows = report.rows.map(buildOperatorRow);

  if (scope === "CHANGED_ONLY") {
    rows = rows.filter((r) => r.operatorStatus !== "OK");
  }

  const hasMore =
    offsetApplied + report.comparedCount < report.totalParentsInNomusStage;
  const nextOffset = hasMore ? offsetApplied + limitApplied : null;

  const warnings: string[] = [];
  if (includeCostImpact) {
    warnings.push(
      "Impacto de custo detalhado não é calculado em lote nesta fase — abra o produto na aba Impacto de custo."
    );
  }

  return {
    generatedAt: report.generatedAt,
    mode: "READ_ONLY",
    scope,
    parentCode,
    totalParentsInStage: report.totalParentsInNomusStage,
    comparedCount: report.comparedCount,
    limitApplied,
    offsetApplied,
    hasMore,
    nextOffset,
    totals: aggregateCockpitTotals(rows),
    rows,
    warnings,
  };
}
