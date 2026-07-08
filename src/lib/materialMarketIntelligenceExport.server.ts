/**
 * Carrega dados e monta documento de exportação — Inteligência de Mercado.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildMonitoredMaterialListResponse,
  parseMonitoredMaterialCriticalityFilter,
} from "./materialMarketIntelligenceMonitored.js";
import {
  buildMaterialMarketAlertListResponse,
  parseMaterialMarketAlertStatusFilter,
} from "./materialMarketAlert.js";
import {
  buildMaterialMarketPriceHistoryResponse,
  collectUsdQuoteDatesForPtax,
  parseMaterialMarketPriceHistoryQuery,
} from "./materialMarketPriceHistory.js";
import {
  buildMaterialMarketSupplierComparison,
  parseMaterialMarketSupplierPeriod,
} from "./materialMarketSupplierComparison.js";
import { buildMaterialBomImpactForApi } from "./materialBomImpact.js";
import { loadMarketGlobalIndicators } from "./marketGlobalIndicators.server.js";
import { resolvePtaxRatesByDate } from "./materialMarketPtax.js";
import type { MaterialMarketSimulationResponse } from "./materialMarketSimulation.js";
import {
  buildAlertsExportRows,
  buildGlobalIndicatorsExportRows,
  buildHistoryExportRows,
  buildHomeExportRows,
  buildImpactedProductsExportRows,
  buildMaterialMarketIntelligenceExportDocument,
  buildReportsExportTables,
  buildSimulationsExportTables,
  buildSuppliersExportRows,
  parseMaterialMarketIntelligenceExportFormat,
  parseMaterialMarketIntelligenceExportScope,
  type MaterialMarketIntelligenceExportAppliedFilters,
  type MaterialMarketIntelligenceExportDocument,
  type MaterialMarketIntelligenceExportFormat,
  type MaterialMarketIntelligenceExportScope,
} from "./materialMarketIntelligenceExport.js";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function parseMaterialMarketIntelligenceExportFilters(
  query: Record<string, unknown>
): MaterialMarketIntelligenceExportAppliedFilters {
  const str = (key: string): string | null => {
    const v = query[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return {
    q: str("q"),
    criticality: str("criticality"),
    materialId: str("materialId"),
    supplier: str("supplier"),
    group: str("group"),
    period: str("period"),
    status: str("status"),
    dateFrom: str("dateFrom"),
    dateTo: str("dateTo"),
  };
}

export type MaterialMarketIntelligenceExportRequestParse =
  | {
      ok: true;
      scope: MaterialMarketIntelligenceExportScope;
      format: MaterialMarketIntelligenceExportFormat;
      filters: MaterialMarketIntelligenceExportAppliedFilters;
      simulationResult: MaterialMarketSimulationResponse | null;
    }
  | { ok: false; message: string };

export function parseMaterialMarketIntelligenceExportRequest(input: {
  query: Record<string, unknown>;
  body?: unknown;
}): MaterialMarketIntelligenceExportRequestParse {
  const scope = parseMaterialMarketIntelligenceExportScope(input.query.scope);
  if (!scope) {
    return {
      ok: false,
      message:
        "Escopo de exportação inválido. Use: home, history, suppliers, alerts, simulations, impacted-products, reports.",
    };
  }

  const format = parseMaterialMarketIntelligenceExportFormat(input.query.format ?? "xlsx");
  if (!format) {
    return { ok: false, message: "Formato inválido. Use: xlsx, csv ou pdf." };
  }

  const filters = parseMaterialMarketIntelligenceExportFilters(input.query);
  let simulationResult: MaterialMarketSimulationResponse | null = null;

  if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    const body = input.body as Record<string, unknown>;
    if (body.simulationResult && typeof body.simulationResult === "object") {
      simulationResult = body.simulationResult as MaterialMarketSimulationResponse;
    } else if (
      typeof body.currentPrice === "number" &&
      typeof body.simulatedPrice === "number" &&
      Array.isArray(body.productImpacts)
    ) {
      simulationResult = body as unknown as MaterialMarketSimulationResponse;
    }
  }

  return { ok: true, scope, format, filters, simulationResult };
}

async function loadMonitoredForExport(
  prisma: PrismaClient,
  filters: MaterialMarketIntelligenceExportAppliedFilters
) {
  const criticality = parseMonitoredMaterialCriticalityFilter(filters.criticality);
  const qTrim = (filters.q ?? "").trim();
  const group = (filters.group ?? "").trim();

  const materials = await prisma.material.findMany({
    where: {
      isMarketMonitored: true,
      ...(criticality ? { marketCriticality: criticality } : {}),
      ...(group ? { category: group } : {}),
      ...(qTrim
        ? {
            OR: [
              { code: { contains: qTrim, mode: "insensitive" } },
              { description: { contains: qTrim, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      MaterialPriceHistory: { orderBy: { effectiveDate: "desc" }, take: 1 },
      MaterialMarketQuote: {
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
      },
    },
    orderBy: [{ marketCriticality: "desc" }, { code: "asc" }],
  });

  return buildMonitoredMaterialListResponse(materials, {
    q: filters.q,
    criticality: criticality ?? undefined,
  }).items;
}

async function loadAlertsForExport(
  prisma: PrismaClient,
  filters: MaterialMarketIntelligenceExportAppliedFilters
) {
  const statusFilter = parseMaterialMarketAlertStatusFilter(filters.status ?? "OPEN");
  const materialId = filters.materialId?.trim();

  const alerts = await prisma.materialMarketAlert.findMany({
    where: {
      Material: { isMarketMonitored: true },
      ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
      ...(materialId && isUuid(materialId) ? { materialId } : {}),
    },
    include: {
      Material: { select: { code: true, description: true } },
    },
    orderBy: [{ triggeredAt: "desc" }],
    take: 500,
  });

  return buildMaterialMarketAlertListResponse(alerts).items;
}

export async function buildMaterialMarketIntelligenceExportDocumentForRequest(
  prisma: PrismaClient,
  input: {
    scope: MaterialMarketIntelligenceExportScope;
    filters: MaterialMarketIntelligenceExportAppliedFilters;
    simulationResult?: MaterialMarketSimulationResponse | null;
  }
): Promise<
  | { ok: true; document: MaterialMarketIntelligenceExportDocument }
  | { ok: false; status: number; message: string }
> {
  const { scope, filters } = input;
  const materialId = filters.materialId?.trim() ?? "";

  if (
    (scope === "history" ||
      scope === "suppliers" ||
      scope === "impacted-products" ||
      scope === "simulations") &&
    !isUuid(materialId)
  ) {
    return {
      ok: false,
      status: 400,
      message: "materialId UUID é obrigatório para este escopo de exportação.",
    };
  }

  if (scope === "home") {
    const [items, indicators] = await Promise.all([
      loadMonitoredForExport(prisma, filters),
      loadMarketGlobalIndicators(),
    ]);
    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters,
        tables: [buildGlobalIndicatorsExportRows(indicators), buildHomeExportRows(items, filters)],
      }),
    };
  }

  if (scope === "alerts") {
    const items = await loadAlertsForExport(prisma, filters);
    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters,
        tables: [buildAlertsExportRows(items, filters)],
      }),
    };
  }

  if (scope === "reports") {
    const [monitored, alerts, indicators] = await Promise.all([
      loadMonitoredForExport(prisma, filters),
      loadAlertsForExport(prisma, { ...filters, status: filters.status ?? "OPEN" }),
      loadMarketGlobalIndicators(),
    ]);
    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters,
        tables: buildReportsExportTables({
          monitored,
          alerts,
          indicators,
          filters,
        }),
        notes: ["Relatório consolidado da Inteligência de Mercado com filtros aplicados."],
      }),
    };
  }

  if (scope === "simulations") {
    const built = buildSimulationsExportTables(input.simulationResult ?? null);
    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters,
        tables: built.tables,
        notes: built.notes,
      }),
    };
  }

  if (scope === "impacted-products") {
    const payload = await buildMaterialBomImpactForApi(prisma, materialId);
    if ("notFound" in payload) {
      return { ok: false, status: 404, message: "Material não encontrado." };
    }
    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters,
        tables: [buildImpactedProductsExportRows(payload.items)],
      }),
    };
  }

  if (scope === "history") {
    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) {
      return { ok: false, status: 404, message: "Material não encontrado." };
    }

    const parsed = parseMaterialMarketPriceHistoryQuery({
      period: filters.period ?? "12m",
      dateFrom: filters.dateFrom ?? undefined,
      dateTo: filters.dateTo ?? undefined,
    });
    if (parsed.ok === false) {
      return { ok: false, status: 400, message: parsed.message };
    }

    const quotes = await prisma.materialMarketQuote.findMany({
      where: {
        materialId,
        quoteDate: {
          gte: new Date(`${parsed.range.dateFrom}T00:00:00.000Z`),
          lte: new Date(`${parsed.range.dateTo}T23:59:59.999Z`),
        },
        status: { not: "CANCELLED" },
      },
      orderBy: [{ quoteDate: "asc" }, { createdAt: "asc" }],
    });

    const usdDates = collectUsdQuoteDatesForPtax(quotes, parsed.range);
    const exchangeRatesByDate =
      usdDates.length > 0 ? await resolvePtaxRatesByDate(usdDates) : new Map();

    const history = buildMaterialMarketPriceHistoryResponse({
      rows: quotes,
      range: parsed.range,
      exchangeRatesByDate,
    });

    return {
      ok: true,
      document: buildMaterialMarketIntelligenceExportDocument({
        scope,
        filters: {
          ...filters,
          period: history.period.preset,
          dateFrom: history.period.dateFrom,
          dateTo: history.period.dateTo,
        },
        tables: [buildHistoryExportRows(history.points, filters)],
      }),
    };
  }

  // suppliers
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    return { ok: false, status: 404, message: "Material não encontrado." };
  }

  const period = parseMaterialMarketSupplierPeriod(filters.period);
  const quotes = await prisma.materialMarketQuote.findMany({
    where: { materialId },
    orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
    include: {
      FinancialSupplier: { select: { displayName: true } },
    },
  });

  const supplierNameById = new Map<string, string>();
  for (const quote of quotes) {
    if (quote.supplierId && quote.FinancialSupplier?.displayName) {
      supplierNameById.set(quote.supplierId, quote.FinancialSupplier.displayName);
    }
  }

  const comparison = buildMaterialMarketSupplierComparison(
    quotes.map((quote) => ({
      id: quote.id,
      supplierId: quote.supplierId,
      supplierName: quote.supplierName ?? quote.FinancialSupplier?.displayName ?? null,
      quoteDate: quote.quoteDate,
      netPrice: Number(quote.netPrice),
      paymentTerms: quote.paymentTerms,
      notes: quote.notes,
    })),
    { period, supplierNameById }
  );

  return {
    ok: true,
    document: buildMaterialMarketIntelligenceExportDocument({
      scope,
      filters: { ...filters, period: comparison.period },
      tables: [buildSuppliersExportRows(comparison.items, filters)],
    }),
  };
}
