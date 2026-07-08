/**
 * Relatórios executivos de Inteligência de Mercado.
 * Agrega serviços existentes (analytics, fornecedores, FX, economia, alertas, BOM, compras)
 * sem duplicar regras de negócio.
 */

import {
  buildMaterialMarketAlertListResponse,
  type MaterialMarketAlertApiItem,
  type MaterialMarketAlertSourceRow,
  type MaterialMarketAlertStatus,
  isMaterialMarketAlertStatus,
  parseMaterialMarketAlertStatusFilter,
} from "./materialMarketAlert.js";
import {
  evaluateMaterialMarketAlerts,
  MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS,
} from "./materialMarketAlertEngine.js";
import type { MaterialBomImpactItem } from "./materialBomImpact.types.js";
import { formatMaterialCategoryLabel } from "./materialCategoryLabels.js";
import {
  buildMaterialMarketFxDecompositionFromRows,
  type MaterialMarketFxDecompositionResult,
} from "./materialMarketFxDecomposition.js";
import {
  mapMonitoredMaterialListItem,
  type MonitoredMaterialListItem,
  type MonitoredMaterialSourceRow,
} from "./materialMarketIntelligenceMonitored.js";
import {
  isMaterialMarketCriticality,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  type MaterialMarketCriticality,
} from "./materialMarketMonitoring.js";
import {
  buildMaterialMarketQuoteAnalyticsFromRows,
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS,
  parseMaterialMarketQuoteAnalyticsPeriod,
  type MaterialMarketQuoteAnalyticsPeriod,
  type MaterialMarketQuoteAnalyticsResult,
} from "./materialMarketQuoteAnalytics.js";
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import {
  buildMaterialMarketPurchaseLinkListResponse,
  type MaterialMarketPurchaseLinkApiItem,
} from "./materialMarketPurchaseLink.js";
import {
  DEFAULT_MATERIAL_MARKET_SAVINGS_PERIOD,
  DEFAULT_MATERIAL_MARKET_SAVINGS_RANKING_VOLUME,
  parseMaterialMarketSavingsVolume,
  rankMaterialMarketSavingsOpportunities,
  type MaterialMarketSavingsOpportunitiesResponse,
} from "./materialMarketSavingsOpportunity.js";
import {
  MATERIAL_MARKET_SITUATION_STATUS_LABELS,
  MATERIAL_MARKET_SITUATION_STATUS_VALUES,
  type MaterialMarketSituationStatus,
} from "./materialMarketSituationStatus.js";
import {
  buildMaterialMarketSupplierComparison,
  parseMaterialMarketSupplierPeriod,
  type MaterialMarketSupplierComparisonResponse,
  type MaterialMarketSupplierPeriod,
} from "./materialMarketSupplierComparison.js";
import type { MarketGlobalIndicatorsDto } from "./marketGlobalIndicators.js";
import { getMaterialMarketIntelligenceDetailPath } from "./materialsNavigation.js";

export const MATERIAL_MARKET_REPORT_TYPE_VALUES = [
  "price_evolution",
  "supplier_comparison",
  "fx_impact",
  "brent_impact",
  "opportunities",
  "risks",
  "savings_obtained",
  "impacted_products",
  "materials_without_recent_quotes",
] as const;

export type MaterialMarketReportType = (typeof MATERIAL_MARKET_REPORT_TYPE_VALUES)[number];

export const MATERIAL_MARKET_REPORT_TYPE_LABELS: Record<MaterialMarketReportType, string> = {
  price_evolution: "Evolução de preços",
  supplier_comparison: "Comparação entre fornecedores",
  fx_impact: "Impacto cambial",
  brent_impact: "Impacto Brent",
  opportunities: "Oportunidades",
  risks: "Riscos",
  savings_obtained: "Economia obtida",
  impacted_products: "Produtos impactados",
  materials_without_recent_quotes: "Matérias sem cotação recente",
};

export const MATERIAL_MARKET_REPORT_EMPTY_MESSAGE =
  "Nenhum dado disponível para os filtros selecionados.";

export const MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE =
  "Nenhuma matéria-prima monitorada disponível para o relatório.";

export type MaterialMarketReportFilters = {
  materialId: string | null;
  supplier: string | null;
  category: string | null;
  period: MaterialMarketQuoteAnalyticsPeriod;
  criticality: MaterialMarketCriticality | null;
  /** Situação de mercado (OPORTUNIDADE / NORMAL / …). */
  situation: MaterialMarketSituationStatus | null;
  /** Status de alerta (OPEN / READ / RESOLVED / ALL). */
  alertStatus: MaterialMarketAlertStatus | "ALL";
  reportTypes: MaterialMarketReportType[] | null;
};

