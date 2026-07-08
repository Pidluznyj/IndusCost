/**
 * Listagem de matérias-primas monitoradas — Inteligência de Mercado.
 */
import { formatMaterialCategoryLabel } from "./materialCategoryLabels.js";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  isMaterialMarketCriticality,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  type MaterialMarketCriticality,
} from "./materialMarketMonitoring.js";
import { getMaterialMarketIntelligenceDetailPath } from "./materialsNavigation.js";

export type MonitoredMaterialPriceHistoryRow = {
  price: number | string;
  effectiveDate?: Date | string | null;
};

export type MonitoredMaterialSourceRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  currentCost: number | string;
  isMarketMonitored: boolean;
  marketCriticality?: string | null;
  MaterialPriceHistory?: MonitoredMaterialPriceHistoryRow[];
};

export type MonitoredMaterialListItem = {
  id: string;
  code: string;
  description: string;
  family: string;
  familyCode: string;
  unit: string;
  marketCriticality: MaterialMarketCriticality;
  isMarketMonitored: true;
  monitoringStatusLabel: string;
  lastQuoteAmount: number | null;
  lastQuoteDate: string | null;
  intelligencePath: string;
};

export type MonitoredMaterialListFilters = {
  q?: string | null;
  criticality?: string | null;
};

export const MONITORED_MATERIALS_EMPTY_FILTER_MESSAGE =
  "Nenhuma matéria-prima monitorada corresponde aos filtros aplicados.";

export function normalizeMonitoredMaterialSearchQuery(q: string | null | undefined): string {
  return (q ?? "").trim().toLowerCase();
}

export function parseMonitoredMaterialCriticalityFilter(
  value: string | null | undefined
): MaterialMarketCriticality | null {
  if (!value?.trim()) return null;
  return isMaterialMarketCriticality(value.trim()) ? value.trim() : null;
}

export function resolveMaterialLastQuote(input: {
  currentCost: number | string;
  priceHistory?: MonitoredMaterialPriceHistoryRow[];
}): { amount: number | null; date: string | null } {
  const latest = input.priceHistory?.[0];
  if (latest) {
    const amount = Number(latest.price);
    if (Number.isFinite(amount)) {
      const rawDate = latest.effectiveDate;
      const date =
        rawDate != null && String(rawDate).trim()
          ? new Date(rawDate).toISOString()
          : null;
      return { amount, date };
    }
  }
  return { amount: null, date: null };
}

export function mapMonitoredMaterialListItem(
  material: MonitoredMaterialSourceRow
): MonitoredMaterialListItem {
  const marketCriticality = isMaterialMarketCriticality(material.marketCriticality)
    ? material.marketCriticality
    : DEFAULT_MATERIAL_MARKET_CRITICALITY;
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
    marketCriticality,
    isMarketMonitored: true,
    monitoringStatusLabel: `Monitorada · ${MATERIAL_MARKET_CRITICALITY_LABELS[marketCriticality]}`,
    lastQuoteAmount: lastQuote.amount,
    lastQuoteDate: lastQuote.date,
    intelligencePath: getMaterialMarketIntelligenceDetailPath(material.id),
  };
}

export function materialMatchesMonitoredSearch(
  material: Pick<MonitoredMaterialSourceRow, "code" | "description">,
  q: string
): boolean {
  const query = normalizeMonitoredMaterialSearchQuery(q);
  if (!query) return true;
  return (
    material.code.toLowerCase().includes(query) ||
    material.description.toLowerCase().includes(query)
  );
}

/** Filtra linhas já restritas a isMarketMonitored=true (uso em testes e pós-query). */
export function filterMonitoredMaterialRows<T extends MonitoredMaterialSourceRow>(
  rows: T[],
  filters: MonitoredMaterialListFilters = {}
): T[] {
  const q = normalizeMonitoredMaterialSearchQuery(filters.q);
  const criticality = parseMonitoredMaterialCriticalityFilter(filters.criticality);

  return rows.filter((row) => {
    if (!row.isMarketMonitored) return false;
    if (criticality && row.marketCriticality !== criticality) return false;
    if (q && !materialMatchesMonitoredSearch(row, q)) return false;
    return true;
  });
}

export function buildMonitoredMaterialListResponse(
  rows: MonitoredMaterialSourceRow[],
  filters: MonitoredMaterialListFilters = {}
): {
  items: MonitoredMaterialListItem[];
  total: number;
  filters: { q: string; criticality: MaterialMarketCriticality | null };
} {
  const filtered = filterMonitoredMaterialRows(rows, filters).sort((a, b) =>
    a.code.localeCompare(b.code, "pt-BR")
  );
  return {
    items: filtered.map(mapMonitoredMaterialListItem),
    total: filtered.length,
    filters: {
      q: normalizeMonitoredMaterialSearchQuery(filters.q),
      criticality: parseMonitoredMaterialCriticalityFilter(filters.criticality),
    },
  };
}
