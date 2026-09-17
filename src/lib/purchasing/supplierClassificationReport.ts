/**
 * Compras → Performance → Classificação de fornecedores.
 *
 * Read model ÚNICO do relatório de avaliação e monitoramento de fornecedores.
 * Motor PURO (sem Prisma, sem I/O, browser-safe): tela, JSON, XLSX e PDF leem
 * exatamente esta saída. Nenhum consumidor recalcula nota, cobertura, faixa,
 * contagem ou população.
 *
 * Reaproveita, sem duplicar:
 * - população canônica: `buildSupplierPerformanceDashboardPopulation` (mesmo
 *   período, mesmo predicado de cancelado, mesma moeda da aba Performance);
 * - consolidado por fornecedor: `buildSupplierPerformanceDashboard` (motor
 *   OP-26 via `DashboardSupplierRow.evaluation`);
 * - faixa de desempenho: `classifySupplierPerformance` (política interna).
 *
 * Proibido aqui: nota nova, escala nova, peso novo, conversão V1↔V2, ponderação
 * por valor financeiro, cobertura influenciando a faixa.
 */

import {
  SUPPLIER_CLASSIFICATION_BANDS,
  SUPPLIER_CLASSIFICATION_POLICY_ID,
  SUPPLIER_CLASSIFICATION_POLICY_SCALE,
  SUPPLIER_CLASSIFICATION_POLICY_TEXT,
  SUPPLIER_CLASSIFICATION_POLICY_VERSION,
  type SupplierClassification,
  type SupplierClassificationCode,
} from "./supplierClassificationPolicy.js";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
  getSupplierEvaluationMethodology,
  type SupplierPerformancePeriod,
} from "./supplierPerformance.js";
import {
  buildSupplierPerformanceDashboard,
  buildSupplierPerformanceDashboardPopulation,
  type DashboardFinancialDataStatus,
  type DashboardSpendBasis,
  type SupplierPerformanceDashboardFilters,
  type SupplierPerformanceDashboardInput,
  type SupplierPerformanceDashboardReadModel,
} from "./supplierPerformanceDashboard.js";

export const SUPPLIER_CLASSIFICATION_REPORT_TITLE =
  "Relatório de Classificação e Desempenho de Fornecedores";

/** Declaração neutra do propósito — sem invocar norma, selo ou certificação. */
export const SUPPLIER_CLASSIFICATION_REPORT_PURPOSE =
  "Evidência do processo interno de avaliação e monitoramento de fornecedores.";

/** `FinancialSupplier.status` em pt-BR (situação CADASTRAL, não de desempenho). */
export const SUPPLIER_REGISTRY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  NEEDS_REVIEW: "Requer revisão",
  INACTIVE: "Inativo",
  MERGED: "Mesclado",
};

export function describeSupplierRegistryStatus(status: string | null | undefined): string {
  if (!status) return "Não identificada";
  return SUPPLIER_REGISTRY_STATUS_LABELS[status] ?? status;
}

/* ------------------------------------------------------------------ *
 * Consulta (busca / filtro / ordenação) — mesma função na tela e no export
 * ------------------------------------------------------------------ */

export const SUPPLIER_CLASSIFICATION_REPORT_SORTS = [
  "name",
  "classification",
  "score",
  "coverage",
  "spend",
  "orders",
] as const;

export type SupplierClassificationReportSort =
  (typeof SUPPLIER_CLASSIFICATION_REPORT_SORTS)[number];

export type SupplierClassificationReportQuery = {
  search: string | null;
  classification: SupplierClassificationCode | null;
  registryStatus: string | null;
  /** Só fornecedores com pedido elegível ainda sem avaliação. */
  onlyPending: boolean;
  sort: SupplierClassificationReportSort;
  direction: "asc" | "desc";
};

export const SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY: SupplierClassificationReportQuery = {
  search: null,
  classification: null,
  registryStatus: null,
  onlyPending: false,
  sort: "classification",
  direction: "asc",
};