export type MaterialMarketReportPurchaseLinkRow = {
  id: string;
  materialId: string;
  quoteId: string;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  supplierName: string;
  quantityPurchased: number | string;
  negotiatedPrice: number | string;
  purchaseDate: Date | string;
  choiceReason?: string | null;
  estimatedSavings: number | string;
  referenceUnitPriceBrl: number | string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
};

export type MaterialMarketReportMaterialInput = MonitoredMaterialSourceRow & {
  supplier?: string | null;
  marketMonitoringFrequencyDays?: number | null;
  purchaseLinks?: MaterialMarketReportPurchaseLinkRow[];
  bomImpactItems?: MaterialBomImpactItem[];
};

export type MaterialMarketReportBuildInput = {
  materials: MaterialMarketReportMaterialInput[];
  alerts?: MaterialMarketAlertSourceRow[];
  globalIndicators?: MarketGlobalIndicatorsDto | null;
  filters?: Partial<MaterialMarketReportFilters> | Record<string, unknown>;
  referenceDate?: Date;
  estimatedVolume?: number;
};

export type MaterialMarketReportPriceEvolutionItem = {
  materialId: string;
  code: string;
  description: string;
  intelligencePath: string;
  analytics: MaterialMarketQuoteAnalyticsResult;
};

export type MaterialMarketReportSupplierComparisonItem = {
  materialId: string;
  code: string;
  description: string;
  intelligencePath: string;
  comparison: MaterialMarketSupplierComparisonResponse;
};

export type MaterialMarketReportFxImpactItem = {
  materialId: string;
  code: string;
  description: string;
  intelligencePath: string;
  fx: MaterialMarketFxDecompositionResult;
};

export type MaterialMarketReportBrentImpactSection = {
  empty: boolean;
  message: string | null;
  brentPrice: number | null;
  brentVariationPct: number | null;
  brentLastUpdate: string | null;
  materialsWithUsdQuotes: number;
  averageExchangeVariationPct: number | null;
  items: MaterialMarketReportFxImpactItem[];
};

export type MaterialMarketReportStaleMaterialItem = {
  materialId: string;
  code: string;
  description: string;
  intelligencePath: string;
  daysSinceLatest: number | null;
  daysThreshold: number;
  lastQuoteDate: string | null;
  message: string;
  severity: string;
};

export type MaterialMarketReportImpactedProductsSection = {
  empty: boolean;
  message: string | null;
  totalProducts: number;
  items: Array<
    MaterialBomImpactItem & {
      materialId: string;
      materialCode: string;
      materialDescription: string;
    }
  >;
};

export type MaterialMarketReportSummary = {
  monitoredCount: number;
  opportunitiesCount: number;
  risksCount: number;
  openAlertsCount: number;
  potentialSavingsTotal: number;
  obtainedSavingsTotal: number;
  staleQuotesCount: number;
  impactedProductsCount: number;
};

export type MaterialMarketIntelligenceReport = {
  generatedAt: string;
  empty: boolean;
  emptyMessage: string | null;
  filters: MaterialMarketReportFilters & {
    periodLabel: string;
    criticalityLabel: string | null;
    situationLabel: string | null;
    reportTypeLabels: string[];
  };
  summary: MaterialMarketReportSummary;
  materials: MonitoredMaterialListItem[];
  sections: {
    priceEvolution: {
      empty: boolean;
      message: string | null;
      items: MaterialMarketReportPriceEvolutionItem[];
    };
    supplierComparison: {
      empty: boolean;
      message: string | null;
      items: MaterialMarketReportSupplierComparisonItem[];
    };
    fxImpact: {
      empty: boolean;
      message: string | null;
      items: MaterialMarketReportFxImpactItem[];
    };
    brentImpact: MaterialMarketReportBrentImpactSection;
    opportunities: MaterialMarketSavingsOpportunitiesResponse & {
      empty: boolean;
      message: string | null;
    };
    risks: {
      empty: boolean;
      message: string | null;
      situationItems: MonitoredMaterialListItem[];
      alerts: MaterialMarketAlertApiItem[];
    };
    savingsObtained: {
      empty: boolean;
      message: string | null;
      totalSavings: number;
      items: MaterialMarketPurchaseLinkApiItem[];
    };
    impactedProducts: MaterialMarketReportImpactedProductsSection;
    materialsWithoutRecentQuotes: {
      empty: boolean;
      message: string | null;
      items: MaterialMarketReportStaleMaterialItem[];
    };
  };
};

