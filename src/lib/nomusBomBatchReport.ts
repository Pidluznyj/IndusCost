import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  countDistinctParentCodesInStage,
  listDistinctParentCodesFromStage,
  resolveNomusComponentCodes,
} from "@/src/lib/nomusBomComparisonLoad";
import {
  classifyBomComparison,
  classificationSeverityBonus,
  isCandidateActionClass,
  isReviewActionClass,
  type NomusBomActionClass,
  type NomusBomClassification,
  type NomusBomRecommendedAction,
  type NomusBomRiskLevel,
} from "@/src/lib/nomusBomClassification";

export type NomusBomBatchReportFilters = {
  status?: "OK" | "DIVERGENT" | "BLOCKED" | "ALL";
  onlyWithProductInIndus?: boolean;
  onlyMissingProductInIndus?: boolean;
  onlyNoIndusBom?: boolean;
  onlyQuantityDiffs?: boolean;
  onlyOnlyInNomus?: boolean;
  onlyOnlyInIndusCost?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

export type NomusBomClassificationReportFilters = NomusBomBatchReportFilters & {
  risk?: NomusBomRiskLevel;
  actionClass?: NomusBomActionClass;
  onlyBlocked?: boolean;
  onlyReview?: boolean;
  onlyCandidates?: boolean;
};

export type NomusBomBatchRowClassification = {
  actionClass: NomusBomActionClass;
  riskLevel: NomusBomRiskLevel;
  recommendedAction: NomusBomRecommendedAction;
  canApplyAutomaticallyNow: boolean;
  canApplyWithApproval: boolean;
  isBlocked: boolean;
  reasons: string[];
  issuesCount: number;
  suggestedNextStepText: string;
  hasPreparedIndicator: boolean;
  hasKitIndicator: boolean;
  hasOperationalIndicator: boolean;
};

export type NomusBomBatchReportRow = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  indusProductName?: string | null;

  status: "OK" | "DIVERGENT" | "BLOCKED";

  selectedListName?: string | null;
  selectedListId?: number | null;
  selectedListPadrao?: boolean | null;
  selectedListPadraoBlocoK?: boolean | null;
  ignoredListsCount: number;

  nomusLines: number;
  indusLines: number;
  matches: number;
  quantityDiffs: number;
  onlyInNomus: number;
  onlyInIndusCost: number;

  hasDuplicateNomusLines: boolean;
  duplicateNomusComponentsCount: number;
  hasDuplicateIndusLines: boolean;
  duplicateIndusComponentsCount: number;

  missingProductInIndusCost: boolean;
  noNomusBom: boolean;
  noIndusBom: boolean;

  severityScore: number;

  topIssues: Array<{
    componentCode: string;
    componentDescription?: string | null;
    status: string;
    nomusQuantity?: number | null;
    indusQuantity?: number | null;
    quantityDiffAbs?: number | null;
  }>;

  classification?: NomusBomBatchRowClassification;
};

export type NomusBomClassificationSummary = {
  noActionOk: number;
  autoApplyCandidates: number;
  createBomCandidates: number;
  updateQuantitiesCandidates: number;
  reviewStructureDiff: number;
  reviewQuantityDiff: number;
  reviewOperationalItems: number;
  reviewPreparedComponents: number;
  reviewKitsOrPacks: number;
  blockedMissingParentProduct: number;
  blockedMissingComponents: number;
  blockedAmbiguousList: number;
  blockedNoNomusBom: number;
};

export type NomusBomBatchReport = {
  generatedAt: string;
  totalParentsInNomusStage: number;
  comparedCount: number;
  summary: {
    okCount: number;
    divergentCount: number;
    blockedCount: number;
    missingProductInIndusCost: number;
    noIndusBom: number;
    noNomusBom: number;
    totalQuantityDiffs: number;
    totalOnlyInNomus: number;
    totalOnlyInIndusCost: number;
    totalDuplicateNomusComponents: number;
    totalDuplicateIndusComponents: number;
  };
  rows: NomusBomBatchReportRow[];
};

export type NomusBomClassificationReport = NomusBomBatchReport & {
  classificationSummary: NomusBomClassificationSummary;
};

const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 100;

