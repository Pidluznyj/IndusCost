/**
 * API pura da Central de Inteligência da Carteira (read-only).
 * Parse de filtros + montagem de payloads — sem Prisma.
 *
 * @see docs/finance/portfolio-intelligence-requirements.md
 */

import {
  buildOrderTimeline,
  PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE,
  type PortfolioReconciliationFactApiRow,
  type PortfolioReconciliationRunMeta,
} from "./portfolioReconciliationApi.js";
import {
  buildPortfolioDocumentLinkRows,
  buildPortfolioOrderItemRows,
  buildPortfolioOrderTimeline,
  buildPortfolioReceivableTitleRows,
} from "./portfolioReconciliationOrderTrace.js";
import {
  buildMaturityOrderFromFacts,
  buildPortfolioMaturityAnalytics,
  type PortfolioMaturityAnalyticsFilters,
  type PortfolioMaturityDateAxis,
  type PortfolioMaturitySortBy,
  type PortfolioOrderEnrichment,
} from "./portfolioMaturityAnalytics.js";
import {
  PORTFOLIO_INFO_UNAVAILABLE,
  type PortfolioConfidenceLabel,
  type PortfolioMaturityAlertTag,
  type PortfolioMaturityStatus,
} from "./portfolioMaturityClassification.js";
import { buildOrderFulfillmentMap } from "./portfolioOrderFulfillmentMap.js";
import type {
  BuildOrderFulfillmentMapInput,
  PortfolioOrderFulfillmentMap,
} from "./portfolioOrderFulfillmentMap.js";

export const PORTFOLIO_INTELLIGENCE_DEFAULT_PAGE_SIZE = 50;
export const PORTFOLIO_INTELLIGENCE_MAX_PAGE_SIZE = 200;

/** Aviso amigável quando o mapa de atendimento não puder ser montado. */
export const PORTFOLIO_FULFILLMENT_MAP_UNAVAILABLE_WARNING =
  "Não foi possível montar o mapa de atendimento deste pedido com as evidências atuais. Os demais dados do detalhe continuam disponíveis.";

export class PortfolioIntelligenceApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioIntelligenceApiParseError";
  }
}

const DATE_AXES = new Set<PortfolioMaturityDateAxis>([
  "ORDER_ISSUE_DATE",
  "EXPECTED_DELIVERY_DATE",
  "NFE_DATE",
  "STOCK_DOCUMENT_DATE",
  "RECEIVABLE_DUE_DATE",
  "RECEIVABLE_SETTLEMENT_DATE",
  "FORECAST_DATE",
  "UPDATED_AT",
]);

const STATUSES = new Set<PortfolioMaturityStatus>([
  "RECEBIDO",
  "CR_ABERTO",
  "FATURADO_SEM_CR",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "SEM_EVIDENCIA",
]);

const CONFIDENCE_LABELS = new Set<PortfolioConfidenceLabel>([
  "ALTA",
  "MEDIA",
  "BAIXA",
  "MUITO_BAIXA",
]);

const ALERT_TAGS = new Set<PortfolioMaturityAlertTag>([
  "DIVERGENCIA_TECNICA",
  "NF_SEM_DOCUMENTO",
  "DOCUMENTO_SEM_CR",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "DIVERGENCIA_PRECO",
  "SEM_CONDICAO_PAGAMENTO",
  "VINCULO_INCOMPLETO",
  "PEDIDO_ANTIGO_SEM_EVOLUCAO",
]);

const SORT_BY = new Set<PortfolioMaturitySortBy>([
  "orderCode",
  "orderValue",
  "confidenceScore",
  "statusPrincipal",
  "issueDate",
  "forecastDate",
  "customerName",
  "sellerName",
]);

function asQueryString(value: unknown): string | null {
  if (value == null) return null;
  const s = Array.isArray(value) ? String(value[0] ?? "") : String(value);
  const trimmed = s.trim();
  return trimmed.length ? trimmed : null;
}

function asPositiveInt(value: unknown, field: string): number | null {
  const raw = asQueryString(value);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PortfolioIntelligenceApiParseError(`${field} inválido.`);
  }
  return n;
}

function asNonNegativeNumber(value: unknown, field: string): number | null {
  const raw = asQueryString(value);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new PortfolioIntelligenceApiParseError(`${field} inválido.`);
  }
  return n;
}

function asPageInt(value: unknown, field: string, fallback: number): number {
  const raw = asQueryString(value);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new PortfolioIntelligenceApiParseError(`${field} inválido.`);
  }
  return n;
}

function asBoolFlag(value: unknown): boolean {
  const raw = asQueryString(value);
  if (raw == null) return false;
  const u = raw.toLowerCase();
  return u === "1" || u === "true" || u === "yes" || u === "on";
}

