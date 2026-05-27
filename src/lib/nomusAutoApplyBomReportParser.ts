/**
 * Parser robusto do relatório JSON de auto apply BOM Nomus.
 * Aceita formatos legados e atuais (products, items, result.products, summary, etc.).
 */
import type {
  NomusBomAutoApplyMode,
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyProductStatus,
  NomusBomAutoApplyReport,
  NomusBomAutoApplyTotals,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";

export type ParsedAutoApplyReport = {
  report: NomusBomAutoApplyReport;
  products: NomusBomAutoApplyProductResult[];
  totals: NomusBomAutoApplyTotals;
  productListSource: string | null;
  hasProductList: boolean;
};

const VALID_STATUSES = new Set<NomusBomAutoApplyProductStatus>([
  "APPLIED",
  "NO_CHANGES",
  "BLOCKED",
  "SKIPPED",
  "ERROR",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function readString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => readString(v)).filter(Boolean);
}

function normalizeStatus(value: unknown): NomusBomAutoApplyProductStatus {
  const s = readString(value, "SKIPPED").toUpperCase();
  return VALID_STATUSES.has(s as NomusBomAutoApplyProductStatus)
    ? (s as NomusBomAutoApplyProductStatus)
    : "SKIPPED";
}

function normalizeMode(value: unknown): NomusBomAutoApplyMode {
  const m = readString(value, "APPLY").toUpperCase();
  return m === "DRY" ? "DRY" : "APPLY";
}

function normalizeActionsPreview(
  value: unknown
): NomusBomAutoApplyProductResult["actionsPreview"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const o = asRecord(raw);
      if (!o) return null;
      const componentCode = readString(o.componentCode ?? o.component_code ?? o.code).trim();
      const actionType = readString(o.actionType ?? o.action_type ?? o.type).trim();
      if (!componentCode || !actionType) return null;
      return {
        actionType,
        componentCode,
        currentQuantity: (() => {
          const v =
            o.currentQuantity != null
              ? readNumber(o.currentQuantity, NaN)
              : o.current_quantity != null
                ? readNumber(o.current_quantity, NaN)
                : null;
          return v != null && Number.isFinite(v) ? v : null;
        })(),
        effectiveQuantity: (() => {
          const v =
            o.effectiveQuantity != null
              ? readNumber(o.effectiveQuantity, NaN)
              : o.effective_quantity != null
                ? readNumber(o.effective_quantity, NaN)
                : null;
          return v != null && Number.isFinite(v) ? v : null;
        })(),
      };
    })
    .filter(Boolean) as NonNullable<NomusBomAutoApplyProductResult["actionsPreview"]>;
}

export function normalizeAutoApplyProductItem(raw: unknown): NomusBomAutoApplyProductResult | null {
  const o = asRecord(raw);
  if (!o) return null;

  const parentCode = readString(o.parentCode ?? o.parent_code ?? o.code).trim();
  if (!parentCode) return null;

  const productIdRaw = o.productId ?? o.product_id ?? o.indusProductId ?? o.indus_product_id;
  const productId =
    productIdRaw == null || productIdRaw === "" ? null : readString(productIdRaw);

  return {
    parentCode,
    productId,
    status: normalizeStatus(o.status),
    canApply: Boolean(o.canApply ?? o.can_apply ?? false),
    resultStatus:
      o.resultStatus === "APPLIED" || o.resultStatus === "NO_CHANGES"
        ? o.resultStatus
        : o.result_status === "APPLIED" || o.result_status === "NO_CHANGES"
          ? o.result_status
          : undefined,
    blockingReasons: readStringArray(o.blockingReasons ?? o.blocking_reasons ?? o.reasons),
    errorMessage: readString(o.errorMessage ?? o.error_message ?? "", "") || undefined,
    actionsPreview: normalizeActionsPreview(
      o.actionsPreview ?? o.actions_preview ?? o.actions ?? o.actionPreview
    ),
  };
}

export function normalizeAutoApplyTotals(raw: unknown): NomusBomAutoApplyTotals | null {
  const o = asRecord(raw);
  if (!o) return null;

  const parentsEvaluated = readNumber(
    o.parentsEvaluated ?? o.parents_evaluated ?? o.evaluated ?? o.totalEvaluated
  );
  const parentsBlocked = readNumber(o.parentsBlocked ?? o.parents_blocked ?? o.blocked);
  const parentsNoChanges = readNumber(
    o.parentsNoChanges ?? o.parents_no_changes ?? o.noChanges ?? o.no_changes
  );
  const parentsApplied = readNumber(o.parentsApplied ?? o.parents_applied ?? o.applied);
  const parentsSkipped = readNumber(o.parentsSkipped ?? o.parents_skipped ?? o.skipped);
  const parentsErrored = readNumber(
    o.parentsErrored ?? o.parents_errored ?? o.errored ?? o.errors ?? o.errorCount
  );

  const hasAny =
    parentsEvaluated > 0 ||
    parentsBlocked > 0 ||
    parentsNoChanges > 0 ||
    parentsApplied > 0 ||
    parentsSkipped > 0 ||
    parentsErrored > 0;

  if (!hasAny) return null;

  return {
    parentsInNomusStage: readNumber(
      o.parentsInNomusStage ?? o.parents_in_nomus_stage ?? o.inNomusStage,
      parentsEvaluated
    ),
    parentsEvaluated,
    parentsApplied,
    parentsNoChanges,
    parentsBlocked,
    parentsSkipped,
    parentsErrored,
    linesCreated: readNumber(o.linesCreated ?? o.lines_created ?? o.created),
    linesUpdated: readNumber(o.linesUpdated ?? o.lines_updated ?? o.updated),
    linesRemoved: readNumber(o.linesRemoved ?? o.lines_removed ?? o.removed),
    linesKept: readNumber(o.linesKept ?? o.lines_kept ?? o.kept),
  };
}

