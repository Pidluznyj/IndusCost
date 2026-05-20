import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  buildBomComparisonForParentCode,
  countDistinctParentCodesInStage,
  listDistinctParentCodesFromStage,
  resolveNomusComponentCodes,
} from "@/src/lib/nomusBomComparisonLoad";
import { classifyBomComparison, type NomusBomActionClass, type NomusBomRiskLevel } from "@/src/lib/nomusBomClassification";
import {
  aggregateApplyPlansSummary,
  buildNomusBomApplyPlanForComparison,
  type NomusBomApplyPlan,
} from "@/src/lib/nomusBomApplyPlan";
import { clampBatchLimit } from "@/src/lib/nomusBomBatchReport";
import { enrichNomusBomApplyPlanWithOptionalSelection } from "@/src/lib/nomusOptionalPricingSelection";
import { prisma } from "@/src/lib/prisma";

export type NomusBomApplyPlanReportFilters = {
  /** Busca parcial (contains) — somente filtragem; não usar para diff/plano de um produto. */
  sku?: string;
  /** Código completo do pai Nomus — comparação/plano exatos de um único produto. */
  parentCode?: string;
  limit?: number;
  offset?: number;
  onlyCandidates?: boolean;
  onlyBlocked?: boolean;
  onlyImportProducts?: boolean;
  onlyUpdateQuantities?: boolean;
  risk?: NomusBomRiskLevel;
  actionClass?: NomusBomActionClass;
};

export type NomusBomApplyPlansReport = {
  generatedAt: string;
  mode: "DRY_RUN";
  totalParentsInNomusStage: number;
  comparedCount: number;
  summary: ReturnType<typeof aggregateApplyPlansSummary>;
  plans: NomusBomApplyPlan[];
};

const IMPORT_ACTION_CLASSES: NomusBomActionClass[] = [
  "CREATE_PRODUCT_FROM_NOMUS_CANDIDATE",
  "IMPORT_PRODUCT_THEN_CREATE_BOM_CANDIDATE",
];

function matchesPlanFilters(plan: NomusBomApplyPlan, filters: NomusBomApplyPlanReportFilters): boolean {
  const cls = plan.classification;

  if (filters.risk && cls.riskLevel !== filters.risk) return false;
  if (filters.actionClass && cls.actionClass !== filters.actionClass) return false;
  if (filters.onlyBlocked && !plan.isBlocked) return false;
  if (filters.onlyImportProducts && !cls.isProductImportCandidate) return false;
  if (filters.onlyUpdateQuantities && cls.actionClass !== "AUTO_UPDATE_QUANTITIES_CANDIDATE") {
    return false;
  }
  if (filters.onlyCandidates) {
    const isCandidate =
      cls.canApplyWithApproval ||
      cls.isProductImportCandidate ||
      IMPORT_ACTION_CLASSES.includes(cls.actionClass) ||
      cls.actionClass === "CREATE_BOM_CANDIDATE" ||
      cls.actionClass === "AUTO_UPDATE_QUANTITIES_CANDIDATE";
    if (!isCandidate) return false;
  }

  return true;
}

export async function buildNomusBomApplyPlansReport(
  filters: NomusBomApplyPlanReportFilters = {}
): Promise<NomusBomApplyPlansReport> {
  const limit = clampBatchLimit(filters.limit);
  const offset = Math.max(0, filters.offset ?? 0);
  const exactParentCode = filters.parentCode?.trim() || undefined;
  const search = !exactParentCode ? filters.sku?.trim() || undefined : undefined;

  let parentCodes: string[];
  let exactMatchCount = 0;
  if (exactParentCode) {
    const wanted = normalizeSku(exactParentCode);
    const trimmed = exactParentCode.trim();
    const stageRow = await prisma.nomusBomComponentStage.findFirst({
      where: {
        parentCode: { equals: trimmed, mode: "insensitive" },
      },
      select: { parentCode: true },
    });
    if (stageRow && normalizeSku(stageRow.parentCode) === wanted) {
      parentCodes = [stageRow.parentCode];
      exactMatchCount = 1;
    } else {
      parentCodes = [];
      exactMatchCount = 0;
    }
  } else {
    parentCodes = await listDistinctParentCodesFromStage({
      limit,
      offset,
      search,
    });
  }

  const totalParentsInNomusStage = exactParentCode
    ? exactMatchCount > 0
      ? 1
      : 0
    : search
      ? await countDistinctParentCodesInStage(search)
      : await countDistinctParentCodesInStage();

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

  const plans: NomusBomApplyPlan[] = [];

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

    const rawPlan = buildNomusBomApplyPlanForComparison(comparison, classification, resolvedForParent);
    const plan = await enrichNomusBomApplyPlanWithOptionalSelection(rawPlan);
    if (!matchesPlanFilters(plan, filters)) continue;
    plans.push(plan);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "DRY_RUN",
    totalParentsInNomusStage,
    comparedCount: parentCodes.length,
    summary: aggregateApplyPlansSummary(plans),
    plans,
  };
}

export function applyPlansReportToCsv(report: NomusBomApplyPlansReport): string {
  const headers = [
    "parentCode",
    "parentDescription",
    "indusProductId",
    "actionClass",
    "riskLevel",
    "recommendedAction",
    "canApplyWithApproval",
    "isBlocked",
    "importProductActions",
    "createBomActions",
    "updateQuantityActions",
    "addBomLineActions",
    "keepIndusLineActions",
    "ignoreOperationalItemActions",
    "blockedActions",
    "optionalSelectionRequiredActions",
    "optionalNomusItemsCount",
    "warningsText",
    "limitationsText",
  ];

  const escapeCsv = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const plan of report.plans) {
    const cls = plan.classification;
    lines.push(
      [
        plan.parentCode,
        plan.parentDescription ?? "",
        plan.indusProductId ?? "",
        cls.actionClass,
        cls.riskLevel,
        cls.recommendedAction,
        plan.canApplyWithApproval,
        plan.isBlocked,
        plan.summary.importProductActions,
        plan.summary.createBomActions,
        plan.summary.updateQuantityActions,
        plan.summary.addBomLineActions,
        plan.summary.keepIndusLineActions,
        plan.summary.ignoreOperationalItemActions,
        plan.summary.blockedActions,
        plan.summary.optionalSelectionRequiredActions,
        plan.summary.optionalNomusItemsCount,
        plan.warnings.join(" | "),
        plan.limitations.join(" | "),
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

export function applyPlanActionsToCsv(report: NomusBomApplyPlansReport): string {
  const headers = [
    "parentCode",
    "actionType",
    "componentCode",
    "componentDescription",
    "plannedQuantity",
    "reason",
    "riskLevel",
    "blockedReason",
    "requiresApproval",
  ];

  const escapeCsv = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const plan of report.plans) {
    for (const action of plan.actions) {
      lines.push(
        [
          plan.parentCode,
          action.type,
          action.componentCode ?? "",
          action.componentDescription ?? "",
          action.plannedQuantity ?? "",
          action.reason,
          action.riskLevel,
          action.blockedReason ?? "",
          action.requiresApproval,
        ]
          .map(escapeCsv)
          .join(",")
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