function asIsoDate(value: unknown, field: string): string | null {
  const raw = asQueryString(value);
  if (raw == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new PortfolioIntelligenceApiParseError(
      `${field} inválido. Use o formato AAAA-MM-DD.`
    );
  }
  return raw;
}

function parseTagsAlerta(value: unknown): PortfolioMaturityAlertTag[] | null {
  if (value == null || value === "") return null;
  const parts = Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  if (parts.length === 0) return null;
  const tags: PortfolioMaturityAlertTag[] = [];
  for (const p of parts) {
    const u = p.toUpperCase() as PortfolioMaturityAlertTag;
    if (!ALERT_TAGS.has(u)) {
      throw new PortfolioIntelligenceApiParseError(
        `tagsAlerta inválida: ${p}. Valores aceitos: ${[...ALERT_TAGS].join(", ")}.`
      );
    }
    tags.push(u);
  }
  return tags;
}

/**
 * Parse seguro dos query params da inteligência.
 */
export function parsePortfolioIntelligenceFilters(
  query: Record<string, unknown>
): PortfolioMaturityAnalyticsFilters {
  const page = asPageInt(query.page, "page", 1);
  let pageSize = asPageInt(
    query.pageSize,
    "pageSize",
    PORTFOLIO_INTELLIGENCE_DEFAULT_PAGE_SIZE
  );
  if (pageSize > PORTFOLIO_INTELLIGENCE_MAX_PAGE_SIZE) {
    pageSize = PORTFOLIO_INTELLIGENCE_MAX_PAGE_SIZE;
  }

  const dateAxisRaw = asQueryString(query.dateAxis);
  let dateAxis: PortfolioMaturityDateAxis | null = null;
  if (dateAxisRaw) {
    const u = dateAxisRaw.toUpperCase() as PortfolioMaturityDateAxis;
    if (!DATE_AXES.has(u)) {
      throw new PortfolioIntelligenceApiParseError(
        `dateAxis inválido. Use um de: ${[...DATE_AXES].join(", ")}.`
      );
    }
    dateAxis = u;
  }

  const statusRaw = asQueryString(query.statusPrincipal);
  let statusPrincipal: PortfolioMaturityStatus | null = null;
  if (statusRaw) {
    const u = statusRaw.toUpperCase() as PortfolioMaturityStatus;
    if (!STATUSES.has(u)) {
      throw new PortfolioIntelligenceApiParseError(
        `statusPrincipal inválido. Use um de: ${[...STATUSES].join(", ")}.`
      );
    }
    statusPrincipal = u;
  }

  const confRaw = asQueryString(query.confidenceLabel);
  let confidenceLabel: PortfolioConfidenceLabel | null = null;
  if (confRaw) {
    const u = confRaw.toUpperCase() as PortfolioConfidenceLabel;
    if (!CONFIDENCE_LABELS.has(u)) {
      throw new PortfolioIntelligenceApiParseError(
        `confidenceLabel inválido. Use um de: ${[...CONFIDENCE_LABELS].join(", ")}.`
      );
    }
    confidenceLabel = u;
  }

  const sortByRaw = asQueryString(query.sortBy);
  let sortBy: PortfolioMaturitySortBy | null = null;
  if (sortByRaw) {
    if (!SORT_BY.has(sortByRaw as PortfolioMaturitySortBy)) {
      throw new PortfolioIntelligenceApiParseError(
        `sortBy inválido. Use um de: ${[...SORT_BY].join(", ")}.`
      );
    }
    sortBy = sortByRaw as PortfolioMaturitySortBy;
  }

  const sortDirRaw = asQueryString(query.sortDirection)?.toLowerCase() ?? null;
  let sortDirection: "asc" | "desc" | null = null;
  if (sortDirRaw) {
    if (sortDirRaw !== "asc" && sortDirRaw !== "desc") {
      throw new PortfolioIntelligenceApiParseError(
        "sortDirection inválido. Use asc ou desc."
      );
    }
    sortDirection = sortDirRaw;
  }

  const from = asIsoDate(query.from, "from");
  const to = asIsoDate(query.to, "to");
  if ((from || to) && !dateAxis) {
    throw new PortfolioIntelligenceApiParseError(
      "Informe dateAxis ao filtrar por from/to."
    );
  }

  return {
    runId: asQueryString(query.runId),
    customerExternalId: asPositiveInt(query.customerExternalId, "customerExternalId"),
    customerId: asQueryString(query.customerId),
    sellerExternalId: asPositiveInt(query.sellerExternalId, "sellerExternalId"),
    sellerId: asQueryString(query.sellerId),
    sellerName: asQueryString(query.sellerName),
    companyId: asQueryString(query.companyId),
    orderCode: asQueryString(query.orderCode),
    productExternalId: asPositiveInt(query.productExternalId, "productExternalId"),
    statusPrincipal,
    confidenceLabel,
    tagsAlerta: parseTagsAlerta(query.tagsAlerta),
    minValue: asNonNegativeNumber(query.minValue, "minValue"),
    maxValue: asNonNegativeNumber(query.maxValue, "maxValue"),
    dateAxis,
    from,
    to,
    page,
    pageSize,
    asOfDate: asIsoDate(query.asOfDate, "asOfDate"),
    sortBy,
    sortDirection,
    onlyWithoutNfe: asBoolFlag(query.onlyWithoutNfe) || null,
    onlyWithoutStockDocument: asBoolFlag(query.onlyWithoutStockDocument) || null,
    onlyWithoutReceivable: asBoolFlag(query.onlyWithoutReceivable) || null,
    onlyWithoutSeller: asBoolFlag(query.onlyWithoutSeller) || null,
  };
}

