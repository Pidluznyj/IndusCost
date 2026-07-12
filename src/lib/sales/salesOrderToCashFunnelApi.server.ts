/**
 * Loaders Prisma read-only — Funil Pedido → Caixa.
 * Reutiliza fatos da Conciliação de Carteira + classificação/analytics puros.
 * Sem write / migration. Não importa comissões.
 */

import { prisma } from "@/src/lib/prisma.js";
import type { PortfolioReconciliationFactApiRow } from "../finance/portfolioReconciliationApi.js";
import {
  findLatestSuccessfulPortfolioReconciliationRunId,
  loadPortfolioReconciliationFactsForRun,
  resolvePortfolioReconciliationRun,
} from "../financePortfolioReconciliationApi.server.js";
import {
  buildOrderFulfillmentMap,
  type PortfolioOrderFulfillmentMap,
} from "../finance/portfolioOrderFulfillmentMap.js";
import {
  sanitizeFulfillmentMapForApi,
} from "../finance/portfolioMaturityIntelligenceApi.js";
import {
  buildPortfolioOrderTimeline,
  buildPortfolioReceivableTitleRows,
} from "../finance/portfolioReconciliationOrderTrace.js";
import { classifySalesOrderToCashFunnelRow } from "./salesOrderToCashFunnelClassification.js";
import {
  buildOrderToCashFunnelDetailPayload,
  buildOrderToCashFunnelListPayload,
  ORDER_TO_CASH_FULFILLMENT_MAP_UNAVAILABLE_WARNING,
  ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE,
  parseOrderToCashFunnelFilters,
  type OrderToCashFunnelDataFreshness,
  type OrderToCashFunnelDateAxis,
  type OrderToCashFunnelEnrichedRow,
  type OrderToCashFunnelFilters,
} from "./salesOrderToCashFunnelApi.js";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function maxIso(dates: Array<string | null | undefined>): string | null {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  return sorted.length ? sorted[sorted.length - 1]! : null;
}

function groupFactsByOrder(
  facts: readonly PortfolioReconciliationFactApiRow[]
): Map<string, PortfolioReconciliationFactApiRow[]> {
  const map = new Map<string, PortfolioReconciliationFactApiRow[]>();
  for (const fact of facts) {
    const id = fact.salesOrderId;
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(fact);
    map.set(id, list);
  }
  return map;
}

type OrderMeta = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: number | null;
  customerId: string;
  customerName: string | null;
  sellerName: string | null;
  sellerExternalId: number | null;
  companyIssuer: string | null;
  companyId: string | null;
  updatedAt: Date;
};

async function loadOrderMetas(orderIds: string[]): Promise<Map<string, OrderMeta>> {
  const result = new Map<string, OrderMeta>();
  if (orderIds.length === 0) return result;
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      customerId: true,
      nomusSellerName: true,
      externalSellerId: true,
      companyIssuer: true,
      externalCompanyId: true,
      updatedAt: true,
      Customer: { select: { companyName: true, tradeName: true } },
    },
  });
  for (const o of orders) {
    const customerName =
      o.Customer?.companyName?.trim() ||
      o.Customer?.tradeName?.trim() ||
      null;
    result.set(o.id, {
      id: o.id,
      orderCode: o.orderCode,
      status: String(o.status),
      issueDate: o.issueDate,
      expectedDeliveryDate: o.expectedDeliveryDate,
      totalNetValue: decimalToNumber(o.totalNetValue),
      customerId: o.customerId,
      customerName,
      sellerName: o.nomusSellerName,
      sellerExternalId: o.externalSellerId,
      companyIssuer: o.companyIssuer,
      companyId:
        o.externalCompanyId != null ? String(o.externalCompanyId) : null,
      updatedAt: o.updatedAt,
    });
  }
  return result;
}

