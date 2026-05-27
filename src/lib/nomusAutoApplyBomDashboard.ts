import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NomusBomAutoApplyProductResult, NomusBomAutoApplyReport } from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import type {
  AutoApplyBlockingReasonBucket,
  AutoApplyBomDashboardProductRow,
  AutoApplyBomDashboardResult,
  AutoApplyDashboardFilter,
  AutoApplyProductCategory,
} from "@/src/lib/nomusAutoApplyBomDashboardTypes";
import {
  computeFilterCounts,
  enrichDashboardProductRow,
} from "@/src/lib/nomusAutoApplyBomDashboardShared";
import { prisma } from "@/src/lib/prisma";

const DEFAULT_REPORT_JSON = join(process.cwd(), "docs/generated/nomus-auto-sync-bom-apply-report.json");

export function normalizeAutoApplyFilter(value: string | undefined): AutoApplyDashboardFilter {
  const v = (value ?? "ALL").trim().toUpperCase();
  const allowed: AutoApplyDashboardFilter[] = [
    "ALL",
    "BLOCKED",
    "DIVERGENT",
    "OPTIONAL_PENDING",
    "LOCAL_PENDING",
    "SKIPPED",
    "NO_CHANGES",
    "APPLIED",
    "ERROR",
  ];
  return allowed.includes(v as AutoApplyDashboardFilter) ? (v as AutoApplyDashboardFilter) : "ALL";
}