type ProductListCandidate = { path: string; value: unknown };

function collectProductListCandidates(root: Record<string, unknown>): ProductListCandidate[] {
  const nested = [
    ["result", "products"],
    ["result", "items"],
    ["result", "results"],
    ["report", "products"],
    ["report", "items"],
    ["details", "items"],
    ["details", "products"],
    ["data", "products"],
    ["data", "items"],
  ] as const;

  const candidates: ProductListCandidate[] = [
    { path: "products", value: root.products },
    { path: "items", value: root.items },
    { path: "results", value: root.results },
    { path: "rows", value: root.rows },
  ];

  for (const [a, b] of nested) {
    const parent = asRecord(root[a]);
    if (parent) candidates.push({ path: `${a}.${b}`, value: parent[b] });
  }

  return candidates;
}

export function extractProductListFromReportJson(
  parsed: unknown
): { products: NomusBomAutoApplyProductResult[]; source: string | null } {
  const root = asRecord(parsed);
  if (!root) return { products: [], source: null };

  for (const candidate of collectProductListCandidates(root)) {
    if (!Array.isArray(candidate.value)) continue;
    const products = candidate.value
      .map((item) => normalizeAutoApplyProductItem(item))
      .filter(Boolean) as NomusBomAutoApplyProductResult[];
    if (products.length > 0) {
      return { products, source: candidate.path };
    }
  }

  // Aceita array vazio explícito em products/items (relatório válido sem linhas)
  if (Array.isArray(root.products)) return { products: [], source: "products" };
  if (Array.isArray(root.items)) return { products: [], source: "items" };

  return { products: [], source: null };
}

export function extractTotalsFromReportJson(parsed: unknown): NomusBomAutoApplyTotals | null {
  const root = asRecord(parsed);
  if (!root) return null;

  const candidates = [
    root.totals,
    root.summary,
    asRecord(root.result)?.totals,
    asRecord(root.result)?.summary,
    asRecord(root.report)?.totals,
    asRecord(root.report)?.summary,
  ];

  for (const candidate of candidates) {
    const totals = normalizeAutoApplyTotals(candidate);
    if (totals) return totals;
  }

  return null;
}

export function parseAutoApplyReportJson(raw: string): ParsedAutoApplyReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const root = asRecord(parsed);
  if (!root) return null;

  const totals = extractTotalsFromReportJson(parsed);
  if (!totals) return null;

  const { products, source } = extractProductListFromReportJson(parsed);

  const report: NomusBomAutoApplyReport = {
    generatedAt: readString(root.generatedAt ?? root.generated_at ?? root.finishedAt, new Date().toISOString()),
    mode: normalizeMode(root.mode),
    startedAt: readString(root.startedAt ?? root.started_at, new Date().toISOString()),
    finishedAt: readString(root.finishedAt ?? root.finished_at, new Date().toISOString()),
    approvedBy: readString(root.approvedBy ?? root.approved_by, "nomus-auto-sync"),
    batchRunId:
      root.batchRunId != null
        ? readString(root.batchRunId)
        : root.batch_run_id != null
          ? readString(root.batch_run_id)
          : null,
    reportMdPath:
      root.reportMdPath != null
        ? readString(root.reportMdPath)
        : root.report_md_path != null
          ? readString(root.report_md_path)
          : null,
    reportJsonPath:
      root.reportJsonPath != null
        ? readString(root.reportJsonPath)
        : root.report_json_path != null
          ? readString(root.report_json_path)
          : null,
    totals,
    products,
  };

  return {
    report,
    products,
    totals,
    productListSource: source,
    hasProductList: products.length > 0,
  };
}

/** Formato canônico gravado em disco — summary + items + products. */
export function serializeAutoApplyReportForDisk(report: NomusBomAutoApplyReport): Record<string, unknown> {
  return {
    generatedAt: report.generatedAt,
    mode: report.mode,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    approvedBy: report.approvedBy,
    batchRunId: report.batchRunId,
    reportMdPath: report.reportMdPath,
    reportJsonPath: report.reportJsonPath,
    totals: report.totals,
    summary: report.totals,
    products: report.products,
    items: report.products,
  };
}