function buildAxisDates(
  facts: readonly PortfolioReconciliationFactApiRow[],
  meta: OrderMeta | null,
  forecastDate: string | null
): Partial<Record<OrderToCashFunnelDateAxis, string | null>> {
  const nfeDates = facts.map((f) => toIsoDate(f.nfeProcessedAt));
  const stockDates = facts.map((f) => toIsoDate(f.stockDocumentDate));
  const dueDates = facts.flatMap((f) => {
    const raw = f.dueDatesJson;
    if (!Array.isArray(raw)) return [];
    return raw.map((d) => toIsoDate(String(d)));
  });
  const settlementDates = facts.flatMap((f) => {
    const raw = f.settlementDatesJson;
    if (!Array.isArray(raw)) return [];
    return raw.map((d) => toIsoDate(String(d)));
  });

  return {
    ORDER_ISSUE_DATE: toIsoDate(meta?.issueDate ?? facts[0]?.orderIssueDate),
    EXPECTED_DELIVERY_DATE: toIsoDate(
      meta?.expectedDeliveryDate ?? facts[0]?.expectedDeliveryDate
    ),
    STOCK_DOCUMENT_DATE: maxIso(stockDates),
    NFE_DATE: maxIso(nfeDates),
    RECEIVABLE_DUE_DATE: maxIso(dueDates),
    RECEIVABLE_SETTLEMENT_DATE: maxIso(settlementDates),
    FORECAST_DATE: forecastDate,
    UPDATED_AT: toIsoDate(meta?.updatedAt),
  };
}