export function buildPortfolioIntelligenceListPayload(args: {
  run: PortfolioReconciliationRunMeta | null;
  facts: readonly PortfolioReconciliationFactApiRow[];
  filters: PortfolioMaturityAnalyticsFilters;
  enrichmentsBySalesOrderId?: ReadonlyMap<string, PortfolioOrderEnrichment> | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
}) {
  if (!args.run) {
    return {
      ok: false as const,
      message: PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE,
      cards: [],
      groups: [],
      sellerKpis: [],
      rows: [],
      pagination: {
        page: 1,
        pageSize: PORTFOLIO_INTELLIGENCE_DEFAULT_PAGE_SIZE,
        totalRows: 0,
        totalPages: 0,
      },
      filters: args.filters,
      metricExplanations: {},
      warnings: [PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE],
      totals: null,
      run: null,
    };
  }

  const analytics = buildPortfolioMaturityAnalytics({
    facts: args.facts,
    filters: args.filters,
    enrichmentsBySalesOrderId: args.enrichmentsBySalesOrderId,
    orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
  });

  return {
    ok: true as const,
    message: null as string | null,
    cards: analytics.summaryCards,
    groups: analytics.statusGroups,
    sellerKpis: analytics.sellerKpis,
    rows: analytics.rows,
    pagination: analytics.pagination,
    filters: analytics.appliedFilters,
    metricExplanations: analytics.metricExplanations,
    warnings: analytics.warnings,
    totals: analytics.totals,
    run: {
      id: args.run.id,
      status: args.run.status,
      finishedAt: args.run.finishedAt,
      customerExternalId: args.run.customerExternalId,
    },
  };
}

