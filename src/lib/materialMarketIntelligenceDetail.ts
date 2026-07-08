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
import { getMaterialMarketIntelligenceDetailPath } from "./materialsNavigation.js";

export type MaterialIntelligenceDetailSourceRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  currentCost: number | string;
  isMarketMonitored: boolean;
  marketCriticality?: string | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
  MaterialPriceHistory?: MonitoredMaterialPriceHistoryRow[];
};

export type MaterialIntelligenceDetailItem = {
  id: string;
  code: string;
  description: string;
  family: string;
  familyCode: string;
  unit: string;
  isMarketMonitored: boolean;
  marketCriticality: MaterialMarketCriticality | null;
  marketMonitoringFrequencyDays: number | null;
  marketNotes: string | null;
  monitoringStatusLabel: string;
  lastQuoteAmount: number | null;
  lastQuoteDate: string | null;
  intelligencePath: string;
};

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
  const lastQuote = resolveMaterialLastQuote({
    currentCost: material.currentCost,
    priceHistory: material.MaterialPriceHistory,
  });

  return {
    id: material.id,
    code: material.code,
    description: material.description,
    family: formatMaterialCategoryLabel(material.category),
    familyCode: material.category,
    unit: material.unit,
    isMarketMonitored: marketFields.isMarketMonitored,
    marketCriticality: marketFields.marketCriticality,
    marketMonitoringFrequencyDays: marketFields.marketMonitoringFrequencyDays,
    marketNotes: marketFields.marketNotes,
    monitoringStatusLabel: buildMaterialIntelligenceMonitoringStatusLabel({
      isMarketMonitored: marketFields.isMarketMonitored,
      marketCriticality: marketFields.marketCriticality,
    }),
    lastQuoteAmount: lastQuote.amount,
    lastQuoteDate: lastQuote.date,
    intelligencePath: getMaterialMarketIntelligenceDetailPath(material.id),
  };
}
