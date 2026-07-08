/**
 * Detalhe de inteligência de mercado por matéria-prima (monitorada ou não).
 */
import { formatMaterialCategoryLabel } from "./materialCategoryLabels.js";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  isMaterialMarketCriticality,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  serializeMaterialForApi,
  type MaterialMarketCriticality,
} from "./materialMarketMonitoring.js";
import {
  resolveMaterialLastQuote,
  type MonitoredMaterialPriceHistoryRow,
} from "./materialMarketIntelligenceMonitored.js";
import {
  buildMaterialMarketQuoteListResponse,
  type MaterialMarketQuoteApiItem,
  type MaterialMarketQuoteSourceRow,
} from "./materialMarketQuote.js";
import { getMaterialMarketIntelligenceDetailPath } from "./materialsNavigation.js";

export type MaterialIntelligenceDetailSourceRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  supplier?: string | null;
  currentCost: number | string;
  isMarketMonitored: boolean;
  marketCriticality?: string | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
  MaterialPriceHistory?: MonitoredMaterialPriceHistoryRow[];
  MaterialMarketQuote?: MaterialMarketQuoteSourceRow[];
};

export type MaterialIntelligenceDetailItem = {
  id: string;
  code: string;
  description: string;
  family: string;
  familyCode: string;
  unit: string;
  supplier: string | null;
  isMarketMonitored: boolean;
  marketCriticality: MaterialMarketCriticality | null;
  marketMonitoringFrequencyDays: number | null;
  marketNotes: string | null;
  monitoringStatusLabel: string;
  lastQuoteAmount: number | null;
  lastQuoteDate: string | null;
  recentQuotes: MaterialMarketQuoteApiItem[];
  intelligencePath: string;
};

export type MaterialIntelligenceQuoteRow = {
  amount: number;
  date: string | null;
};

export function mapMaterialIntelligenceMarketQuotes(
  quotes: MaterialMarketQuoteSourceRow[] | undefined
): MaterialMarketQuoteApiItem[] {
  if (!quotes?.length) return [];
  return buildMaterialMarketQuoteListResponse(quotes).items;
}

export function resolveLatestMarketQuote(
  quotes: MaterialMarketQuoteApiItem[]
): { amount: number | null; date: string | null } {
  const latest = quotes[0];
  if (!latest) return { amount: null, date: null };
  return { amount: latest.netPrice, date: latest.quoteDate };
}

export function buildMaterialIntelligenceMonitoringStatusLabel(input: {
  isMarketMonitored: boolean;
  marketCriticality: MaterialMarketCriticality | null;
}): string {
  if (!input.isMarketMonitored) return "Não monitorada";
  const criticality = input.marketCriticality ?? DEFAULT_MATERIAL_MARKET_CRITICALITY;
  return `Monitorada · ${MATERIAL_MARKET_CRITICALITY_LABELS[criticality]}`;
}

export function mapMaterialIntelligenceDetail(
  material: MaterialIntelligenceDetailSourceRow
): MaterialIntelligenceDetailItem {
  const marketFields = serializeMaterialForApi(material);
  const recentQuotes = mapMaterialIntelligenceMarketQuotes(material.MaterialMarketQuote);
  const latestQuote = resolveLatestMarketQuote(recentQuotes);
  const priceHistoryFallback = resolveMaterialLastQuote({
    currentCost: material.currentCost,
    priceHistory: material.MaterialPriceHistory,
  });
  const lastQuoteAmount = latestQuote.amount ?? priceHistoryFallback.amount;
  const lastQuoteDate = latestQuote.date ?? priceHistoryFallback.date;

  return {
    id: material.id,
    code: material.code,
    description: material.description,
    family: formatMaterialCategoryLabel(material.category),
    familyCode: material.category,
    unit: material.unit,
    supplier: material.supplier?.trim() || null,
    isMarketMonitored: marketFields.isMarketMonitored,
    marketCriticality: marketFields.marketCriticality,
    marketMonitoringFrequencyDays: marketFields.marketMonitoringFrequencyDays,
    marketNotes: marketFields.marketNotes,
    monitoringStatusLabel: buildMaterialIntelligenceMonitoringStatusLabel({
      isMarketMonitored: marketFields.isMarketMonitored,
      marketCriticality: marketFields.marketCriticality,
    }),
    lastQuoteAmount,
    lastQuoteDate,
    recentQuotes,
    intelligencePath: getMaterialMarketIntelligenceDetailPath(material.id),
  };
}