const ISSUE_PRIORITY: Record<string, number> = {
  ONLY_IN_NOMUS: 4,
  ONLY_IN_INDUSCOST: 3,
  QUANTITY_DIFF: 2,
  MATCH: 0,
};

export function clampBatchLimit(limit?: number): number {
  const value = limit ?? DEFAULT_BATCH_LIMIT;
  return Math.min(Math.max(value, 1), MAX_BATCH_LIMIT);
}

export function calculateSeverityScore(
  result: BomComparisonResult,
  classification?: NomusBomClassification
): number {
  let score = 0;
  const { summary, lines } = result;

  if (summary.missingProductInIndusCost) score += 100;
  if (summary.indusLines === 0 && !summary.missingProductInIndusCost) score += 50;
  score += summary.onlyInNomus * 20;
  score += summary.onlyInIndusCost * 20;
  score += summary.quantityDiffs * 10;
  score += lines.filter((line) => line.hasDuplicateNomusLines).length * 5;
  if (summary.ambiguousNomusList || summary.status === "BLOCKED") score += 5;
  if (classification) score += classificationSeverityBonus(classification);

  return score;
}

export function extractTopIssues(result: BomComparisonResult, max = 5): NomusBomBatchReportRow["topIssues"] {
  return [...result.lines]
    .filter((line) => line.status !== "MATCH")
    .sort((a, b) => {
      const priority =
        (ISSUE_PRIORITY[b.status] ?? 0) - (ISSUE_PRIORITY[a.status] ?? 0);
      if (priority !== 0) return priority;
      return (b.quantityDiffAbs ?? 0) - (a.quantityDiffAbs ?? 0);
    })
    .slice(0, max)
    .map((line) => ({
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      status: line.status,
      nomusQuantity: line.nomusQuantity,
      indusQuantity: line.indusQuantity,
      quantityDiffAbs: line.quantityDiffAbs,
    }));
}

function countDuplicateComponents(result: BomComparisonResult) {
  const duplicateNomusComponentsCount = result.lines.filter((line) => line.hasDuplicateNomusLines).length;
  const duplicateIndusComponentsCount = result.lines.filter((line) => line.hasDuplicateIndusLines).length;
  return {
    hasDuplicateNomusLines: duplicateNomusComponentsCount > 0,
    duplicateNomusComponentsCount,
    hasDuplicateIndusLines: duplicateIndusComponentsCount > 0,
    duplicateIndusComponentsCount,
  };
}

export function classificationToBatchRowFields(
  classification: NomusBomClassification
): NomusBomBatchRowClassification {
  return {
    actionClass: classification.actionClass,
    riskLevel: classification.riskLevel,
    recommendedAction: classification.recommendedAction,
    canApplyAutomaticallyNow: false,
    canApplyWithApproval: classification.canApplyWithApproval,
    isBlocked: classification.isBlocked,
    reasons: classification.reasons,
    issuesCount: classification.issues.length,
    suggestedNextStepText: classification.suggestedNextStepText,
    hasPreparedIndicator: classification.metrics.preparedComponentsCount > 0,
    hasKitIndicator: classification.metrics.kitOrPackIndicatorsCount > 0,
    hasOperationalIndicator: classification.metrics.operationalIndusItemsCount > 0,
  };
}

export function comparisonResultToBatchRow(
  result: BomComparisonResult,
  classification?: NomusBomClassification
): NomusBomBatchReportRow {
  const duplicates = countDuplicateComponents(result);
  const noNomusBom = result.summary.nomusLines === 0;
  const noIndusBom = result.summary.indusLines === 0 && !result.summary.missingProductInIndusCost;

  return {
    parentCode: result.parentCode,
    parentDescription: result.parentDescription,
    indusProductId: result.indusProductId,
    indusProductName: result.indusProductName ?? null,
    status: result.summary.status,
    selectedListName: result.selectedNomusList?.listaMateriaisNome ?? null,
    selectedListId: result.selectedNomusList?.listaMateriaisId ?? null,
    selectedListPadrao: result.selectedNomusList?.listaMateriaisPadrao ?? null,
    selectedListPadraoBlocoK: result.selectedNomusList?.listaMateriaisPadraoBlocoK ?? null,
    ignoredListsCount: result.ignoredNomusLists.length,
    nomusLines: result.summary.nomusLines,
    indusLines: result.summary.indusLines,
    matches: result.summary.matches,
    quantityDiffs: result.summary.quantityDiffs,
    onlyInNomus: result.summary.onlyInNomus,
    onlyInIndusCost: result.summary.onlyInIndusCost,
    ...duplicates,
    missingProductInIndusCost: result.summary.missingProductInIndusCost,
    noNomusBom,
    noIndusBom,
    severityScore: calculateSeverityScore(result, classification),
    topIssues: extractTopIssues(result),
    classification: classification ? classificationToBatchRowFields(classification) : undefined,
  };
}