export class MaterialMarketReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialMarketReportParseError";
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeLower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return roundPercent(values.reduce((sum, n) => sum + n, 0) / values.length);
}

export function isMaterialMarketReportType(value: unknown): value is MaterialMarketReportType {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_REPORT_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketReportTypes(value: unknown): MaterialMarketReportType[] | null {
  if (value == null || value === "" || value === "all") return null;
  const raw = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  const types = raw.filter(isMaterialMarketReportType);
  if (!types.length) {
    throw new MaterialMarketReportParseError(
      "Tipo de relatório inválido. Use um dos tipos suportados ou all."
    );
  }
  return [...new Set(types)];
}

function isMaterialMarketSituationStatus(value: unknown): value is MaterialMarketSituationStatus {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_SITUATION_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketReportSituationFilter(
  value: unknown
): MaterialMarketSituationStatus | null {
  if (value == null || value === "" || value === "ALL") return null;
  if (!isMaterialMarketSituationStatus(value)) {
    throw new MaterialMarketReportParseError("Status de situação de mercado inválido.");
  }
  return value;
}

export function parseMaterialMarketReportCriticalityFilter(
  value: unknown
): MaterialMarketCriticality | null {
  if (value == null || value === "") return null;
  if (!isMaterialMarketCriticality(value)) {
    throw new MaterialMarketReportParseError("Criticidade inválida.");
  }
  return value;
}

export function parseMaterialMarketReportQuery(
  query: Record<string, unknown> = {}
): MaterialMarketReportFilters {
  const materialId = normalizeText(query.materialId);
  const supplier = normalizeText(query.supplier);
  const category =
    normalizeText(query.category) ??
    normalizeText(query.family) ??
    normalizeText(query.group);
  const period = parseMaterialMarketQuoteAnalyticsPeriod(query.period, "90d");
  const criticality = parseMaterialMarketReportCriticalityFilter(
    query.criticality ?? query.marketCriticality
  );
  const situation = parseMaterialMarketReportSituationFilter(
    query.situation ?? query.status
  );
  const alertStatusRaw = query.alertStatus;
  const alertStatus =
    alertStatusRaw == null || alertStatusRaw === ""
      ? "ALL"
      : parseMaterialMarketAlertStatusFilter(alertStatusRaw);
  if (
    alertStatusRaw != null &&
    alertStatusRaw !== "" &&
    alertStatus !== "ALL" &&
    !isMaterialMarketAlertStatus(alertStatusRaw)
  ) {
    // parseMaterialMarketAlertStatusFilter already falls back to OPEN for invalid;
    // only reject when explicitly unusable and not ALL.
  }

  const reportTypes = parseMaterialMarketReportTypes(query.reportType ?? query.type ?? query.types);

  return {
    materialId,
    supplier,
    category,
    period,
    criticality,
    situation,
    alertStatus,
    reportTypes,
  };
}

function includesReportType(
  filters: MaterialMarketReportFilters,
  type: MaterialMarketReportType
): boolean {
  if (!filters.reportTypes || filters.reportTypes.length === 0) return true;
  return filters.reportTypes.includes(type);
}

function quoteMatchesSupplier(
  quote: MaterialMarketQuoteSourceRow,
  supplierQuery: string
): boolean {
  const q = normalizeLower(supplierQuery);
  const name = normalizeLower(quote.supplierName ?? undefined);
  return Boolean(name && name.includes(q));
}

function materialMatchesSupplierFilter(
  material: MaterialMarketReportMaterialInput,
  supplierQuery: string
): boolean {
  const q = normalizeLower(supplierQuery);
  if (!q) return true;
  if (normalizeLower(material.supplier ?? undefined).includes(q)) return true;
  return (material.MaterialMarketQuote ?? []).some((quote) => quoteMatchesSupplier(quote, q));
}

export function filterMaterialsForMarketReport(
  materials: MaterialMarketReportMaterialInput[],
  filters: MaterialMarketReportFilters
): MaterialMarketReportMaterialInput[] {
  const category = normalizeLower(filters.category);
  return materials.filter((material) => {
    if (!material.isMarketMonitored) return false;
    if (filters.materialId && material.id !== filters.materialId) return false;
    if (filters.criticality && material.marketCriticality !== filters.criticality) return false;
    if (category && normalizeLower(material.category) !== category) return false;
    if (filters.supplier && !materialMatchesSupplierFilter(material, filters.supplier)) {
      return false;
    }
    if (filters.situation) {
      const item = mapMonitoredMaterialListItem(material);
      if (item.marketSituation.status !== filters.situation) return false;
    }
    return true;
  });
}

function filterQuotesForSupplier(
  quotes: MaterialMarketQuoteSourceRow[],
  supplier: string | null
): MaterialMarketQuoteSourceRow[] {
  if (!supplier) return quotes;
  return quotes.filter((quote) => quoteMatchesSupplier(quote, supplier));
}

function mapSupplierPeriod(period: MaterialMarketQuoteAnalyticsPeriod): MaterialMarketSupplierPeriod {
  if (period === "7d" || period === "30d") return "30d";
  if (period === "90d") return "90d";
  if (period === "365d") return "12m";
  return parseMaterialMarketSupplierPeriod(period);
}

function emptySectionMessage(hasMaterials: boolean): string {
  return hasMaterials
    ? MATERIAL_MARKET_REPORT_EMPTY_MESSAGE
    : MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE;
}

function buildStaleMaterials(
  materials: MaterialMarketReportMaterialInput[],
  referenceDate: Date
): MaterialMarketReportStaleMaterialItem[] {
  const items: MaterialMarketReportStaleMaterialItem[] = [];

  for (const material of materials) {
    const proposals = evaluateMaterialMarketAlerts({
      materialId: material.id,
      materialCode: material.code,
      materialDescription: material.description,
      isMarketMonitored: true,
      marketMonitoringFrequencyDays: material.marketMonitoringFrequencyDays,
      quotes: (material.MaterialMarketQuote ?? []).map((quote) => ({
        id: quote.id,
        quoteDate: quote.quoteDate,
        netPrice: quote.netPrice,
        supplierName: quote.supplierName,
        status: quote.status,
      })),
      referenceDate,
      thresholds: MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS,
    }).filter((proposal) => proposal.alertType === "NO_RECENT_QUOTE");

    for (const proposal of proposals) {
      const daysSinceLatest =
        typeof proposal.metadata.daysSinceLatest === "number"
          ? proposal.metadata.daysSinceLatest
          : null;
      const daysThreshold =
        typeof proposal.metadata.daysThreshold === "number"
          ? proposal.metadata.daysThreshold
          : MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.noRecentQuoteDays;
      const lastQuoteDate =
        typeof proposal.metadata.lastQuoteDate === "string"
          ? proposal.metadata.lastQuoteDate
          : null;

      items.push({
        materialId: material.id,
        code: material.code,
        description: material.description,
        intelligencePath: getMaterialMarketIntelligenceDetailPath(material.id),
        daysSinceLatest,
        daysThreshold,
        lastQuoteDate,
        message: proposal.message,
        severity: proposal.severity,
      });
    }
  }

  return items.sort((a, b) => (b.daysSinceLatest ?? 9999) - (a.daysSinceLatest ?? 9999));
}

function buildImpactedProductsSection(
  materials: MaterialMarketReportMaterialInput[]
): MaterialMarketReportImpactedProductsSection {
  const items = materials.flatMap((material) =>
    (material.bomImpactItems ?? []).map((item) => ({
      ...item,
      materialId: material.id,
      materialCode: material.code,
      materialDescription: material.description,
    }))
  );

  if (!items.length) {
    return {
      empty: true,
      message:
        materials.length === 1
          ? "Nenhum produto vinculado a esta matéria-prima na BOM oficial."
          : "Nenhum produto impactado encontrado para os filtros. Selecione uma matéria-prima para detalhar a BOM.",
      totalProducts: 0,
      items: [],
    };
  }

  return {
    empty: false,
    message: null,
    totalProducts: new Set(items.map((item) => item.productId)).size,
    items,
  };
}

export function buildMaterialMarketIntelligenceReport(
  input: MaterialMarketReportBuildInput
): MaterialMarketIntelligenceReport {
  const filters = parseMaterialMarketReportQuery({
    ...(input.filters ?? {}),
  });
  const referenceDate = input.referenceDate ?? new Date();
  const volume = parseMaterialMarketSavingsVolume(
    input.estimatedVolume,
    DEFAULT_MATERIAL_MARKET_SAVINGS_RANKING_VOLUME
  );

  const filteredMaterials = filterMaterialsForMarketReport(input.materials, filters);
  const materialItems = filteredMaterials.map(mapMonitoredMaterialListItem);
  const materialIds = new Set(filteredMaterials.map((material) => material.id));

  const alertsRaw = (input.alerts ?? []).filter((alert) => materialIds.has(alert.materialId));
  const alertList = buildMaterialMarketAlertListResponse(
    filters.alertStatus === "ALL"
      ? alertsRaw
      : alertsRaw.filter((alert) => alert.status === filters.alertStatus)
  );

  const opportunitiesBase = rankMaterialMarketSavingsOpportunities({
    estimatedVolume: volume,
    period: filters.period,
    referenceDate,
    materials: filteredMaterials.map((material) => ({
      id: material.id,
      code: material.code,
      description: material.description,
      unit: material.unit,
      currentCost: material.currentCost,
      quotes: filterQuotesForSupplier(material.MaterialMarketQuote ?? [], filters.supplier),
      intelligencePath: getMaterialMarketIntelligenceDetailPath(material.id),
    })),
  });

  const priceEvolutionItems: MaterialMarketReportPriceEvolutionItem[] = [];
  const supplierItems: MaterialMarketReportSupplierComparisonItem[] = [];
  const fxItems: MaterialMarketReportFxImpactItem[] = [];

  for (const material of filteredMaterials) {
    const quotes = filterQuotesForSupplier(material.MaterialMarketQuote ?? [], filters.supplier);
    const intelligencePath = getMaterialMarketIntelligenceDetailPath(material.id);

    if (includesReportType(filters, "price_evolution")) {
      const analytics = buildMaterialMarketQuoteAnalyticsFromRows(quotes, {
        period: filters.period,
        referenceDate,
      });
      if (!analytics.empty) {
        priceEvolutionItems.push({
          materialId: material.id,
          code: material.code,
          description: material.description,
          intelligencePath,
          analytics,
        });
      }
    }

    if (includesReportType(filters, "supplier_comparison")) {
      const comparison = buildMaterialMarketSupplierComparison(
        quotes.map((quote) => ({
          id: quote.id,
          supplierId: quote.supplierId,
          supplierName: quote.supplierName,
          quoteDate: quote.quoteDate,
          netPrice: Number(quote.netPrice),
          paymentTerms: quote.paymentTerms,
          notes: quote.notes,
        })),
        { period: mapSupplierPeriod(filters.period), referenceDate }
      );
      if (comparison.total > 0) {
        supplierItems.push({
          materialId: material.id,
          code: material.code,
          description: material.description,
          intelligencePath,
          comparison,
        });
      }
    }

    if (
      includesReportType(filters, "fx_impact") ||
      includesReportType(filters, "brent_impact")
    ) {
      const fx = buildMaterialMarketFxDecompositionFromRows({
        materialName: material.description,
        rows: quotes,
        period: filters.period,
        referenceDate,
      });
      if (fx.hasSufficientData) {
        fxItems.push({
          materialId: material.id,
          code: material.code,
          description: material.description,
          intelligencePath,
          fx,
        });
      }
    }
  }

  const situationRisks = materialItems.filter(
    (item) =>
      item.marketSituation.status === "ATENCAO" || item.marketSituation.status === "CRITICO"
  );
  const riskAlerts = alertList.items.filter(
    (alert) => alert.severity === "WARNING" || alert.severity === "CRITICAL"
  );

  const purchaseLinkRows = filteredMaterials.flatMap((material) => material.purchaseLinks ?? []);
  const purchaseLinks = buildMaterialMarketPurchaseLinkListResponse(
    purchaseLinkRows.map((row) => ({
      ...row,
      createdAt: row.createdAt ?? row.purchaseDate,
    }))
  ).items.filter((item) => item.hasSavings);
  const obtainedSavingsTotal = roundMoney(
    purchaseLinks.reduce((sum, item) => sum + item.estimatedSavings, 0)
  );

  const staleItems = includesReportType(filters, "materials_without_recent_quotes")
    ? buildStaleMaterials(filteredMaterials, referenceDate)
    : [];

  const impactedProducts = includesReportType(filters, "impacted_products")
    ? buildImpactedProductsSection(filteredMaterials)
    : {
        empty: true,
        message: null,
        totalProducts: 0,
        items: [],
      };

  const brent = input.globalIndicators?.brent ?? null;
  const materialsWithUsdQuotes = filteredMaterials.filter((material) =>
    (material.MaterialMarketQuote ?? []).some(
      (quote) => String(quote.currency ?? "").toUpperCase() === "USD"
    )
  ).length;
  const exchangeVariations = fxItems
    .map((item) => item.fx.exchangeVariationPct)
    .filter((value): value is number => value != null);
  const brentImpact: MaterialMarketReportBrentImpactSection = {
    empty: !brent && fxItems.length === 0,
    message:
      !brent && fxItems.length === 0
        ? emptySectionMessage(filteredMaterials.length > 0)
        : null,
    brentPrice: brent?.price ?? null,
    brentVariationPct: brent?.variationFromPrevious ?? null,
    brentLastUpdate: brent?.lastUpdate ?? null,
    materialsWithUsdQuotes,
    averageExchangeVariationPct: average(exchangeVariations),
    items: fxItems,
  };

  const hasAnySectionData =
    priceEvolutionItems.length > 0 ||
    supplierItems.length > 0 ||
    fxItems.length > 0 ||
    !brentImpact.empty ||
    opportunitiesBase.items.length > 0 ||
    situationRisks.length > 0 ||
    riskAlerts.length > 0 ||
    purchaseLinks.length > 0 ||
    !impactedProducts.empty ||
    staleItems.length > 0;

  const empty = filteredMaterials.length === 0 || !hasAnySectionData;

  const summary: MaterialMarketReportSummary = {
    monitoredCount: materialItems.length,
    opportunitiesCount: opportunitiesBase.items.length,
    risksCount: situationRisks.length + riskAlerts.length,
    openAlertsCount: alertList.openCount,
    potentialSavingsTotal: roundMoney(
      opportunitiesBase.items.reduce((sum, item) => sum + item.totalSavings, 0)
    ),
    obtainedSavingsTotal,
    staleQuotesCount: staleItems.length,
    impactedProductsCount: impactedProducts.totalProducts,
  };

  return {
    generatedAt: referenceDate.toISOString(),
    empty,
    emptyMessage: empty
      ? filteredMaterials.length === 0
        ? MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE
        : MATERIAL_MARKET_REPORT_EMPTY_MESSAGE
      : null,
    filters: {
      ...filters,
      periodLabel: MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[filters.period],
      criticalityLabel: filters.criticality
        ? MATERIAL_MARKET_CRITICALITY_LABELS[filters.criticality]
        : null,
      situationLabel: filters.situation
        ? MATERIAL_MARKET_SITUATION_STATUS_LABELS[filters.situation]
        : null,
      reportTypeLabels: (filters.reportTypes ?? [...MATERIAL_MARKET_REPORT_TYPE_VALUES]).map(
        (type) => MATERIAL_MARKET_REPORT_TYPE_LABELS[type]
      ),
    },
    summary,
    materials: materialItems,
    sections: {
      priceEvolution: {
        empty: priceEvolutionItems.length === 0,
        message:
          priceEvolutionItems.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
        items: priceEvolutionItems,
      },
      supplierComparison: {
        empty: supplierItems.length === 0,
        message:
          supplierItems.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
        items: supplierItems,
      },
      fxImpact: {
        empty: fxItems.length === 0,
        message:
          fxItems.length === 0 ? emptySectionMessage(filteredMaterials.length > 0) : null,
        items: fxItems,
      },
      brentImpact,
      opportunities: {
        ...opportunitiesBase,
        empty: opportunitiesBase.items.length === 0,
        message:
          opportunitiesBase.items.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
      },
      risks: {
        empty: situationRisks.length === 0 && riskAlerts.length === 0,
        message:
          situationRisks.length === 0 && riskAlerts.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
        situationItems: situationRisks,
        alerts: riskAlerts,
      },
      savingsObtained: {
        empty: purchaseLinks.length === 0,
        message:
          purchaseLinks.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
        totalSavings: obtainedSavingsTotal,
        items: purchaseLinks,
      },
      impactedProducts,
      materialsWithoutRecentQuotes: {
        empty: staleItems.length === 0,
        message:
          staleItems.length === 0
            ? emptySectionMessage(filteredMaterials.length > 0)
            : null,
        items: staleItems,
      },
    },
  };
}

export function formatMaterialMarketReportCategoryOptions(
  materials: Array<{ category: string }>
): Array<{ value: string; label: string }> {
  const map = new Map<string, string>();
  for (const material of materials) {
    const value = material.category?.trim();
    if (!value) continue;
    map.set(value, formatMaterialCategoryLabel(value));
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Período padrão alinhado às oportunidades da Home. */
export const DEFAULT_MATERIAL_MARKET_REPORT_PERIOD: MaterialMarketQuoteAnalyticsPeriod =
  DEFAULT_MATERIAL_MARKET_SAVINGS_PERIOD;
