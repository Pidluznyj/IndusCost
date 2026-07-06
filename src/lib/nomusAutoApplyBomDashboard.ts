import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  computeAutoApplyStatusTotals,
  computeFilterCounts,
  enrichDashboardProductRow,
} from "@/src/lib/nomusAutoApplyBomDashboardShared";
import { reconcileReportProductStatus } from "@/src/lib/nomusBomApplyStatus";
import {
  parseAutoApplyReportJson,
  type ParsedAutoApplyReport,
} from "@/src/lib/nomusAutoApplyBomReportParser";
import { prisma } from "@/src/lib/prisma";
import { revalidateAutoApplyDashboardProducts } from "@/src/lib/nomusAutoApplyDashboardRevalidation";
import { getLatestSuccessfulAutoApplyDashboardSnapshot } from "@/src/lib/nomusAutoApplyDashboardRevalidationJob";

const DEFAULT_REPORT_JSON = join(process.cwd(), "docs/generated/nomus-auto-sync-bom-apply-report.json");
export const NOMUS_AUTO_APPLY_REGENERATE_COMMAND = "npm run sync:nomus:all:apply";

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
    "READY_TO_APPLY",
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
  | "readyToApply"
  | "hasUnappliedBomDiff"
  | "appliedToOfficialBom"
  | "planHash"
  | "confirmationRequiredText"
  | "diffSummary"
  | "applyRunId"
  | "resultStatus"
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
  if (product.status === "READY_TO_APPLY") categories.add("READY_TO_APPLY");
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
  if (product.status === "READY_TO_APPLY") filterBuckets.add("READY_TO_APPLY");
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
  else if (product.status === "READY_TO_APPLY")
    primaryReason = "Correções resolvidas; BOM oficial ainda não aplicada.";
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