function aggregateClassificationSummary(
  rows: NomusBomBatchReportRow[]
): NomusBomClassificationSummary {
  const summary: NomusBomClassificationSummary = {
    noActionOk: 0,
    autoApplyCandidates: 0,
    createBomCandidates: 0,
    updateQuantitiesCandidates: 0,
    reviewStructureDiff: 0,
    reviewQuantityDiff: 0,
    reviewOperationalItems: 0,
    reviewPreparedComponents: 0,
    reviewKitsOrPacks: 0,
    blockedMissingParentProduct: 0,
    blockedMissingComponents: 0,
    blockedAmbiguousList: 0,
    blockedNoNomusBom: 0,
  };

  for (const row of rows) {
    const cls = row.classification;
    if (!cls) continue;

    switch (cls.actionClass) {
      case "NO_ACTION_OK":
        summary.noActionOk += 1;
        break;
      case "AUTO_APPLY_CANDIDATE":
        summary.autoApplyCandidates += 1;
        break;
      case "CREATE_BOM_CANDIDATE":
        summary.createBomCandidates += 1;
        break;
      case "AUTO_UPDATE_QUANTITIES_CANDIDATE":
        summary.updateQuantitiesCandidates += 1;
        break;
      case "REVIEW_STRUCTURE_DIFF":
        summary.reviewStructureDiff += 1;
        break;
      case "REVIEW_QUANTITY_DIFF":
        summary.reviewQuantityDiff += 1;
        break;
      case "REVIEW_INDUS_OPERATIONAL_ITEM":
        summary.reviewOperationalItems += 1;
        break;
      case "BLOCKED_MISSING_PARENT_PRODUCT":
        summary.blockedMissingParentProduct += 1;
        break;
      case "BLOCKED_MISSING_NOMUS_COMPONENT":
        summary.blockedMissingComponents += 1;
        break;
      case "BLOCKED_AMBIGUOUS_NOMUS_LIST":
        summary.blockedAmbiguousList += 1;
        break;
      case "BLOCKED_NO_NOMUS_BOM":
        summary.blockedNoNomusBom += 1;
        break;
      default:
        break;
    }

    if (cls.hasPreparedIndicator) summary.reviewPreparedComponents += 1;
    if (cls.hasKitIndicator) summary.reviewKitsOrPacks += 1;
    if (cls.hasOperationalIndicator && cls.actionClass !== "REVIEW_INDUS_OPERATIONAL_ITEM") {
      summary.reviewOperationalItems += 1;
    }
  }

  return summary;
}

function matchesClassificationFilters(
  row: NomusBomBatchReportRow,
  filters: NomusBomClassificationReportFilters
): boolean {
  const cls = row.classification;
  if (!cls) return false;

  if (filters.risk && cls.riskLevel !== filters.risk) return false;
  if (filters.actionClass && cls.actionClass !== filters.actionClass) return false;
  if (filters.onlyBlocked && !cls.isBlocked) return false;
  if (filters.onlyReview && !isReviewActionClass(cls.actionClass)) return false;
  if (filters.onlyCandidates && !isCandidateActionClass(cls.actionClass)) return false;

  return true;
}

