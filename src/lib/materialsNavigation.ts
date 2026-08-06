/**
 * Rotas e seções do módulo Suprimentos (materials).
 */

export const MATERIALS_BASE_PATH = "/materials" as const;

export const MATERIALS_SECTION_IDS = [
  "catalog",
  "stockConference",
  "marketIntelligence",
  "planning",
] as const;

export type MaterialsSectionId = (typeof MATERIALS_SECTION_IDS)[number];

export const MATERIALS_SECTION_PATHS: Record<MaterialsSectionId, string> = {
  catalog: MATERIALS_BASE_PATH,
  stockConference: `${MATERIALS_BASE_PATH}/stock-conference`,
  marketIntelligence: `${MATERIALS_BASE_PATH}/market-intelligence`,
  planning: `${MATERIALS_BASE_PATH}/planning`,
};

export const MATERIALS_PLANNING_API = "/api/materials/planning" as const;

export function getMaterialsPlanningApiPath(query?: Record<string, string | undefined>): string {
  if (!query) return MATERIALS_PLANNING_API;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.trim()) params.set(key, value.trim());
  }
  const qs = params.toString();
  return qs ? `${MATERIALS_PLANNING_API}?${qs}` : MATERIALS_PLANNING_API;
}

export function getMaterialsPlanningDetailApiPath(
  materialId: string,
  query?: Record<string, string | undefined>
): string {
  const base = `${MATERIALS_PLANNING_API}/${encodeURIComponent(materialId)}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.trim()) params.set(key, value.trim());
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function getMaterialsPlanningExportApiPath(query?: Record<string, string | undefined>): string {
  const base = `${MATERIALS_PLANNING_API}/export.csv`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.trim()) params.set(key, value.trim());
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export const MATERIALS_MARKET_INTELLIGENCE_MONITORED_API =
  "/api/materials/market-intelligence/monitored" as const;

export const MATERIALS_MARKET_GLOBAL_INDICATORS_API =
  "/api/market-intelligence/global-indicators" as const;

export const MATERIALS_MARKET_INTELLIGENCE_OPPORTUNITIES_API =
  "/api/materials/market-intelligence/opportunities" as const;

export const MATERIALS_MARKET_INTELLIGENCE_ALERTS_API =
  "/api/materials/market-intelligence/alerts" as const;

export const MATERIALS_MARKET_INTELLIGENCE_REPORTS_PATH =
  `${MATERIALS_SECTION_PATHS.marketIntelligence}/reports` as const;

export const MATERIALS_MARKET_INTELLIGENCE_REPORTS_API =
  "/api/materials/market-intelligence/reports" as const;

export function getMaterialMarketIntelligenceReportsApiPath(query?: {
  materialId?: string;
  supplier?: string;
  category?: string;
  family?: string;
  group?: string;
  period?: string;
  criticality?: string;
  situation?: string;
  status?: string;
  alertStatus?: string;
  reportType?: string;
  type?: string;
}): string {
  if (!query) return MATERIALS_MARKET_INTELLIGENCE_REPORTS_API;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim()) params.set(key, String(value).trim());
  }
  const qs = params.toString();
  return qs ? `${MATERIALS_MARKET_INTELLIGENCE_REPORTS_API}?${qs}` : MATERIALS_MARKET_INTELLIGENCE_REPORTS_API;
}

export const MATERIALS_MARKET_INTELLIGENCE_EXPORT_API =
  "/api/materials/market-intelligence/export" as const;

export function getMaterialMarketIntelligenceExportApiPath(query?: {
  scope?: string;
  format?: string;
  q?: string;
  criticality?: string;
  materialId?: string;
  supplier?: string;
  group?: string;
  period?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}): string {
  if (!query) return MATERIALS_MARKET_INTELLIGENCE_EXPORT_API;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim()) params.set(key, String(value).trim());
  }
  const qs = params.toString();
  return qs ? `${MATERIALS_MARKET_INTELLIGENCE_EXPORT_API}?${qs}` : MATERIALS_MARKET_INTELLIGENCE_EXPORT_API;
}

export const MATERIAL_MARKET_ALERT_GLOBAL_CONFIG_API =
  "/api/market-intelligence/alert-config/global" as const;

export const MATERIAL_MARKET_ALERT_CONFIG_AUDIT_API =
  "/api/market-intelligence/alert-config/audit" as const;

export const BRENT_COMMODITY_LATEST_API =
  "/api/market-intelligence/commodities/brent/latest" as const;

export const BRENT_COMMODITY_COLLECT_API =
  "/api/market-intelligence/commodities/brent/collect" as const;

export const PTAX_SNAPSHOT_LATEST_API = "/api/market-intelligence/ptax/latest" as const;

export const PTAX_SNAPSHOT_COLLECT_API = "/api/market-intelligence/ptax/collect" as const;

export function getMaterialMarketIntelligenceAlertsApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/alerts`;
}

export function getMaterialMarketIntelligenceDetailApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}`;
}

export function getMaterialMarketAlertConfigApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/alert-config`;
}

export function getMaterialMarketIntelligenceQuotesApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/quotes`;
}

export function getMaterialMarketQuoteApiPath(materialId: string, quoteId: string): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}`;
}

export function getMaterialMarketIntelligenceAuditApiPath(
  materialId: string,
  query?: { limit?: number | string; offset?: number | string }
): string {
  const base = `/api/materials/market-intelligence/${materialId}/audit`;
  if (!query) return base;
  const params = new URLSearchParams();
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function getMaterialMarketQuoteAttachmentsApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/attachments`;
}

export function getMaterialMarketQuoteReliabilityApiPath(
  materialId: string,
  quoteId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/reliability`;
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

export function getMaterialMarketIntelligencePurchaseLinksApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/purchase-links`;
}

export function getMaterialMarketIntelligenceTimelineApiPath(materialId: string): string {
  return `/api/materials/market-intelligence/${materialId}/timeline`;
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
    id: "stockConference",
    label: "Conferência de estoque",
    path: MATERIALS_SECTION_PATHS.stockConference,
    description:
      "Operação de conferência física do estoque atual de matérias-primas (sem custos).",
  },
  {
    id: "marketIntelligence",
    label: "Inteligência de Mercado",
    path: MATERIALS_SECTION_PATHS.marketIntelligence,
    description: "Monitoramento de matérias-primas e sinais de mercado para decisões de compra.",
  },
  {
    id: "planning",
    label: "Planejamento de Matéria-Prima",
    path: MATERIALS_SECTION_PATHS.planning,
    description:
      "Cruza saldo de estoque, proteção mínima/contingência, demanda de pedidos e entradas de compra confirmadas para indicar o que comprar, quanto e até quando.",
  },
];

export function getMaterialStockConferenceDetailPath(materialId: string): string {
  return `${MATERIALS_SECTION_PATHS.stockConference}/${materialId}`;
}

export function isMaterialStockConferenceDetailPath(pathname: string): boolean {
  return /^\/materials\/stock-conference\/[^/]+$/.test(pathname);
}

export function parseMaterialIdFromStockConferencePath(pathname: string): string | null {
  const match = pathname.match(/^\/materials\/stock-conference\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function getMaterialsDefaultPath(): string {
  return MATERIALS_SECTION_PATHS[MATERIALS_DEFAULT_SECTION];
}

export function parseMaterialsSectionFromPath(pathname: string): MaterialsSectionId | null {
  if (pathname.includes("/materials/stock-conference")) return "stockConference";
  if (pathname.includes("/materials/market-intelligence")) return "marketIntelligence";
  if (pathname.includes("/materials/planning")) return "planning";
  if (pathname === MATERIALS_BASE_PATH || pathname.startsWith(`${MATERIALS_BASE_PATH}/`)) {
    return "catalog";
  }
  return null;
}

export function isMaterialMarketIntelligenceReportsPath(pathname: string): boolean {
  return pathname === MATERIALS_MARKET_INTELLIGENCE_REPORTS_PATH;
}

export function isMaterialMarketIntelligenceDetailPath(pathname: string): boolean {
  if (isMaterialMarketIntelligenceReportsPath(pathname)) return false;
  return /^\/materials\/market-intelligence\/[^/]+$/.test(pathname);
}

export function parseMaterialIdFromMarketIntelligencePath(pathname: string): string | null {
  if (isMaterialMarketIntelligenceReportsPath(pathname)) return null;
  const match = pathname.match(/^\/materials\/market-intelligence\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function isMaterialsCanonicalPath(pathname: string): boolean {
  if (pathname === MATERIALS_BASE_PATH) return true;
  if (pathname === MATERIALS_SECTION_PATHS.stockConference) return true;
  if (isMaterialStockConferenceDetailPath(pathname)) return true;
  if (pathname === MATERIALS_SECTION_PATHS.marketIntelligence) return true;
  if (isMaterialMarketIntelligenceReportsPath(pathname)) return true;
  if (isMaterialMarketIntelligenceDetailPath(pathname)) return true;
  if (pathname === MATERIALS_SECTION_PATHS.planning) return true;
  return false;
}

export function resolveMaterialsCanonicalPath(pathname: string): string {
  if (isMaterialMarketIntelligenceReportsPath(pathname)) return pathname;
  if (isMaterialMarketIntelligenceDetailPath(pathname)) return pathname;
  if (isMaterialStockConferenceDetailPath(pathname)) return pathname;
  const section = parseMaterialsSectionFromPath(pathname);
  if (section === "stockConference") return MATERIALS_SECTION_PATHS.stockConference;
  if (section === "marketIntelligence") return MATERIALS_SECTION_PATHS.marketIntelligence;
  if (section === "planning") return MATERIALS_SECTION_PATHS.planning;
  return getMaterialsDefaultPath();
}