export function buildPortfolioIntelligenceOrderDetailPayload(args: {
  salesOrderId: string;
  run: PortfolioReconciliationRunMeta | null;
  facts: readonly PortfolioReconciliationFactApiRow[];
  enrichment?: PortfolioOrderEnrichment | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
  asOfDate?: string | null;
  /** Override só para testes — força falha controlada do mapa. */
  buildFulfillmentMap?: (
    input: BuildOrderFulfillmentMapInput
  ) => PortfolioOrderFulfillmentMap;
}) {
  if (!args.run) {
    return {
      ok: false as const,
      message: PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE,
      detail: null,
    };
  }
  if (args.facts.length === 0) {
    return {
      ok: false as const,
      message: "Pedido não encontrado na conciliação materializada deste run.",
      detail: null,
      run: { id: args.run.id, status: args.run.status },
    };
  }

  const maturity = buildMaturityOrderFromFacts({
    facts: args.facts,
    enrichment: args.enrichment,
    orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
    asOfDate: args.asOfDate,
  });

  const paymentTerms = args.enrichment?.paymentTerms?.trim() || null;
  const paymentMethod = args.enrichment?.paymentMethod?.trim() || null;
  const paymentAvailable = Boolean(paymentTerms || paymentMethod);

  const detailWarnings: string[] = [];
  let fulfillmentMap: PortfolioOrderFulfillmentMap | null = null;
  try {
    const builder = args.buildFulfillmentMap ?? buildOrderFulfillmentMap;
    fulfillmentMap = builder({
      reconciliationFacts: args.facts,
      orderValue: maturity.orderValue,
      paymentTermsAvailable: paymentAvailable,
    });
    if (fulfillmentMap.evidenceWarnings?.length) {
      detailWarnings.push(...fulfillmentMap.evidenceWarnings);
    }
  } catch {
    // Read-only / explicativo: não derruba o detalhe nem vaza stack/Prisma.
    fulfillmentMap = null;
    detailWarnings.push(PORTFOLIO_FULFILLMENT_MAP_UNAVAILABLE_WARNING);
  }

  const items = buildPortfolioOrderItemRows(args.facts);
  const documents = buildPortfolioDocumentLinkRows(args.facts);
  const receivables = buildPortfolioReceivableTitleRows(args.facts);
  const timelineTrace = buildPortfolioOrderTimeline(args.facts);
  const timelineApi = buildOrderTimeline(args.facts);

  // Última atualização IndusCost
  const updatedAt = maturity.updatedAt;
  const timeline = [
    ...timelineTrace.map((e) => ({
      at: e.at,
      kind: e.kind,
      label: e.label,
    })),
    ...timelineApi
      .filter(
        (e) =>
          !timelineTrace.some((t) => t.at === e.at && t.kind === e.kind && t.label === e.label)
      )
      .map((e) => ({ at: e.at, kind: e.kind, label: e.label })),
  ];
  if (updatedAt && !timeline.some((t) => t.kind === "INDUSCOST_UPDATED")) {
    timeline.push({
      at: updatedAt,
      kind: "INDUSCOST_UPDATED",
      label: "Última atualização IndusCost",
    });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind));

  return {
    ok: true as const,
    message: null as string | null,
    detail: {
      executiveSummary: maturity.executiveSummary,
      order: {
        salesOrderId: maturity.salesOrderId,
        orderCode: maturity.orderCode,
        externalSalesOrderId: maturity.externalSalesOrderId,
        orderValue: maturity.orderValue,
        issueDate: maturity.issueDate,
        expectedDeliveryDate: maturity.expectedDeliveryDate,
        forecastDate: maturity.forecastDate,
        forecastSource: maturity.forecastSource,
      },
      customer: {
        customerId: maturity.customerId,
        customerExternalId: maturity.customerExternalId,
        customerName: maturity.customerName,
      },
      seller: {
        sellerId: maturity.sellerId,
        sellerExternalId: maturity.sellerExternalId,
        sellerName: maturity.sellerName,
        available: Boolean(maturity.sellerName || maturity.sellerExternalId != null),
        note:
          maturity.sellerName || maturity.sellerExternalId != null
            ? null
            : PORTFOLIO_INFO_UNAVAILABLE,
      },
      dates: {
        issueDate: maturity.issueDate,
        expectedDeliveryDate: maturity.expectedDeliveryDate,
        nfeDate: maturity.nfeDate,
        stockDocumentDate: maturity.stockDocumentDate,
        receivableDueDate: maturity.receivableDueDate,
        receivableSettlementDate: maturity.receivableSettlementDate,
        forecastDate: maturity.forecastDate,
        updatedAt: maturity.updatedAt,
        nextRelevantDate: maturity.nextRelevantDate,
      },
      paymentCondition: {
        available: paymentAvailable,
        paymentTerms,
        paymentMethod,
        note: paymentAvailable ? null : PORTFOLIO_INFO_UNAVAILABLE,
      },
      items,
      nfeDocuments: documents.filter((d) => d.nfeExternalId != null),
      stockDocuments: documents.filter((d) => d.stockDocumentExternalId != null),
      receivables: {
        summary: receivables.summary,
        titles: receivables.titles,
        receivableTotalValue: maturity.receivableTotalValue,
        receivedValue: maturity.receivedValue,
        openReceivableValue: maturity.openReceivableValue,
      },
      classification: {
        statusPrincipal: maturity.statusPrincipal,
        tagsAlerta: maturity.tagsAlerta,
        confidenceScore: maturity.confidenceScore,
        confidenceLabel: maturity.confidenceLabel,
        confidenceReasons: maturity.confidenceReasons,
        recommendedAction: maturity.recommendedAction,
        mainReason: maturity.mainReason,
        evidenceFlags: maturity.evidenceFlags,
        // Eixos do mapa — separados do statusPrincipal de maturidade
        financialStatus: fulfillmentMap?.financialStatus,
        operationalStatus: fulfillmentMap?.operationalStatus,
        technicalAlerts: fulfillmentMap?.technicalAlerts ?? [],
      },
      fulfillmentMap,
      warnings: detailWarnings,
      timeline,
      values: {
        orderValue: maturity.orderValue,
        nfeHeaderValue: maturity.nfeHeaderValue,
        stockDocumentValue: maturity.stockDocumentValue,
        itemizedAllocatedValue: maturity.itemizedAllocatedValue,
        receivableTotalValue: maturity.receivableTotalValue,
        receivedValue: maturity.receivedValue,
        openReceivableValue: maturity.openReceivableValue,
      },
    },
    run: {
      id: args.run.id,
      status: args.run.status,
      finishedAt: args.run.finishedAt,
    },
  };
}