function matchesBatchFilters(row: NomusBomBatchReportRow, filters: NomusBomBatchReportFilters): boolean {
  const status = filters.status ?? "ALL";
  if (status !== "ALL" && row.status !== status) return false;
  if (filters.onlyWithProductInIndus && row.missingProductInIndusCost) return false;
  if (filters.onlyMissingProductInIndus && !row.missingProductInIndusCost) return false;
  if (filters.onlyNoIndusBom && !row.noIndusBom) return false;
  if (filters.onlyQuantityDiffs && row.quantityDiffs === 0) return false;
  if (filters.onlyOnlyInNomus && row.onlyInNomus === 0) return false;
  if (filters.onlyOnlyInIndusCost && row.onlyInIndusCost === 0) return false;
  return true;
}

export function sortBatchReportRows(rows: NomusBomBatchReportRow[]): NomusBomBatchReportRow[] {
  const statusRank: Record<NomusBomBatchReportRow["status"], number> = {
    BLOCKED: 0,
    DIVERGENT: 1,
    OK: 2,
  };

  return [...rows].sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff !== 0) return statusDiff;
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    return a.parentCode.localeCompare(b.parentCode, "pt-BR");
  });
}

function aggregateBatchSummary(rows: NomusBomBatchReportRow[]): NomusBomBatchReport["summary"] {
  return {
    okCount: rows.filter((row) => row.status === "OK").length,
    divergentCount: rows.filter((row) => row.status === "DIVERGENT").length,
    blockedCount: rows.filter((row) => row.status === "BLOCKED").length,
    missingProductInIndusCost: rows.filter((row) => row.missingProductInIndusCost).length,
    noIndusBom: rows.filter((row) => row.noIndusBom).length,
    noNomusBom: rows.filter((row) => row.noNomusBom).length,
    totalQuantityDiffs: rows.reduce((acc, row) => acc + row.quantityDiffs, 0),
    totalOnlyInNomus: rows.reduce((acc, row) => acc + row.onlyInNomus, 0),
    totalOnlyInIndusCost: rows.reduce((acc, row) => acc + row.onlyInIndusCost, 0),
    totalDuplicateNomusComponents: rows.reduce(
      (acc, row) => acc + row.duplicateNomusComponentsCount,
      0
    ),
    totalDuplicateIndusComponents: rows.reduce(
      (acc, row) => acc + row.duplicateIndusComponentsCount,
      0
    ),
  };
}

export async function buildNomusBomBatchReport(
  filters: NomusBomBatchReportFilters = {}
): Promise<NomusBomBatchReport> {
  const limit = clampBatchLimit(filters.limit);
  const offset = Math.max(0, filters.offset ?? 0);
  const search = filters.search?.trim() || undefined;

  const totalParentsInNomusStage = await countDistinctParentCodesInStage(search);
  const parentCodes = await listDistinctParentCodesFromStage({ limit, offset, search });

  const rows: NomusBomBatchReportRow[] = [];
  for (const parentCode of parentCodes) {
    const comparison = await buildBomComparisonForParentCode(parentCode);
    const row = comparisonResultToBatchRow(comparison);
    if (matchesBatchFilters(row, filters)) {
      rows.push(row);
    }
  }

  const sortedRows = sortBatchReportRows(rows);

  return {
    generatedAt: new Date().toISOString(),
    totalParentsInNomusStage,
    comparedCount: parentCodes.length,
    summary: aggregateBatchSummary(sortedRows),
    rows: sortedRows,
  };
}

export function formatTopIssuesText(topIssues: NomusBomBatchReportRow["topIssues"]): string {
  if (topIssues.length === 0) return "";
  return topIssues
    .map((issue) => {
      const qty =
        issue.nomusQuantity != null || issue.indusQuantity != null
          ? ` N:${issue.nomusQuantity ?? "—"} I:${issue.indusQuantity ?? "—"}`
          : "";
      return `${issue.componentCode}(${issue.status}${qty})`;
    })
    .join("; ");
}