function tryParseReportFile(filePath: string): ParsedAutoApplyReport | null {
  if (!existsSync(filePath)) return null;
  try {
    return parseAutoApplyReportJson(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listReportJsonCandidates(reportDir: string): string[] {
  if (!existsSync(reportDir)) return [DEFAULT_REPORT_JSON];

  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("nomus-auto-sync-bom-apply-report") || !name.endsWith(".json")) continue;
    const path = join(reportDir, name);
    try {
      files.push({ path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      /* ignore */
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const ordered = files.map((f) => f.path);
  if (!ordered.includes(DEFAULT_REPORT_JSON)) ordered.unshift(DEFAULT_REPORT_JSON);
  return ordered;
}

function pickBestParsedReport(candidates: ParsedAutoApplyReport[]): ParsedAutoApplyReport | null {
  if (candidates.length === 0) return null;

  const withList = candidates.filter((c) => c.hasProductList);
  if (withList.length > 0) {
    withList.sort((a, b) => b.products.length - a.products.length);
    return withList[0];
  }

  return candidates[0];
}

function readLatestReportFile(reportPath = DEFAULT_REPORT_JSON): ParsedAutoApplyReport | null {
  const reportDir = join(reportPath, "..");
  const paths = listReportJsonCandidates(reportDir);

  const parsedCandidates: ParsedAutoApplyReport[] = [];
  for (const path of paths) {
    const parsed = tryParseReportFile(path);
    if (parsed) parsedCandidates.push(parsed);
  }

  return pickBestParsedReport(parsedCandidates);
}

async function readLatestBatchRunReport(): Promise<ParsedAutoApplyReport | null> {
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

  const reportJsonPath =
    typeof summary?.reportJsonPath === "string" ? summary.reportJsonPath : null;

  if (reportJsonPath) {
    const fromPath = tryParseReportFile(reportJsonPath);
    if (fromPath?.hasProductList) return fromPath;
  }

  const fromDir = readLatestReportFile();
  if (fromDir?.hasProductList) return fromDir;

  return {
    report: {
      generatedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
      mode: "APPLY",
      startedAt: run.startedAt?.toISOString() ?? run.finishedAt?.toISOString() ?? new Date().toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
      approvedBy: run.approvedBy ?? "nomus-auto-sync",
      batchRunId: run.id,
      reportMdPath: typeof summary?.reportMdPath === "string" ? summary.reportMdPath : null,
      reportJsonPath,
      totals,
      products: [],
    },
    products: [],
    totals,
    productListSource: null,
    hasProductList: false,
  };
}

export type AutoApplyReportContext = {
  parsed: ParsedAutoApplyReport | null;
  fileReport: ParsedAutoApplyReport | null;
  runFallback: ParsedAutoApplyReport | null;
};

export async function loadAutoApplyReportContextForDashboard(input?: {
  reportPath?: string;
}): Promise<AutoApplyReportContext> {
  const explicitReportPath = input?.reportPath?.trim() || null;
  const reportPath = explicitReportPath ?? DEFAULT_REPORT_JSON;

  const fileReport = explicitReportPath
    ? tryParseReportFile(explicitReportPath)
    : readLatestReportFile(reportPath);
  const runFallback =
    explicitReportPath == null && fileReport == null
      ? await readLatestBatchRunReport().catch(() => null)
      : null;
  const parsed = explicitReportPath
    ? fileReport
    : fileReport?.hasProductList
      ? fileReport
      : runFallback?.hasProductList
        ? runFallback
        : fileReport ?? runFallback;

  return { parsed, fileReport, runFallback };
}

export async function loadParsedAutoApplyReportForDashboard(input?: {
  reportPath?: string;
}): Promise<ParsedAutoApplyReport | null> {
  const context = await loadAutoApplyReportContextForDashboard(input);
  return context.parsed;
}

function mapProductRows(products: NomusBomAutoApplyProductResult[]): AutoApplyBomDashboardProductRow[] {
  return products.map((raw) => {
    const product = reconcileReportProductStatus(raw);
    return enrichDashboardProductRow({
      parentCode: product.parentCode,
      productId: product.productId,
      status: product.status,
      canApply: product.canApply,
      errorMessage: product.errorMessage,
      planHash: product.planHash ?? null,
      confirmationRequiredText: product.confirmationRequiredText ?? null,
      applyRunId: product.applyRunId ?? null,
      resultStatus: product.resultStatus,
      ...classifyAutoApplyProduct(product),
      pendingTypeLabel: "",
      recommendedAction: "",
      recommendedTab: "overview",
      severity: 0,
      actionsCount: 0,
      actionsSummaryLines: [],
      readyToApply: false,
      hasUnappliedBomDiff: false,
      appliedToOfficialBom: false,
      diffSummary: "",
    });
  });
}

export function assembleAutoApplyBomDashboardResult(input: {
  parsed: ParsedAutoApplyReport;
  productsForRows: NomusBomAutoApplyProductResult[];
  filter?: AutoApplyDashboardFilter;
  search?: string | null;
  statusRevalidatedAt?: string | null;
  revalidatedProductCount?: number;
  revalidationErrorCount?: number;
  fileReport?: ParsedAutoApplyReport | null;
  runFallback?: ParsedAutoApplyReport | null;
}): AutoApplyBomDashboardResult {
  const filter = input.filter ?? "ALL";
  const search = input.search?.trim() || null;
  const statusRevalidatedAt = input.statusRevalidatedAt ?? null;
  const revalidatedProductCount = input.revalidatedProductCount ?? 0;
  const revalidationErrorCount = input.revalidationErrorCount ?? 0;
  const parsed = input.parsed;
  const productsForRows = input.productsForRows;
  const report = parsed.report;

  const allRows = mapProductRows(productsForRows);
  const hasProductList = parsed.hasProductList && allRows.length > 0;
  const needsReportRegeneration = !hasProductList && Boolean(parsed.totals);
  const partialReportWarning = needsReportRegeneration
    ? `Relatório parcial: totais disponíveis (${parsed.totals.parentsBlocked} bloqueados), mas a lista de produtos não está no snapshot atual. Clique em "Atualizar painel da engenharia" para reconstruir a fila a partir do stage Nomus (preview read-only em segundo plano) ou regenere o relatório com: ${NOMUS_AUTO_APPLY_REGENERATE_COMMAND}`
    : null;

  const filterCounts = computeFilterCounts(allRows);
  const batchTotals = parsed.totals;
  const liveTotals =
    hasProductList && productsForRows.length > 0
      ? computeAutoApplyStatusTotals(productsForRows, batchTotals)
      : batchTotals;

  const fileReport = input.fileReport;
  const runFallback = input.runFallback;
  const source: AutoApplyBomDashboardResult["source"] =
    fileReport?.hasProductList && parsed === fileReport
      ? "REPORT_FILE"
      : runFallback?.hasProductList && parsed === runFallback
        ? "ENGINEERING_SYNC_RUN"
        : "REPORT_FILE";

  const checklistMdPath = join(process.cwd(), "docs/generated/nomus-engineering-validation-checklist.md");
  const checklistExists = existsSync(checklistMdPath);

  return {
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    source,
    hasReport: true,
    hasProductList,
    needsReportRegeneration,
    regenerateReportCommand: needsReportRegeneration ? NOMUS_AUTO_APPLY_REGENERATE_COMMAND : null,
    productListSource: parsed.productListSource,
    checklistMdPath: checklistExists ? checklistMdPath : null,
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
    totals: liveTotals,
    batchTotals: statusRevalidatedAt != null && batchTotals != null ? batchTotals : null,
    blockingReasonBuckets: bucketBlockingReasons(productsForRows),
    products: allRows,
    filterCounts,
    totalProducts: allRows.length,
    filter,
    search,
    matchedCount: allRows.length,
    statusRevalidatedAt,
    revalidatedProductCount,
    revalidationErrorCount,
    batchTotalsNote:
      statusRevalidatedAt != null
        ? "Cards e filtros refletem a lista revalidada (preview read-only). Totais da última execução batch APPLY aparecem abaixo quando diferentes."
        : parsed.totals
          ? "Status da lista conforme o último relatório batch salvo. Use Atualizar painel da engenharia para revalidar bloqueados com preview read-only em segundo plano."
          : null,
  };
}

export type BuildNomusAutoApplyBomDashboardDeps = {
  /** Injeção para teste: carrega o último snapshot SUCCESS persistido. */
  loadSnapshot?: typeof getLatestSuccessfulAutoApplyDashboardSnapshot;
};

export async function buildNomusAutoApplyBomDashboard(
  input: {
    filter?: AutoApplyDashboardFilter;
    search?: string;
    /** Caminho explícito: lê só esse arquivo (sem varrer docs/generated nem DB). */
    reportPath?: string;
    /** Reavalia bloqueados/ignorados com preview read-only síncrono (evitar em GET — usar job). */
    revalidateBlocked?: boolean;
    /** Retorna último snapshot SUCCESS persistido quando disponível. */
    preferSnapshot?: boolean;
  } = {},
  deps: BuildNomusAutoApplyBomDashboardDeps = {}
): Promise<AutoApplyBomDashboardResult> {
  const filter = input.filter ?? "ALL";
  const search = input.search?.trim() || null;
  const revalidateBlocked = input.revalidateBlocked === true;
  const preferSnapshot = input.preferSnapshot !== false;
  const loadSnapshot = deps.loadSnapshot ?? getLatestSuccessfulAutoApplyDashboardSnapshot;

  // Precedência: snapshot SUCCESS com lista viva > relatório JSON parcial em docs/generated.
  // Um relatório parcial (só totais) nunca pode esconder a fila operacional do snapshot.
  if (preferSnapshot && !revalidateBlocked) {
    const stored = await loadSnapshot();
    if (stored?.result) {
      return {
        ...stored.result,
        generatedAt: new Date().toISOString(),
        filter,
        search,
        matchedCount: stored.result.totalProducts,
      };
    }
  }

  const explicitReportPath = input.reportPath?.trim() || null;
  const { parsed, fileReport, runFallback } = await loadAutoApplyReportContextForDashboard({
    reportPath: explicitReportPath ?? undefined,
  });

  if (!parsed) {
    return {
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY",
      source: "NONE",
      hasReport: false,
      hasProductList: false,
      needsReportRegeneration: false,
      regenerateReportCommand: null,
      productListSource: null,
      checklistMdPath: null,
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
        READY_TO_APPLY: 0,
        APPLIED: 0,
        ERROR: 0,
      },
      totalProducts: 0,
      filter,
      search,
      matchedCount: 0,
      statusRevalidatedAt: null,
      revalidatedProductCount: 0,
      revalidationErrorCount: 0,
      batchTotalsNote: null,
      batchTotals: null,
    };
  }

  let statusRevalidatedAt: string | null = null;
  let revalidatedProductCount = 0;
  let revalidationErrorCount = 0;
  let productsForRows = parsed.products;

  if (revalidateBlocked && parsed.hasProductList && parsed.products.length > 0) {
    const revalidated = await revalidateAutoApplyDashboardProducts(parsed.products);
    productsForRows = revalidated.products;
    revalidatedProductCount = revalidated.revalidatedCount;
    revalidationErrorCount = revalidated.revalidationErrors;
    statusRevalidatedAt = new Date().toISOString();
  }

  return assembleAutoApplyBomDashboardResult({
    parsed,
    productsForRows,
    filter,
    search,
    statusRevalidatedAt,
    revalidatedProductCount,
    revalidationErrorCount,
    fileReport,
    runFallback,
  });
}
