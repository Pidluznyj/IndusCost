import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  countDistinctParentCodesInStage,
  listDistinctParentCodesFromStage,
} from "@/src/lib/nomusBomComparisonLoad";

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

export function calculateSeverityScore(result: BomComparisonResult): number {
  let score = 0;
  const { summary, lines } = result;

  if (summary.missingProductInIndusCost) score += 100;
  if (summary.indusLines === 0 && !summary.missingProductInIndusCost) score += 50;
  score += summary.onlyInNomus * 20;
  score += summary.onlyInIndusCost * 20;
  score += summary.quantityDiffs * 10;
  score += lines.filter((line) => line.hasDuplicateNomusLines).length * 5;
  if (summary.ambiguousNomusList || summary.status === "BLOCKED") score += 5;

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

export function comparisonResultToBatchRow(result: BomComparisonResult): NomusBomBatchReportRow {
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
    severityScore: calculateSeverityScore(result),
    topIssues: extractTopIssues(result),
  };
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