export function batchReportToCsv(report: NomusBomBatchReport): string {
  const headers = [
    "parentCode",
    "parentDescription",
    "indusProductId",
    "status",
    "selectedListName",
    "nomusLines",
    "indusLines",
    "matches",
    "quantityDiffs",
    "onlyInNomus",
    "onlyInIndusCost",
    "missingProductInIndusCost",
    "noIndusBom",
    "severityScore",
    "topIssuesText",
  ];

  const escapeCsv = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        row.parentCode,
        row.parentDescription ?? "",
        row.indusProductId ?? "",
        row.status,
        row.selectedListName ?? "",
        row.nomusLines,
        row.indusLines,
        row.matches,
        row.quantityDiffs,
        row.onlyInNomus,
        row.onlyInIndusCost,
        row.missingProductInIndusCost,
        row.noIndusBom,
        row.severityScore,
        formatTopIssuesText(row.topIssues),
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildNomusBomClassificationReport(
  filters: NomusBomClassificationReportFilters = {}
): Promise<NomusBomClassificationReport> {
  const limit = clampBatchLimit(filters.limit);
  const offset = Math.max(0, filters.offset ?? 0);
  const search = filters.search?.trim() || undefined;

  const totalParentsInNomusStage = await countDistinctParentCodesInStage(search);
  const parentCodes = await listDistinctParentCodesFromStage({ limit, offset, search });

  const comparisons: BomComparisonResult[] = [];
  for (const parentCode of parentCodes) {
    comparisons.push(await buildBomComparisonForParentCode(parentCode));
  }

  const allComponentCodes = new Set<string>();
  for (const comparison of comparisons) {
    for (const line of comparison.lines) {
      if (line.nomusLineCount > 0) allComponentCodes.add(line.componentCode);
    }
  }

  const resolvedAll = await resolveNomusComponentCodes([...allComponentCodes]);
  const resolvedByCode = new Map(
    resolvedAll.map((item) => [normalizeComponentCode(item.componentCode), item])
  );

  const rows: NomusBomBatchReportRow[] = [];
  for (const comparison of comparisons) {
    const codes = comparison.lines.filter((l) => l.nomusLineCount > 0).map((l) => l.componentCode);
    const resolvedForParent = codes.map(
      (code) =>
        resolvedByCode.get(normalizeComponentCode(code)) ?? {
          componentCode: code,
          productId: null,
          materialId: null,
          resolvedKind: "NONE" as const,
        }
    );

    const classification = classifyBomComparison(comparison, {
      resolvedNomusComponents: resolvedForParent,
    });

    const row = comparisonResultToBatchRow(comparison, classification);
    if (!matchesBatchFilters(row, filters)) continue;
    if (!matchesClassificationFilters(row, filters)) continue;
    rows.push(row);
  }

  const sortedRows = sortBatchReportRows(rows);

  const baseReport: NomusBomBatchReport = {
    generatedAt: new Date().toISOString(),
    totalParentsInNomusStage,
    comparedCount: parentCodes.length,
    summary: aggregateBatchSummary(sortedRows),
    rows: sortedRows,
  };

  return {
    ...baseReport,
    classificationSummary: aggregateClassificationSummary(sortedRows),
  };
}

export function formatReasonsText(reasons: string[]): string {
  return reasons.join(" | ");
}

export function classificationReportToCsv(report: NomusBomClassificationReport): string {
  const headers = [
    "parentCode",
    "parentDescription",
    "indusProductId",
    "status",
    "actionClass",
    "riskLevel",
    "recommendedAction",
    "canApplyWithApproval",
    "isBlocked",
    "selectedListName",
    "nomusLines",
    "indusLines",
    "quantityDiffs",
    "onlyInNomus",
    "onlyInIndusCost",
    "missingProductInIndusCost",
    "noIndusBom",
    "suggestedNextStepText",
    "reasonsText",
  ];

  const escapeCsv = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of report.rows) {
    const cls = row.classification;
    lines.push(
      [
        row.parentCode,
        row.parentDescription ?? "",
        row.indusProductId ?? "",
        row.status,
        cls?.actionClass ?? "",
        cls?.riskLevel ?? "",
        cls?.recommendedAction ?? "",
        cls?.canApplyWithApproval ?? false,
        cls?.isBlocked ?? false,
        row.selectedListName ?? "",
        row.nomusLines,
        row.indusLines,
        row.quantityDiffs,
        row.onlyInNomus,
        row.onlyInIndusCost,
        row.missingProductInIndusCost,
        row.noIndusBom,
        cls?.suggestedNextStepText ?? "",
        formatReasonsText(cls?.reasons ?? []),
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}
