/**
 * Rotas e seções do módulo Suprimentos (materials).
 */

export const MATERIALS_BASE_PATH = "/materials" as const;

export const MATERIALS_SECTION_IDS = ["catalog", "marketIntelligence"] as const;

export type MaterialsSectionId = (typeof MATERIALS_SECTION_IDS)[number];

export const MATERIALS_SECTION_PATHS: Record<MaterialsSectionId, string> = {
  catalog: MATERIALS_BASE_PATH,
  marketIntelligence: `${MATERIALS_BASE_PATH}/market-intelligence`,
};

export const MATERIALS_MARKET_INTELLIGENCE_MONITORED_API =
  "/api/materials/market-intelligence/monitored" as const;

export const MATERIALS_MARKET_GLOBAL_INDICATORS_API =
  "/api/market-intelligence/global-indicators" as const;

export const MATERIALS_MARKET_INTELLIGENCE_OPPORTUNITIES_API =
  "/api/materials/market-intelligence/opportunities" as const;

export const MATERIALS_MARKET_INTELLIGENCE_ALERTS_API =
  "/api/materials/market-intelligence/alerts" as const;

export const BRENT_COMMODITY_LATEST_API =
  "/api/market-intelligence/commodities/brent/latest" as const;

export const BRENT_COMMODITY_COLLECT_API =
  "/api/market-intelligence/commodities/brent/collect" as const;

export function getMaterialMarketIntelligenceAlertsApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/alerts`;
}

export function getMaterialMarketIntelligenceDetailApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}`;
}

export function getMaterialMarketIntelligenceQuotesApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/quotes`;
}

export function getMaterialMarketQuoteAttachmentsApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/attachments`;
}

export function getMaterialMarketQuoteAttachmentDownloadApiPath(
  materialId: string,
  quoteId: string,
  attachmentId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/attachments/${attachmentId}/download`;
}

export function getMaterialMarketQuoteSubmitApprovalApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/submit-approval`;
}

export function getMaterialMarketQuoteApproveApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/approve`;
}

export function getMaterialMarketQuoteRejectApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/reject`;
}

export function getMaterialMarketQuoteSetOfficialApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/set-official`;
}

export function getMaterialMarketIntelligenceSetOfficialQuoteApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/set-official`;
}

export function getMaterialMarketPtaxPreviewApiPath(date: string): string {
  return `/api/materials/market-intelligence/ptax-preview?date=${encodeURIComponent(date)}`;
}

export function getMaterialMarketIntelligenceFxDecompositionApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/fx-decomposition`;
}

export function getMaterialMarketIntelligenceSavingsApiPath(
  materialId: string,
  query?: { volume?: number | string; period?: string }
): string {
  const params = new URLSearchParams();
  if (query?.volume != null && String(query.volume).trim()) {
    params.set("volume", String(query.volume));
  }
  if (query?.period?.trim()) {
    params.set("period", query.period.trim());
  }
  const qs = params.toString();
  return qs
    ? `/api/materials/market-intelligence/${materialId}/savings?${qs}`
    : `/api/materials/market-intelligence/${materialId}/savings`;
}

export function getMaterialMarketIntelligenceSuppliersApiPath(
  materialId: string,
  period?: string
): string {
  const base = `/api/materials/market-intelligence/${materialId}/suppliers`;
  if (!period) return base;
  return `${base}?period=${encodeURIComponent(period)}`;
}

export function getMaterialMarketIntelligencePriceHistoryApiPath(
  materialId: string,
  query?: { period?: string; dateFrom?: string; dateTo?: string }
): string {
  const base = `/api/materials/market-intelligence/${materialId}/price-history`;
  if (!query) return base;

  const params = new URLSearchParams();
  if (query.period?.trim()) params.set("period", query.period.trim());
  if (query.dateFrom?.trim()) params.set("dateFrom", query.dateFrom.trim());
  if (query.dateTo?.trim()) params.set("dateTo", query.dateTo.trim());

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function getMaterialMarketIntelligenceAnalyticsApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/analytics`;
}

export function getMaterialMarketIntelligenceSimulateApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/simulate`;
}

export function getMaterialMarketIntelligenceFinancialImpactApiPath(
  materialId: string,
  query?: { simulatedPrice?: number | string; baselinePrice?: number | string }
): string {
  const base = `/api/materials/market-intelligence/${materialId}/financial-impact`;
  if (!query) return base;
  const params = new URLSearchParams();
  if (query.simulatedPrice != null && String(query.simulatedPrice).trim()) {
    params.set("simulatedPrice", String(query.simulatedPrice));
  }
  if (query.baselinePrice != null && String(query.baselinePrice).trim()) {
    params.set("baselinePrice", String(query.baselinePrice));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function getMaterialMarketIntelligenceComparativeChartApiPath(
  materialId: string,
  query?: { period?: string }
): string {
  const base = `/api/materials/market-intelligence/${materialId}/comparative-chart`;
  if (!query?.period?.trim()) return base;
  const params = new URLSearchParams();
  params.set("period", query.period.trim());
  return `${base}?${params.toString()}`;
}

export function getMaterialMarketIntelligenceAlertsEvaluateApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/alerts/evaluate`;
}

export function getMaterialMarketIntelligenceImpactedProductsApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/impacted-products`;
}

export function getMaterialMarketIntelligenceDetailPath(materialId: string): string {
  return `${MATERIALS_SECTION_PATHS.marketIntelligence}/${materialId}`;
}

export const MATERIALS_DEFAULT_SECTION: MaterialsSectionId = "catalog";

export type MaterialsSectionDef = {
  id: MaterialsSectionId;
  label: string;
  path: string;
  description: string;
};

export const MATERIALS_SECTIONS: MaterialsSectionDef[] = [
  {
    id: "catalog",
    label: "Matérias-primas",
    path: MATERIALS_SECTION_PATHS.catalog,
    description: "Cadastro e gestão de matérias-primas, insumos e custos de aquisição.",
  },
  {
    id: "marketIntelligence",
    label: "Inteligência de Mercado",
    path: MATERIALS_SECTION_PATHS.marketIntelligence,
    description: "Monitoramento de matérias-primas e sinais de mercado para decisões de compra.",
  },
];

export function getMaterialsDefaultPath(): string {
  return MATERIALS_SECTION_PATHS[MATERIALS_DEFAULT_SECTION];
}

export function parseMaterialsSectionFromPath(pathname: string): MaterialsSectionId | null {
  if (pathname.includes("/materials/market-intelligence")) return "marketIntelligence";
  if (pathname === MATERIALS_BASE_PATH || pathname.startsWith(`${MATERIALS_BASE_PATH}/`)) {
    return "catalog";
  }
  return null;
}

export function isMaterialMarketIntelligenceDetailPath(pathname: string): boolean {
  return /^\/materials\/market-intelligence\/[^/]+$/.test(pathname);
}

export function parseMaterialIdFromMarketIntelligencePath(pathname: string): string | null {
  const match = pathname.match(/^\/materials\/market-intelligence\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function isMaterialsCanonicalPath(pathname: string): boolean {
  if (pathname === MATERIALS_BASE_PATH) return true;
  if (pathname === MATERIALS_SECTION_PATHS.marketIntelligence) return true;
  if (isMaterialMarketIntelligenceDetailPath(pathname)) return true;
  return false;
}

export function resolveMaterialsCanonicalPath(pathname: string): string {
  if (isMaterialMarketIntelligenceDetailPath(pathname)) return pathname;
  const section = parseMaterialsSectionFromPath(pathname);
  if (section === "marketIntelligence") return MATERIALS_SECTION_PATHS.marketIntelligence;
  return getMaterialsDefaultPath();
}