function matchesReason(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function classifyAutoApplyProduct(
  product: NomusBomAutoApplyProductResult
): Omit<
  AutoApplyBomDashboardProductRow,
  | "parentCode"
  | "productId"
  | "status"
  | "canApply"
  | "errorMessage"
  | "pendingTypeLabel"
  | "recommendedAction"
  | "recommendedTab"
  | "severity"
  | "actionsCount"
  | "actionsSummaryLines"
> {
  const blockingReasons = product.blockingReasons ?? [];
  const actions = product.actionsPreview ?? [];

  const quantityDiffCount = actions.filter((a) => a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY").length;
  const metadataOnlyCount = actions.filter(
    (a) => a.actionType === "UPDATE_PRODUCT_BOM_NOMUS_METADATA"
  ).length;

  const localOnlyLineCodes = actions
    .filter(
      (a) =>
        a.actionType === "REMOVE_PRODUCT_BOM_LINE" ||
        (a.actionType === "KEEP_PRODUCT_BOM_LINE" &&
          /local|somente IndusCost|115\.08/i.test(String(a.componentCode)))
    )
    .map((a) => a.componentCode)
    .filter(Boolean);

  const categories = new Set<AutoApplyProductCategory>();
  if (product.status === "APPLIED") categories.add("APPLIED");
  if (product.status === "NO_CHANGES") categories.add("NO_CHANGES");
  if (product.status === "BLOCKED") categories.add("BLOCKED");
  if (product.status === "SKIPPED") categories.add("SKIPPED");
  if (product.status === "ERROR") categories.add("ERROR");

  const optionalPending = blockingReasons.some((r) =>
    matchesReason(r, [/opcionais?/i, /OPTIONAL/i, /precifica/i])
  );
  const localPending = blockingReasons.some((r) =>
    matchesReason(r, [/local/i, /somente IndusCost/i, /revisão de engenharia/i, /LOCAL_REVIEW/i])
  );
  const notInIndus = blockingReasons.some((r) =>
    matchesReason(r, [/Produto não cadastrado/i, /NO_PRODUCT/i, /não encontrado no IndusCost/i])
  );

  if (optionalPending) categories.add("OPTIONAL_PENDING");
  if (localPending) categories.add("LOCAL_ITEM_PENDING");
  if (notInIndus) categories.add("NOT_IN_INDUS");
  if (quantityDiffCount > 0) categories.add("QUANTITY_DIVERGENT");
  if (metadataOnlyCount > 0) categories.add("METADATA_PENDING");

  const filterBuckets = new Set<AutoApplyDashboardFilter>();
  if (product.status === "BLOCKED") filterBuckets.add("BLOCKED");
  if (product.status === "SKIPPED") filterBuckets.add("SKIPPED");
  if (product.status === "NO_CHANGES") filterBuckets.add("NO_CHANGES");
  if (product.status === "APPLIED") filterBuckets.add("APPLIED");
  if (product.status === "ERROR") filterBuckets.add("ERROR");
  if (quantityDiffCount > 0 || metadataOnlyCount > 0) filterBuckets.add("DIVERGENT");
  if (optionalPending) filterBuckets.add("OPTIONAL_PENDING");
  if (localPending || localOnlyLineCodes.length > 0) filterBuckets.add("LOCAL_PENDING");

  let primaryReason = "Sem pendências registradas.";
  if (product.errorMessage) primaryReason = product.errorMessage;
  else if (blockingReasons.length > 0) primaryReason = blockingReasons[0];
  else if (quantityDiffCount > 0)
    primaryReason = `${quantityDiffCount} componente(s) com divergência de quantidade.`;
  else if (metadataOnlyCount > 0)
    primaryReason = `${metadataOnlyCount} componente(s) aguardando metadata Nomus.`;
  else if (product.status === "NO_CHANGES") primaryReason = "Alinhado com Nomus — sem alteração necessária.";
  else if (product.status === "APPLIED") primaryReason = "BOM aplicada/atualizada na última rotina.";

  return {
    primaryReason,
    blockingReasons,
    categories: [...categories],
    filterBuckets: filterBuckets.size > 0 ? [...filterBuckets] : ["ALL"],
    quantityDiffCount,
    metadataOnlyCount,
    localOnlyLineCodes,
    actionsPreview: actions,
  };
}

export function bucketBlockingReasons(
  products: NomusBomAutoApplyProductResult[]
): AutoApplyBlockingReasonBucket[] {
  const defs: Array<{ key: string; label: string; patterns: RegExp[] }> = [
    {
      key: "LOCAL_ITEM_PENDING",
      label: "Itens locais somente IndusCost pendentes",
      patterns: [/local/i, /somente IndusCost/i, /revisão de engenharia/i, /LOCAL_REVIEW/i],
    },
    {
      key: "OPTIONAL_PENDING",
      label: "Opcionais de precificação pendentes",
      patterns: [/opcionais?/i, /OPTIONAL/i, /precifica/i],
    },
    {
      key: "NOT_IN_INDUS",
      label: "Produto não cadastrado no IndusCost",
      patterns: [/Produto não cadastrado/i, /NO_PRODUCT/i, /não encontrado no IndusCost/i],
    },
    {
      key: "EFFECTIVE_BOM_BLOCKED",
      label: "BOM efetiva bloqueada ou incompleta",
      patterns: [/BOM efetiva bloqueada/i, /EFFECTIVE_BOM/i, /incompleta/i],
    },
    {
      key: "UNRESOLVED_COMPONENT",
      label: "Componentes não resolvidos (Material/Produto)",
      patterns: [/sem resolução/i, /UNRESOLVED/i, /Material ou Produto/i],
    },
    {
      key: "OTHER",
      label: "Outros bloqueios",
      patterns: [/.*/],
    },
  ];

  const counts = new Map<string, number>();
  for (const def of defs) counts.set(def.key, 0);

  for (const product of products) {
    if (product.status !== "BLOCKED" && product.status !== "SKIPPED") continue;
    const reasons = product.blockingReasons ?? [];
    if (reasons.length === 0) {
      counts.set("OTHER", (counts.get("OTHER") ?? 0) + 1);
      continue;
    }

    let bucketKey = "OTHER";
    for (const reason of reasons) {
      for (const def of defs) {
        if (def.key === "OTHER") continue;
        if (def.patterns.some((re) => re.test(reason))) {
          bucketKey = def.key;
          break;
        }
      }
      if (bucketKey !== "OTHER") break;
    }
    counts.set(bucketKey, (counts.get(bucketKey) ?? 0) + 1);
  }

  return defs
    .map((def) => ({
      key: def.key,
      label: def.label,
      count: counts.get(def.key) ?? 0,
    }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
}

function parseReportJson(raw: string): NomusBomAutoApplyReport | null {
  try {
    const parsed = JSON.parse(raw) as NomusBomAutoApplyReport;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.products)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readLatestReportFile(reportPath = DEFAULT_REPORT_JSON): NomusBomAutoApplyReport | null {
  if (!existsSync(reportPath)) return null;
  try {
    return parseReportJson(readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

async function readLatestBatchRunReport(): Promise<NomusBomAutoApplyReport | null> {
  const runs = await prisma.engineeringSyncRun.findMany({
    where: { mode: "ALL_NOMUS_PRODUCTS" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      startedAt: true,
      finishedAt: true,
      approvedBy: true,
      summaryJson: true,
    },
  });

  const run = runs.find((r) => {
    const summary = (r.summaryJson as Record<string, unknown> | null) ?? null;
    return summary?.origin === "NOMUS_SYNC";
  });
  if (!run) return null;

  const summary = (run.summaryJson as Record<string, unknown> | null) ?? null;
  const totals = (summary?.totals as NomusBomAutoApplyReport["totals"] | undefined) ?? null;
  if (!totals) return null;

  return {
    generatedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
    mode: "APPLY",
    startedAt: run.startedAt?.toISOString() ?? run.finishedAt?.toISOString() ?? new Date().toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
    approvedBy: run.approvedBy ?? "nomus-auto-sync",
    batchRunId: run.id,
    reportMdPath: typeof summary?.reportMdPath === "string" ? summary.reportMdPath : null,
    reportJsonPath: typeof summary?.reportJsonPath === "string" ? summary.reportJsonPath : null,
    totals,
    products: [],
  };
}

function mapProductRows(products: NomusBomAutoApplyProductResult[]): AutoApplyBomDashboardProductRow[] {
  return products.map((product) =>
    enrichDashboardProductRow({
      parentCode: product.parentCode,
      productId: product.productId,
      status: product.status,
      canApply: product.canApply,
      errorMessage: product.errorMessage,
      ...classifyAutoApplyProduct(product),
      pendingTypeLabel: "",
      recommendedAction: "",
      recommendedTab: "overview",
      severity: 0,
      actionsCount: 0,
      actionsSummaryLines: [],
    })
  );
}

export async function buildNomusAutoApplyBomDashboard(input: {
  filter?: AutoApplyDashboardFilter;
  search?: string;
  reportPath?: string;
} = {}): Promise<AutoApplyBomDashboardResult> {
  const filter = input.filter ?? "ALL";
  const search = input.search?.trim() || null;
  const reportPath = input.reportPath ?? DEFAULT_REPORT_JSON;

  const fileReport = readLatestReportFile(reportPath);
  const runFallback = fileReport ? null : await readLatestBatchRunReport();
  const report = fileReport ?? runFallback;

  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY",
      source: "NONE",
      hasReport: false,
      hasProductList: false,
      partialReportWarning: null,
      emptyMessage: "Nenhuma rotina de auto apply BOM executada ainda.",
      lastRun: null,
      totals: null,
      blockingReasonBuckets: [],
      products: [],
      filterCounts: {
        ALL: 0,
        BLOCKED: 0,
        DIVERGENT: 0,
        OPTIONAL_PENDING: 0,
        LOCAL_PENDING: 0,
        SKIPPED: 0,
        NO_CHANGES: 0,
        APPLIED: 0,
        ERROR: 0,
      },
      totalProducts: 0,
      filter,
      search,
      matchedCount: 0,
    };
  }

  const allRows = mapProductRows(report.products);
  const hasProductList = allRows.length > 0;
  const partialReportWarning =
    !hasProductList && report.totals
      ? "Relatório parcial: totais disponíveis, mas a lista de produtos não está no arquivo JSON. Execute novamente sync:nomus:all:apply para regenerar o relatório completo."
      : null;

  const filterCounts = computeFilterCounts(allRows);

  return {
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    source: fileReport ? "REPORT_FILE" : "ENGINEERING_SYNC_RUN",
    hasReport: true,
    hasProductList,
    partialReportWarning,
    emptyMessage: null,
    lastRun: {
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      approvedBy: report.approvedBy,
      batchRunId: report.batchRunId,
      mode: report.mode,
      reportJsonPath: report.reportJsonPath,
      reportMdPath: report.reportMdPath,
    },
    totals: report.totals,
    blockingReasonBuckets: bucketBlockingReasons(report.products),
    products: allRows,
    filterCounts,
    totalProducts: allRows.length,
    filter,
    search,
    matchedCount: allRows.length,
  };
}