/** Melhor → pior. Usado só para ordenar; não altera a faixa. */
const CLASSIFICATION_RANK: Record<SupplierClassificationCode, number> = {
  APPROVED: 1,
  CONDITIONAL: 2,
  NOT_APPROVED: 3,
  LEGACY_METHODOLOGY: 4,
  NOT_EVALUATED: 5,
};

const CLASSIFICATION_CODES = SUPPLIER_CLASSIFICATION_BANDS.map((band) => band.code);

function readParam(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * Tolerante de propósito (padrão dos filtros de apresentação do módulo): valor
 * desconhecido cai no default e NUNCA amplia a população — período, cancelados,
 * fornecedor, MP e moeda continuam sendo validados fail-fast por
 * `parseSupplierPerformanceDashboardFilters`.
 */
export function parseSupplierClassificationReportQuery(
  query: Record<string, unknown>
): SupplierClassificationReportQuery {
  const sortRaw = readParam(query.sort);
  const directionRaw = readParam(query.direction);
  const classificationRaw = readParam(query.classification);
  const registryRaw = readParam(query.registryStatus);
  const pendingRaw = readParam(query.onlyPending);

  const sort = (SUPPLIER_CLASSIFICATION_REPORT_SORTS as readonly string[]).includes(sortRaw ?? "")
    ? (sortRaw as SupplierClassificationReportSort)
    : SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY.sort;

  return {
    search: readParam(query.search) ?? readParam(query.q),
    classification: (CLASSIFICATION_CODES as readonly string[]).includes(classificationRaw ?? "")
      ? (classificationRaw as SupplierClassificationCode)
      : null,
    registryStatus: registryRaw,
    onlyPending: pendingRaw === "1" || pendingRaw === "true",
    sort,
    direction: directionRaw === "asc" || directionRaw === "desc" ? directionRaw : defaultDirection(sort),
  };
}

function defaultDirection(sort: SupplierClassificationReportSort): "asc" | "desc" {
  return sort === "name" || sort === "classification" ? "asc" : "desc";
}

/* ------------------------------------------------------------------ *
 * DTOs
 * ------------------------------------------------------------------ */

export type SupplierClassificationReportRow = {
  supplierExternalId: number;
  name: string;
  document: string | null;
  /** Situação CADASTRAL (`FinancialSupplier.status`); null = não identificada. */
  registryStatus: string | null;
  registryStatusLabel: string;
  /** Situação de DESEMPENHO (política interna). Nunca é o cadastro. */
  classification: SupplierClassification;
  overallScore: number | null;
  qualityScore: number | null;
  deliveryScore: number | null;
  conformityScore: number | null;
  serviceScore: number | null;
  /** Escala em que a nota está consolidada (V2 = 5; V1 legado = 10). */
  scaleMax: number | null;
  methodologyVersion: number | null;
  methodologyId: string | null;
  eligibleOrders: number;
  evaluatedOrders: number;
  pendingOrders: number;
  coverage: number | null;
  hasPendingEvaluations: boolean;
  lastEvaluationAt: string | null;
  /** Contexto financeiro/operacional — jamais entra na classificação. */
  orderCount: number;
  spend: number | null;
  hasFinancialValue: boolean;
  currency: string;
};

export type SupplierClassificationEvidenceRow = {
  supplierExternalId: number | null;
  supplierName: string;
  supplierDocument: string | null;
  purchaseOrderId: string;
  purchaseOrderExternalId: number;
  purchaseOrderCode: string | null;
  /** Data operacional: COALESCE(issuedAt, firstSeenAt). */
  performanceDate: string;
  stage: string;
  canceled: boolean;
  currency: string;
  amount: number | null;
  qualityScore: number | null;
  deliveryScore: number | null;
  conformityScore: number | null;
  serviceScore: number | null;
  overallScore: number | null;
  methodologyVersion: number | null;
  methodologyId: string | null;
  scaleMax: number | null;
  revision: number | null;
  evaluatedBy: string | null;
  evaluatedAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  notes: string | null;
};

export type SupplierClassificationSummary = {
  suppliersInPopulation: number;
  suppliersEvaluated: number;
  suppliersWithoutEvaluation: number;
  approved: number;
  conditional: number;
  notApproved: number;
  notEvaluated: number;
  legacyMethodology: number;
  /** Cobertura global do período (pedidos avaliados ÷ elegíveis). */
  coverage: number | null;
  eligibleOrders: number;
  evaluatedOrders: number;
  pendingOrders: number;
};

export type SupplierClassificationAppliedFilter = { label: string; value: string };

export type SupplierClassificationReport = {
  metadata: {
    version: string;
    title: string;
    purpose: string;
    generatedAt: string;
    lastSyncedAt: string | null;
    period: SupplierPerformancePeriod;
    filters: SupplierPerformanceDashboardFilters;
    query: SupplierClassificationReportQuery;
    appliedFilters: SupplierClassificationAppliedFilter[];
    dataSource: string;
    spendBasis: DashboardSpendBasis;
    currency: { selected: string; multiCurrency: boolean };
    population: {
      orderCount: number;
      lineCount: number;
      supplierCount: number;
      materialCount: number;
      canceledExcluded: number;
      ordersWithFinancialValue: number;
      ordersWithoutValue: number;
      financialDataStatus: DashboardFinancialDataStatus;
    };
    methodology: {
      version: number;
      id: string;
      scaleMin: number;
      scaleMax: number;
      criteria: Array<{ key: string; label: string; weightPercent: number }>;
      text: readonly string[];
    };
    policy: {
      id: string;
      version: number;
      scale: typeof SUPPLIER_CLASSIFICATION_POLICY_SCALE;
      bands: typeof SUPPLIER_CLASSIFICATION_BANDS;
      text: readonly string[];
    };
    evaluation: { available: boolean; reason: string | null };
    /**
     * Mesmas opções do dashboard, reexpostas para o painel de filtros da aba —
     * evita uma segunda chamada ao backend só para popular os selects.
     */
    filterOptions: SupplierPerformanceDashboardReadModel["filterOptions"];
    availableYears: number[];
  };
  summary: SupplierClassificationSummary;
  rows: SupplierClassificationReportRow[];
  /** Uma linha por pedido elegível. `null` quando não solicitada. */
  evidence: SupplierClassificationEvidenceRow[] | null;
};

/* ------------------------------------------------------------------ *
 * Construção
 * ------------------------------------------------------------------ */

const DATA_SOURCE =
  "Espelho Nomus de Pedidos de Compra (NomusPurchaseOrder) + avaliações por pedido (NomusPurchaseOrderSupplierEvaluation).";

function comparePtBr(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

function toReportRow(
  supplier: SupplierPerformanceDashboardReadModel["suppliers"][number],
  currency: string
): SupplierClassificationReportRow {
  const evaluation = supplier.evaluation;
  const summary = evaluation?.summary ?? null;
  return {
    supplierExternalId: supplier.supplierExternalId,
    name: supplier.name,
    document: supplier.document,
    registryStatus: supplier.registryStatus,
    registryStatusLabel: describeSupplierRegistryStatus(supplier.registryStatus),
    classification: supplier.classification,
    overallScore: summary?.overallScore ?? null,
    qualityScore: summary?.qualityScore ?? null,
    deliveryScore: summary?.deliveryScore ?? null,
    conformityScore: summary?.conformityScore ?? null,
    serviceScore: summary?.serviceScore ?? null,
    scaleMax: evaluation?.scaleMax ?? null,
    methodologyVersion: evaluation?.methodologyVersion ?? null,
    methodologyId: evaluation?.methodologyId ?? null,
    eligibleOrders: summary?.eligibleOrders ?? supplier.orderCount,
    evaluatedOrders: summary?.evaluatedOrders ?? 0,
    pendingOrders: summary?.pendingOrders ?? supplier.orderCount,
    coverage: summary?.coverage ?? null,
    hasPendingEvaluations: (summary?.pendingOrders ?? supplier.orderCount) > 0,
    lastEvaluationAt: evaluation?.lastEvaluationAt ?? null,
    orderCount: supplier.orderCount,
    spend: supplier.hasFinancialValue ? supplier.spend : null,
    hasFinancialValue: supplier.hasFinancialValue,
    currency,
  };
}

/** Aplica busca/filtros/ordenação sobre linhas JÁ calculadas. Não recalcula nada. */
export function filterAndSortSupplierClassificationRows(
  rows: readonly SupplierClassificationReportRow[],
  query: SupplierClassificationReportQuery
): SupplierClassificationReportRow[] {
  const term = query.search?.toLowerCase() ?? null;
  const filtered = rows.filter((row) => {
    if (query.classification && row.classification.code !== query.classification) return false;
    if (query.registryStatus && (row.registryStatus ?? "") !== query.registryStatus) return false;
    if (query.onlyPending && !row.hasPendingEvaluations) return false;
    if (term) {
      const haystack = `${row.name} ${row.document ?? ""} ${row.supplierExternalId}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const factor = query.direction === "asc" ? 1 : -1;
  const byName = (a: SupplierClassificationReportRow, b: SupplierClassificationReportRow) =>
    comparePtBr(a.name, b.name) || a.supplierExternalId - b.supplierExternalId;

  return filtered.sort((a, b) => {
    if (query.sort === "name") return byName(a, b) * factor;
    if (query.sort === "classification") {
      const rank = CLASSIFICATION_RANK[a.classification.code] - CLASSIFICATION_RANK[b.classification.code];
      if (rank !== 0) return rank * factor;
      return byName(a, b);
    }
    if (query.sort === "orders") {
      const diff = a.orderCount - b.orderCount;
      return diff !== 0 ? diff * factor : byName(a, b);
    }
    const pick = (row: SupplierClassificationReportRow): number | null =>
      query.sort === "score" ? row.overallScore : query.sort === "coverage" ? row.coverage : row.spend;
    const av = pick(a);
    const bv = pick(b);
    // Ausência sempre por último, independente da direção — null não é zero.
    if (av == null && bv == null) return byName(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av === bv ? byName(a, b) : (av - bv) * factor;
  });
}

function buildAppliedFilters(
  dashboard: SupplierPerformanceDashboardReadModel,
  query: SupplierClassificationReportQuery
): SupplierClassificationAppliedFilter[] {
  const filters = dashboard.metadata.filters;
  const applied: SupplierClassificationAppliedFilter[] = [
    { label: "Período", value: `${filters.period.from ?? "início"} a ${filters.period.to ?? "hoje"}` },
    {
      label: "Fornecedor",
      value:
        filters.supplierExternalId == null
          ? "Todos"
          : dashboard.filterOptions.suppliers.find(
              (option) => option.supplierExternalId === filters.supplierExternalId
            )?.name ?? `ID Nomus ${filters.supplierExternalId}`,
    },
    { label: "Matéria-prima", value: filters.materialKey ?? "Todas" },
    { label: "Grupo de material", value: filters.materialGroup ?? "Todos" },
    { label: "Moeda", value: dashboard.metadata.currency.selected },
    { label: "Pedidos cancelados", value: filters.includeCanceled ? "Incluídos" : "Excluídos (regra oficial)" },
    { label: "Busca", value: query.search ?? "—" },
    {
      label: "Classificação",
      value:
        query.classification == null
          ? "Todas"
          : SUPPLIER_CLASSIFICATION_BANDS.find((band) => band.code === query.classification)?.label ??
            query.classification,
    },
    {
      label: "Situação cadastral",
      value: query.registryStatus ? describeSupplierRegistryStatus(query.registryStatus) : "Todas",
    },
    { label: "Somente com avaliações pendentes", value: query.onlyPending ? "Sim" : "Não" },
    { label: "Ordenação", value: `${query.sort} ${query.direction}` },
  ];
  return applied;
}

export function buildSupplierClassificationReport(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  options: {
    query?: SupplierClassificationReportQuery;
    includeEvidence?: boolean;
  } = {}
): SupplierClassificationReport {
  const query = options.query ?? SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY;
  const dashboard = buildSupplierPerformanceDashboard(input, filters);
  const currency = dashboard.metadata.currency.selected;

  const allRows = dashboard.suppliers.map((supplier) => toReportRow(supplier, currency));
  const rows = filterAndSortSupplierClassificationRows(allRows, query);

  // Resumo sobre a POPULAÇÃO do período (não sobre a página/filtro de leitura):
  // a auditoria precisa do universo, e os contadores de faixa vêm das mesmas
  // linhas calculadas pelo motor.
  const counters = {
    approved: 0,
    conditional: 0,
    notApproved: 0,
    notEvaluated: 0,
    legacyMethodology: 0,
  };
  let suppliersEvaluated = 0;
  for (const row of allRows) {
    switch (row.classification.code) {
      case "APPROVED":
        counters.approved += 1;
        break;
      case "CONDITIONAL":
        counters.conditional += 1;
        break;
      case "NOT_APPROVED":
        counters.notApproved += 1;
        break;
      case "LEGACY_METHODOLOGY":
        counters.legacyMethodology += 1;
        break;
      default:
        counters.notEvaluated += 1;
    }
    if (row.evaluatedOrders > 0) suppliersEvaluated += 1;
  }

  const summary: SupplierClassificationSummary = {
    suppliersInPopulation: allRows.length,
    suppliersEvaluated,
    suppliersWithoutEvaluation: allRows.length - suppliersEvaluated,
    ...counters,
    coverage: dashboard.kpis.evaluationCoverage,
    eligibleOrders: dashboard.kpis.eligibleOrders,
    evaluatedOrders: dashboard.kpis.evaluatedOrders,
    pendingOrders: Math.max(0, dashboard.kpis.eligibleOrders - dashboard.kpis.evaluatedOrders),
  };

  const methodology = getSupplierEvaluationMethodology(
    dashboard.evaluation.available ? dashboard.evaluation.methodologyVersion : undefined
  );

  return {
    metadata: {
      version: dashboard.metadata.version,
      title: SUPPLIER_CLASSIFICATION_REPORT_TITLE,
      purpose: SUPPLIER_CLASSIFICATION_REPORT_PURPOSE,
      generatedAt: dashboard.metadata.generatedAt,
      lastSyncedAt: dashboard.metadata.lastSyncedAt,
      period: dashboard.metadata.period,
      filters: dashboard.metadata.filters,
      query,
      appliedFilters: buildAppliedFilters(dashboard, query),
      dataSource: DATA_SOURCE,
      spendBasis: dashboard.metadata.spendBasis,
      currency: {
        selected: currency,
        multiCurrency: dashboard.metadata.currency.multiCurrency,
      },
      population: {
        orderCount: dashboard.metadata.population.orderCount,
        lineCount: dashboard.metadata.population.lineCount,
        supplierCount: dashboard.metadata.population.supplierCount,
        materialCount: dashboard.metadata.population.materialCount,
        canceledExcluded: dashboard.metadata.population.canceledExcluded,
        ordersWithFinancialValue: dashboard.metadata.population.ordersWithFinancialValue,
        ordersWithoutValue: dashboard.metadata.population.ordersWithoutValue,
        financialDataStatus: dashboard.metadata.population.financialDataStatus,
      },
      methodology: {
        version: methodology.version,
        id: methodology.id,
        scaleMin: methodology.scaleMin,
        scaleMax: methodology.scaleMax,
        criteria: SUPPLIER_EVALUATION_CRITERIA.map((criterion) => ({
          key: criterion.key,
          label: criterion.label,
          weightPercent: criterion.weightPercent,
        })),
        text: SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
      },
      policy: {
        id: SUPPLIER_CLASSIFICATION_POLICY_ID,
        version: SUPPLIER_CLASSIFICATION_POLICY_VERSION,
        scale: SUPPLIER_CLASSIFICATION_POLICY_SCALE,
        bands: SUPPLIER_CLASSIFICATION_BANDS,
        text: SUPPLIER_CLASSIFICATION_POLICY_TEXT,
      },
      evaluation: {
        available: dashboard.evaluation.available,
        reason: dashboard.evaluation.available === false ? dashboard.evaluation.reason : null,
      },
      filterOptions: dashboard.filterOptions,
      availableYears: dashboard.metadata.availableYears,
    },
    summary,
    rows,
    evidence: options.includeEvidence
      ? buildSupplierClassificationEvidence(input, filters, rows, {
          // Pedido sem fornecedor identificado não pertence a nenhuma linha do
          // relatório: só entra na evidência quando não há filtro de leitura.
          includeUnresolvedSuppliers: rows.length === allRows.length,
        })
      : null,
  };
}

/**
 * Evidência por pedido elegível da MESMA população do relatório.
 *
 * Respeita a busca/filtros de leitura: só entram pedidos dos fornecedores
 * presentes em `rows` (mais os pedidos sem fornecedor identificado, que a
 * auditoria precisa ver quando nenhum filtro de leitura está aplicado).
 */
export function buildSupplierClassificationEvidence(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  rows: readonly SupplierClassificationReportRow[],
  options: { includeUnresolvedSuppliers?: boolean } = {}
): SupplierClassificationEvidenceRow[] {
  const population = buildSupplierPerformanceDashboardPopulation(input, filters);
  const rowById = new Map(rows.map((row) => [row.supplierExternalId, row] as const));

  const evidence: SupplierClassificationEvidenceRow[] = [];
  for (const order of population.orders) {
    if (order.supplierKey == null) {
      if (!options.includeUnresolvedSuppliers) continue;
    } else if (!rowById.has(order.supplierKey)) {
      continue;
    }
    const identity = order.supplierKey == null ? null : rowById.get(order.supplierKey) ?? null;
    const evaluation = order.evaluation;
    const methodology = evaluation ? getSupplierEvaluationMethodology(evaluation.methodologyVersion) : null;
    evidence.push({
      supplierExternalId: order.supplierKey,
      supplierName: identity?.name ?? order.supplierName ?? "Fornecedor não identificado no pedido",
      supplierDocument: identity?.document ?? order.supplierTaxId ?? null,
      purchaseOrderId: order.id,
      purchaseOrderExternalId: order.externalId,
      purchaseOrderCode: order.orderNumber,
      performanceDate: order.performanceDate.toISOString(),
      stage: order.stage,
      canceled: order.canceled,
      currency: order.currency,
      amount: order.hasSpendValue ? order.spend : null,
      qualityScore: evaluation?.qualityScore ?? null,
      deliveryScore: evaluation?.deliveryScore ?? null,
      conformityScore: evaluation?.conformityScore ?? null,
      serviceScore: evaluation?.serviceScore ?? null,
      overallScore: evaluation?.overallScore ?? null,
      methodologyVersion: evaluation?.methodologyVersion ?? null,
      methodologyId: methodology?.id ?? null,
      scaleMax: methodology?.scaleMax ?? null,
      revision: evaluation?.revision ?? null,
      evaluatedBy: evaluation?.createdByUserName ?? null,
      evaluatedAt: evaluation ? evaluation.createdAt.toISOString() : null,
      updatedBy: evaluation?.updatedByUserName ?? null,
      updatedAt: evaluation ? evaluation.updatedAt.toISOString() : null,
      notes: evaluation?.notes ?? null,
    });
  }

  evidence.sort(
    (a, b) =>
      comparePtBr(a.supplierName, b.supplierName) ||
      a.performanceDate.localeCompare(b.performanceDate) ||
      a.purchaseOrderExternalId - b.purchaseOrderExternalId
  );
  return evidence;
}

/** Nome de arquivo estável e seguro para Content-Disposition. */
export function buildSupplierClassificationExportFilename(
  extension: "xlsx" | "pdf",
  period: SupplierPerformancePeriod
): string {
  const from = period.from ?? "inicio";
  const to = period.to ?? "hoje";
  return `classificacao-fornecedores-${from}-${to}.${extension}`.replace(/[^\w.-]+/g, "_");
}