function classifyOrderFromFacts(args: {
  salesOrderId: string;
  facts: readonly PortfolioReconciliationFactApiRow[];
  meta: OrderMeta | null;
  today?: Date;
}): {
  enriched: OrderToCashFunnelEnrichedRow;
  fulfillmentMap: PortfolioOrderFulfillmentMap | null;
  fulfillmentMapWarning: string | null;
} {
  const { salesOrderId, facts, meta } = args;
  const first = facts[0]!;
  const orderValue =
    meta?.totalNetValue ??
    (typeof first.traceJson === "object" &&
    first.traceJson &&
    "orderTotal" in first.traceJson
      ? Number((first.traceJson as { orderTotal?: number }).orderTotal)
      : null) ??
    0;

  let fulfillmentMap: PortfolioOrderFulfillmentMap | null = null;
  let fulfillmentMapWarning: string | null = null;
  try {
    fulfillmentMap = buildOrderFulfillmentMap({
      reconciliationFacts: facts,
      orderValue,
      paymentTermsAvailable: true,
      order: {
        id: salesOrderId,
        orderCode: meta?.orderCode ?? first.orderCode,
        totalNetValue: orderValue,
        issueDate: meta?.issueDate ?? first.orderIssueDate,
        customerNameSnapshot: meta?.customerName ?? first.customerNameSnapshot,
      },
    });
  } catch {
    fulfillmentMap = null;
    fulfillmentMapWarning = ORDER_TO_CASH_FULFILLMENT_MAP_UNAVAILABLE_WARNING;
  }

  const forecastFact = facts.find((f) => f.forecastDate != null) ?? first;
  const forecastDate = toIsoDate(forecastFact.forecastDate);
  const forecastValue =
    forecastFact.forecastValue != null ? Number(forecastFact.forecastValue) : orderValue;

  const classified = classifySalesOrderToCashFunnelRow({
    today: args.today ?? new Date(),
    order: {
      id: salesOrderId,
      orderCode: meta?.orderCode ?? first.orderCode,
      totalNetValue: orderValue,
      issueDate: meta?.issueDate ?? first.orderIssueDate,
      expectedDeliveryDate:
        meta?.expectedDeliveryDate ?? first.expectedDeliveryDate,
      status: meta?.status ?? null,
      canceled: String(meta?.status ?? "").toUpperCase() === "CANCELLED",
      customerId: meta?.customerId ?? first.customerId,
      customerName: meta?.customerName ?? first.customerNameSnapshot,
      sellerId:
        meta?.sellerExternalId != null ? String(meta.sellerExternalId) : null,
      sellerName: meta?.sellerName ?? null,
    },
    fulfillmentMap: fulfillmentMap
      ? {
          operationalStatus: fulfillmentMap.operationalStatus,
          financialStatus: fulfillmentMap.financialStatus,
          fulfillmentSummary: fulfillmentMap.fulfillmentSummary,
          technicalAlerts: fulfillmentMap.technicalAlerts,
        }
      : {
          financialStatus:
            Number(first.openReceivableValue) > 0
              ? "FIN_CR_ABERTO"
              : Number(first.receivedValue) > 0
                ? "FIN_RECEBIDO"
                : first.nfeExternalId != null || first.stockDocumentExternalId != null
                  ? "FIN_FATURADO_SEM_CR"
                  : "FIN_SEM_CR",
          fulfillmentSummary: {
            orderValue,
            receivedValue: Number(first.receivedValue) || 0,
            openReceivableValue: Number(first.openReceivableValue) || 0,
            receivableTotalValue: Number(first.receivableTotalValue) || 0,
          },
        },
    nfes: [
      ...new Map(
        facts
          .filter((f) => f.nfeExternalId != null)
          .map((f) => [
            f.nfeExternalId!,
            {
              externalId: f.nfeExternalId!,
              numero: f.nfeNumber,
              valorLiquido: f.nfeHeaderValue,
            },
          ])
      ).values(),
    ],
    stockDocuments: [
      ...new Map(
        facts
          .filter((f) => f.stockDocumentExternalId != null)
          .map((f) => [
            f.stockDocumentExternalId!,
            {
              externalId: f.stockDocumentExternalId!,
              idNfe: f.nfeExternalId,
              dataDocumento: f.stockDocumentDate,
            },
          ])
      ).values(),
    ],
    receivables: buildPortfolioReceivableTitleRows([...facts]).titles.map((r) => ({
      receivableId: r.receivableId,
      dueDate: r.dueDate,
      settlementDate: r.settlementDate,
      totalValue: r.amount,
      receivedValue: r.received,
      openValue: r.open,
    })),
  });

  const axisDates = buildAxisDates(facts, meta, forecastDate);
  const lastEvidenceDate = maxIso([
    axisDates.RECEIVABLE_SETTLEMENT_DATE,
    axisDates.NFE_DATE,
    axisDates.STOCK_DOCUMENT_DATE,
    axisDates.RECEIVABLE_DUE_DATE,
    axisDates.ORDER_ISSUE_DATE,
  ]);

  const productSkus = [
    ...new Set(
      facts
        .map((f) => f.productSkuSnapshot)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ];
  const productNames = [
    ...new Set(
      facts
        .map((f) => f.productNameSnapshot)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ];

  const enriched: OrderToCashFunnelEnrichedRow = {
    ...classified,
    issueDate: axisDates.ORDER_ISSUE_DATE ?? null,
    expectedDeliveryDate: axisDates.EXPECTED_DELIVERY_DATE ?? null,
    financialStatus: fulfillmentMap?.financialStatus ?? null,
    operationalStatus: fulfillmentMap?.operationalStatus ?? null,
    fulfillmentPercent: fulfillmentMap?.fulfillmentSummary.fulfillmentPercent ?? null,
    forecastDate,
    forecastValue: forecastValue != null && Number.isFinite(forecastValue) ? forecastValue : null,
    lastEvidenceDate,
    companyId: meta?.companyId ?? null,
    companyName: meta?.companyIssuer ?? null,
    productSkus,
    productNames,
    axisDates,
    updatedAt: toIsoDate(meta?.updatedAt),
  };

  return { enriched, fulfillmentMap, fulfillmentMapWarning };
}

function buildFreshness(args: {
  runId: string | null;
  runFinishedAt: string | null;
  latestRunId: string | null;
  lastEvidenceDate: string | null;
  warnings?: string[];
  sourceLabel?: string;
}): OrderToCashFunnelDataFreshness {
  return {
    sourceLabel:
      args.sourceLabel ??
      "Conciliação de Carteira (fatos materializados) + classificação Funil Pedido → Caixa. Não usa proposta nem comissão.",
    runId: args.runId,
    runFinishedAt: args.runFinishedAt,
    isLatestRun:
      args.runId != null && args.latestRunId != null
        ? args.runId === args.latestRunId
        : null,
    lastEvidenceDate: args.lastEvidenceDate,
    warnings: args.warnings ?? [],
    laymanNotice:
      "Valores de CR/baixa refletem a última sincronização e rebuild da conciliação — não o Contas a Receber ao vivo.",
  };
}

async function classifyAllFromRun(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  today?: Date;
}): Promise<{
  enrichedRows: OrderToCashFunnelEnrichedRow[];
  byOrderId: Map<
    string,
    {
      enriched: OrderToCashFunnelEnrichedRow;
      facts: PortfolioReconciliationFactApiRow[];
      fulfillmentMap: PortfolioOrderFulfillmentMap | null;
      fulfillmentMapWarning: string | null;
      meta: OrderMeta | null;
    }
  >;
}> {
  const grouped = groupFactsByOrder(args.facts);
  const orderIds = [...grouped.keys()];
  const metas = await loadOrderMetas(orderIds);
  const enrichedRows: OrderToCashFunnelEnrichedRow[] = [];
  const byOrderId = new Map<
    string,
    {
      enriched: OrderToCashFunnelEnrichedRow;
      facts: PortfolioReconciliationFactApiRow[];
      fulfillmentMap: PortfolioOrderFulfillmentMap | null;
      fulfillmentMapWarning: string | null;
      meta: OrderMeta | null;
    }
  >();

  for (const [salesOrderId, orderFacts] of grouped) {
    const meta = metas.get(salesOrderId) ?? null;
    const classified = classifyOrderFromFacts({
      salesOrderId,
      facts: orderFacts,
      meta,
      today: args.today,
    });
    enrichedRows.push(classified.enriched);
    byOrderId.set(salesOrderId, {
      enriched: classified.enriched,
      facts: orderFacts,
      fulfillmentMap: classified.fulfillmentMap,
      fulfillmentMapWarning: classified.fulfillmentMapWarning,
      meta,
    });
  }

  return { enrichedRows, byOrderId };
}

/**
 * Lista read-only do Funil Pedido → Caixa.
 */
export async function loadOrderToCashFunnelList(query: Record<string, unknown>) {
  const filters = parseOrderToCashFunnelFilters(query);
  const run = await resolvePortfolioReconciliationRun({
    runId: filters.runId,
    customerExternalId: null,
    year: null,
    month: null,
    orderCode: null,
    status: null,
    confidenceLevel: null,
    forecastSource: null,
    onlyIssues: false,
    page: 1,
    pageSize: 1,
  });

  if (!run) {
    const emptyFreshness = buildFreshness({
      runId: null,
      runFinishedAt: null,
      latestRunId: null,
      lastEvidenceDate: null,
      warnings: [ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE],
    });
    return {
      ...buildOrderToCashFunnelListPayload({
        filters,
        enrichedRows: [],
        dataFreshness: emptyFreshness,
        warnings: [ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE],
      }),
      ok: true as const,
      message: ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE,
    };
  }

  const latestRunId = await findLatestSuccessfulPortfolioReconciliationRunId();
  const facts = await loadPortfolioReconciliationFactsForRun(run.id, {
    customerId: filters.customerId,
  });
  const { enrichedRows } = await classifyAllFromRun({ facts });
  const lastEvidenceDate = maxIso(enrichedRows.map((r) => r.lastEvidenceDate));

  const freshness = buildFreshness({
    runId: run.id,
    runFinishedAt: toIsoDate(run.finishedAt) ?? toIsoDate(run.createdAt),
    latestRunId,
    lastEvidenceDate,
  });

  return buildOrderToCashFunnelListPayload({
    filters,
    enrichedRows,
    dataFreshness: freshness,
  });
}

/**
 * Detalhe read-only de um pedido no Funil Pedido → Caixa.
 */
export async function loadOrderToCashFunnelOrderDetail(
  salesOrderId: string,
  query: Record<string, unknown> = {}
) {
  const filters: OrderToCashFunnelFilters = {
    ...parseOrderToCashFunnelFilters(query),
    salesOrderId,
  };

  const run = await resolvePortfolioReconciliationRun({
    runId: filters.runId,
    customerExternalId: null,
    year: null,
    month: null,
    orderCode: null,
    status: null,
    confidenceLevel: null,
    forecastSource: null,
    onlyIssues: false,
    page: 1,
    pageSize: 1,
  });

  if (!run) {
    return buildOrderToCashFunnelDetailPayload({
      salesOrderId,
      enrichedRow: null,
      fulfillmentMap: null,
      timeline: [],
      documents: [],
      nfes: [],
      receivables: [],
      freshness: buildFreshness({
        runId: null,
        runFinishedAt: null,
        latestRunId: null,
        lastEvidenceDate: null,
        warnings: [ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE],
      }),
      executiveConclusion: null,
      warnings: [ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE],
    });
  }

  const latestRunId = await findLatestSuccessfulPortfolioReconciliationRunId();
  const facts = await loadPortfolioReconciliationFactsForRun(run.id);
  const orderFacts = facts.filter((f) => f.salesOrderId === salesOrderId);
  if (orderFacts.length === 0) {
    return buildOrderToCashFunnelDetailPayload({
      salesOrderId,
      enrichedRow: null,
      fulfillmentMap: null,
      timeline: [],
      documents: [],
      nfes: [],
      receivables: [],
      freshness: buildFreshness({
        runId: run.id,
        runFinishedAt: toIsoDate(run.finishedAt) ?? toIsoDate(run.createdAt),
        latestRunId,
        lastEvidenceDate: null,
      }),
      executiveConclusion: null,
      warnings: ["Pedido não encontrado na conciliação materializada deste run."],
    });
  }

  const metas = await loadOrderMetas([salesOrderId]);
  const meta = metas.get(salesOrderId) ?? null;
  const classified = classifyOrderFromFacts({
    salesOrderId,
    facts: orderFacts,
    meta,
  });

  let fulfillmentDto: Record<string, unknown> | null = null;
  const warnings: string[] = [];
  if (classified.fulfillmentMap) {
    try {
      fulfillmentDto = sanitizeFulfillmentMapForApi(classified.fulfillmentMap) as unknown as Record<
        string,
        unknown
      >;
    } catch {
      fulfillmentDto = null;
      warnings.push(ORDER_TO_CASH_FULFILLMENT_MAP_UNAVAILABLE_WARNING);
    }
  } else if (classified.fulfillmentMapWarning) {
    warnings.push(classified.fulfillmentMapWarning);
  }

  const timeline = buildPortfolioOrderTimeline(orderFacts).map((ev) => ({
    at: toIsoDate(ev.at) ?? null,
    kind: String(ev.kind ?? "EVENT"),
    label: String(ev.label ?? "Evento"),
    detail: null as string | null,
  }));

  const documents = [
    ...new Map(
      orderFacts
        .filter((f) => f.stockDocumentExternalId != null || f.nfeExternalId != null)
        .map((f) => [
          `${f.stockDocumentExternalId ?? "n"}:${f.nfeExternalId ?? "n"}`,
          {
            stockDocumentExternalId: f.stockDocumentExternalId,
            nfeExternalId: f.nfeExternalId,
            nfeNumber: f.nfeNumber,
            date: toIsoDate(f.stockDocumentDate ?? f.nfeProcessedAt),
          },
        ])
    ).values(),
  ];

  const nfes = [
    ...new Map(
      orderFacts
        .filter((f) => f.nfeExternalId != null)
        .map((f) => [
          f.nfeExternalId!,
          {
            nfeExternalId: f.nfeExternalId,
            nfeNumber: f.nfeNumber,
            processedAt: toIsoDate(f.nfeProcessedAt),
            headerValue: f.nfeHeaderValue != null ? Number(f.nfeHeaderValue) : null,
          },
        ])
    ).values(),
  ];

  const receivables = buildPortfolioReceivableTitleRows([...orderFacts]).titles.map((r) => ({
    receivableId: r.receivableId,
    dueDate: r.dueDate,
    settlementDate: r.settlementDate,
    totalValue: r.amount,
    receivedValue: r.received,
    openValue: r.open,
  }));

  const freshness = buildFreshness({
    runId: run.id,
    runFinishedAt: toIsoDate(run.finishedAt) ?? toIsoDate(run.createdAt),
    latestRunId,
    lastEvidenceDate: classified.enriched.lastEvidenceDate,
    warnings,
  });

  return buildOrderToCashFunnelDetailPayload({
    salesOrderId,
    enrichedRow: classified.enriched,
    fulfillmentMap: fulfillmentDto,
    timeline,
    documents,
    nfes,
    receivables,
    freshness,
    executiveConclusion:
      classified.fulfillmentMap?.executiveConclusion ??
      classified.enriched.explanation,
    orderStatus: meta?.status ?? null,
    warnings,
  });
}
