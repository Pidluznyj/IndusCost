/**
 * Exportação Inteligência de Mercado — CSV / Excel / PDF.
 * Reutiliza fleetCsv + xlsx + minimalPdfWriter (padrão IndusCost).
 */
import * as XLSX from "xlsx";
import { fleetRowsToCsv } from "./fleetCsv.js";
import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import type { MonitoredMaterialListItem } from "./materialMarketIntelligenceMonitored.js";
import type { MaterialMarketAlertApiItem } from "./materialMarketAlert.js";
import type { MaterialMarketSupplierComparisonRow } from "./materialMarketSupplierComparison.js";
import type { MaterialMarketPriceHistoryPoint } from "./materialMarketPriceHistory.js";
import type { MaterialBomImpactItem } from "./materialBomImpact.types.js";
import type { MaterialMarketSimulationResponse } from "./materialMarketSimulation.js";
import type { MarketGlobalIndicatorsDto } from "./marketGlobalIndicators.js";
import { MATERIAL_MARKET_CRITICALITY_LABELS } from "./materialMarketMonitoring.js";
import {
  MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS,
  type MaterialMarketSupplierPeriod,
} from "./materialMarketSupplierComparison.js";

export const MATERIAL_MARKET_INTELLIGENCE_EXPORT_SCOPES = [
  "home",
  "history",
  "suppliers",
  "alerts",
  "simulations",
  "impacted-products",
  "reports",
] as const;

export type MaterialMarketIntelligenceExportScope =
  (typeof MATERIAL_MARKET_INTELLIGENCE_EXPORT_SCOPES)[number];

export const MATERIAL_MARKET_INTELLIGENCE_EXPORT_FORMATS = ["xlsx", "csv", "pdf"] as const;

export type MaterialMarketIntelligenceExportFormat =
  (typeof MATERIAL_MARKET_INTELLIGENCE_EXPORT_FORMATS)[number];

export const MATERIAL_MARKET_INTELLIGENCE_EXPORT_SCOPE_LABELS: Record<
  MaterialMarketIntelligenceExportScope,
  string
> = {
  home: "Home — materiais monitorados",
  history: "Histórico da matéria-prima",
  suppliers: "Fornecedores",
  alerts: "Alertas",
  simulations: "Simulações",
  "impacted-products": "Produtos impactados",
  reports: "Relatórios",
};

export const MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE =
  "Simulação não persistida — envie o último resultado no corpo da requisição (POST) ou execute a simulação na tela antes de exportar.";

export type MaterialMarketIntelligenceExportAppliedFilters = {
  q?: string | null;
  criticality?: string | null;
  materialId?: string | null;
  supplier?: string | null;
  group?: string | null;
  period?: string | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type MaterialMarketIntelligenceExportTable = {
  sheetName: string;
  headers: string[];
  rows: (string | number | null)[][];
};

export type MaterialMarketIntelligenceExportDocument = {
  scope: MaterialMarketIntelligenceExportScope;
  title: string;
  generatedAt: string;
  appliedFilters: Array<{ label: string; value: string }>;
  tables: MaterialMarketIntelligenceExportTable[];
  notes: string[];
};

export function isMaterialMarketIntelligenceExportScope(
  value: unknown
): value is MaterialMarketIntelligenceExportScope {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_INTELLIGENCE_EXPORT_SCOPES as readonly string[]).includes(value)
  );
}

export function isMaterialMarketIntelligenceExportFormat(
  value: unknown
): value is MaterialMarketIntelligenceExportFormat {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_INTELLIGENCE_EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketIntelligenceExportFormat(
  value: unknown
): MaterialMarketIntelligenceExportFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isMaterialMarketIntelligenceExportFormat(normalized) ? normalized : null;
}

export function parseMaterialMarketIntelligenceExportScope(
  value: unknown
): MaterialMarketIntelligenceExportScope | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isMaterialMarketIntelligenceExportScope(normalized) ? normalized : null;
}

function formatMoneyPtBr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatNumberPtBr(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 6,
  });
}

function formatPercentPtBr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}%`;
}

function formatDatePtBr(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTimePtBr(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

export function buildMaterialMarketIntelligenceExportAppliedFilterLines(
  filters: MaterialMarketIntelligenceExportAppliedFilters
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  if (filters.q?.trim()) lines.push({ label: "Busca", value: filters.q.trim() });
  if (filters.criticality?.trim()) {
    const key = filters.criticality.trim();
    const label =
      key in MATERIAL_MARKET_CRITICALITY_LABELS
        ? MATERIAL_MARKET_CRITICALITY_LABELS[
            key as keyof typeof MATERIAL_MARKET_CRITICALITY_LABELS
          ]
        : key;
    lines.push({ label: "Criticidade", value: label });
  }
  if (filters.materialId?.trim()) {
    lines.push({ label: "Material", value: filters.materialId.trim() });
  }
  if (filters.supplier?.trim()) lines.push({ label: "Fornecedor", value: filters.supplier.trim() });
  if (filters.group?.trim()) lines.push({ label: "Grupo/Família", value: filters.group.trim() });
  if (filters.period?.trim()) {
    const period = filters.period.trim();
    const periodLabel =
      period in MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS
        ? MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS[period as MaterialMarketSupplierPeriod]
        : period;
    lines.push({ label: "Período", value: periodLabel });
  }
  if (filters.status?.trim()) lines.push({ label: "Status", value: filters.status.trim() });
  if (filters.dateFrom?.trim()) lines.push({ label: "Data inicial", value: filters.dateFrom.trim() });
  if (filters.dateTo?.trim()) lines.push({ label: "Data final", value: filters.dateTo.trim() });
  return lines;
}

export function buildHomeExportRows(
  items: MonitoredMaterialListItem[],
  filters: MaterialMarketIntelligenceExportAppliedFilters = {}
): MaterialMarketIntelligenceExportTable {
  const q = (filters.q ?? "").trim().toLowerCase();
  const criticality = (filters.criticality ?? "").trim();
  const group = (filters.group ?? "").trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (criticality && item.marketCriticality !== criticality) return false;
    if (group && item.familyCode.toLowerCase() !== group && item.family.toLowerCase() !== group) {
      return false;
    }
    if (q) {
      const hay = `${item.code} ${item.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    sheetName: "Monitoradas",
    headers: [
      "Código",
      "Descrição",
      "Família",
      "Unidade",
      "Criticidade",
      "Situação",
      "Última cotação (R$)",
      "Data última cotação",
      "Cotação oficial (R$)",
      "Fornecedor oficial",
    ],
    rows: filtered.map((item) => [
      item.code,
      item.description,
      item.family,
      item.unit,
      MATERIAL_MARKET_CRITICALITY_LABELS[item.marketCriticality] ?? item.marketCriticality,
      item.marketSituation.statusLabel,
      item.lastQuoteAmount != null ? formatMoneyPtBr(item.lastQuoteAmount) : "—",
      formatDatePtBr(item.lastQuoteDate),
      item.officialQuote?.priceBrl != null ? formatMoneyPtBr(item.officialQuote.priceBrl) : "—",
      item.officialQuote?.supplierName ?? "—",
    ]),
  };
}

export function buildGlobalIndicatorsExportRows(
  indicators: MarketGlobalIndicatorsDto | null
): MaterialMarketIntelligenceExportTable {
  const rows: (string | number | null)[][] = [];
  if (indicators?.ptax) {
    rows.push([
      "PTAX",
      formatNumberPtBr(indicators.ptax.sellRate, 4),
      "BRL/USD",
      indicators.ptax.source,
      formatDateTimePtBr(indicators.ptax.lastUpdate),
    ]);
  }
  if (indicators?.brent) {
    rows.push([
      "Brent",
      formatNumberPtBr(indicators.brent.price, 2),
      `${indicators.brent.currency}/${indicators.brent.unit}`,
      indicators.brent.source,
      formatDateTimePtBr(indicators.brent.lastUpdate),
    ]);
  }
  if (rows.length === 0) {
    rows.push(["—", "—", "—", "Sem indicadores disponíveis", "—"]);
  }
  return {
    sheetName: "Indicadores",
    headers: ["Indicador", "Valor", "Unidade", "Fonte", "Atualizado em"],
    rows,
  };
}

export function buildHistoryExportRows(
  points: MaterialMarketPriceHistoryPoint[],
  filters: MaterialMarketIntelligenceExportAppliedFilters = {}
): MaterialMarketIntelligenceExportTable {
  const supplier = (filters.supplier ?? "").trim().toLowerCase();
  const filtered = points.filter((point) => {
    if (!supplier) return true;
    return (point.supplierName ?? "").toLowerCase().includes(supplier);
  });

  return {
    sheetName: "Histórico",
    headers: [
      "Data",
      "Fornecedor",
      "Moeda original",
      "Preço original",
      "Preço BRL",
      "Taxa câmbio",
      "Observações",
    ],
    rows: filtered.map((point) => [
      point.dateLabel || formatDatePtBr(point.date),
      point.supplierName ?? "—",
      point.originalCurrency,
      formatNumberPtBr(point.originalPrice),
      formatMoneyPtBr(point.priceBRL),
      point.exchangeRateUsed != null ? formatNumberPtBr(point.exchangeRateUsed, 4) : "—",
      point.notes ?? "",
    ]),
  };
}

export function buildSuppliersExportRows(
  items: MaterialMarketSupplierComparisonRow[],
  filters: MaterialMarketIntelligenceExportAppliedFilters = {}
): MaterialMarketIntelligenceExportTable {
  const supplier = (filters.supplier ?? "").trim().toLowerCase();
  const filtered = items.filter((row) => {
    if (!supplier) return true;
    return row.supplierName.toLowerCase().includes(supplier);
  });

  return {
    sheetName: "Fornecedores",
    headers: [
      "Rank",
      "Fornecedor",
      "Último preço (R$)",
      "Preço médio (R$)",
      "Mínimo (R$)",
      "Máximo (R$)",
      "Qtd cotações",
      "Frequência melhor preço",
      "Variação período",
      "Condição comercial",
      "Última cotação",
      "Desatualizado",
    ],
    rows: filtered.map((row) => [
      row.rank,
      row.supplierName,
      formatMoneyPtBr(row.lastPrice),
      formatMoneyPtBr(row.averagePrice),
      formatMoneyPtBr(row.minPrice),
      formatMoneyPtBr(row.maxPrice),
      row.quoteCount,
      formatPercentPtBr(row.bestPriceFrequency),
      formatPercentPtBr(row.periodVariation),
      row.mostCommonCommercialCondition ?? row.averagePaymentTerms ?? "—",
      formatDatePtBr(row.lastQuoteDate),
      row.isStale ? "Sim" : "Não",
    ]),
  };
}

export function buildAlertsExportRows(
  items: MaterialMarketAlertApiItem[],
  filters: MaterialMarketIntelligenceExportAppliedFilters = {}
): MaterialMarketIntelligenceExportTable {
  const status = (filters.status ?? "").trim().toUpperCase();
  const criticalityOrSeverity = (filters.criticality ?? "").trim().toUpperCase();
  const materialId = (filters.materialId ?? "").trim();
  const q = (filters.q ?? "").trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (status && status !== "ALL" && item.status !== status) return false;
    if (criticalityOrSeverity && item.severity !== criticalityOrSeverity) return false;
    if (materialId && item.materialId !== materialId) return false;
    if (q) {
      const hay =
        `${item.materialCode ?? ""} ${item.materialDescription ?? ""} ${item.title} ${item.message}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    sheetName: "Alertas",
    headers: [
      "Código MP",
      "Matéria-prima",
      "Tipo",
      "Severidade",
      "Status",
      "Título",
      "Mensagem",
      "Disparado em",
    ],
    rows: filtered.map((item) => [
      item.materialCode ?? "—",
      item.materialDescription ?? "—",
      item.alertTypeLabel,
      item.severityLabel,
      item.statusLabel,
      item.title,
      item.message,
      formatDateTimePtBr(item.triggeredAt),
    ]),
  };
}

export function buildImpactedProductsExportRows(
  items: MaterialBomImpactItem[]
): MaterialMarketIntelligenceExportTable {
  return {
    sheetName: "Produtos impactados",
    headers: [
      "SKU",
      "Produto",
      "Quantidade consumida",
      "Unidade",
      "Custo estimado atual (R$)",
      "Impacto potencial (R$)",
    ],
    rows: items.map((item) => [
      item.productSku,
      item.productName,
      formatNumberPtBr(item.quantityConsumed),
      item.unit,
      formatMoneyPtBr(item.estimatedCurrentCost),
      item.potentialImpact != null ? formatMoneyPtBr(item.potentialImpact) : "—",
    ]),
  };
}

export function buildSimulationsExportTables(
  result: MaterialMarketSimulationResponse | null
): { tables: MaterialMarketIntelligenceExportTable[]; notes: string[] } {
  if (!result) {
    return {
      tables: [
        {
          sheetName: "Simulação",
          headers: ["Observação"],
          rows: [[MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE]],
        },
      ],
      notes: [MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE],
    };
  }

  const summary: MaterialMarketIntelligenceExportTable = {
    sheetName: "Resumo",
    headers: ["Campo", "Valor"],
    rows: [
      ["Rótulo", result.simulationLabel],
      ["Preço atual (R$)", formatMoneyPtBr(result.currentPrice)],
      ["Preço simulado (R$)", formatMoneyPtBr(result.simulatedPrice)],
      ["Produtos impactados", result.marginSummary.impactedProductCount],
      ["Produtos críticos", result.marginSummary.criticalProductCount],
      ["Margem média anterior", formatPercentPtBr(result.marginSummary.avgPreviousMargin)],
      ["Margem média simulada", formatPercentPtBr(result.marginSummary.avgSimulatedMargin)],
      ["Delta margem médio", formatPercentPtBr(result.marginSummary.avgMarginDelta)],
      ["Aviso", result.disclaimer],
    ],
  };

  const products: MaterialMarketIntelligenceExportTable = {
    sheetName: "Produtos",
    headers: [
      "SKU",
      "Produto",
      "Qtd BOM",
      "Custo anterior (R$)",
      "Custo simulado (R$)",
      "Delta custo (R$)",
      "Delta custo %",
      "Preço venda (R$)",
      "Margem anterior",
      "Margem simulada",
      "Delta margem",
      "Crítico",
      "Motivo",
    ],
    rows: result.productImpacts.map((row) => [
      row.sku,
      row.productName,
      formatNumberPtBr(row.bomQuantity),
      row.previousCost != null ? formatMoneyPtBr(row.previousCost) : "—",
      row.simulatedCost != null ? formatMoneyPtBr(row.simulatedCost) : "—",
      row.costDifferenceBRL != null ? formatMoneyPtBr(row.costDifferenceBRL) : "—",
      formatPercentPtBr(row.costDifferencePct),
      row.sellingPrice != null ? formatMoneyPtBr(row.sellingPrice) : "—",
      formatPercentPtBr(row.previousMargin),
      formatPercentPtBr(row.simulatedMargin),
      formatPercentPtBr(row.marginDelta),
      row.isCritical ? "Sim" : "Não",
      row.criticalReason ?? "",
    ]),
  };

  return { tables: [summary, products], notes: [result.disclaimer] };
}

export function buildReportsExportTables(input: {
  monitored: MonitoredMaterialListItem[];
  alerts: MaterialMarketAlertApiItem[];
  indicators: MarketGlobalIndicatorsDto | null;
  filters?: MaterialMarketIntelligenceExportAppliedFilters;
}): MaterialMarketIntelligenceExportTable[] {
  const filters = input.filters ?? {};
  return [
    buildGlobalIndicatorsExportRows(input.indicators),
    buildHomeExportRows(input.monitored, filters),
    buildAlertsExportRows(input.alerts, {
      ...filters,
      status: filters.status ?? "OPEN",
    }),
  ];
}

export function buildMaterialMarketIntelligenceExportDocument(input: {
  scope: MaterialMarketIntelligenceExportScope;
  generatedAt?: string;
  filters?: MaterialMarketIntelligenceExportAppliedFilters;
  tables: MaterialMarketIntelligenceExportTable[];
  notes?: string[];
}): MaterialMarketIntelligenceExportDocument {
  return {
    scope: input.scope,
    title: `Inteligência de Mercado — ${MATERIAL_MARKET_INTELLIGENCE_EXPORT_SCOPE_LABELS[input.scope]}`,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appliedFilters: buildMaterialMarketIntelligenceExportAppliedFilterLines(input.filters ?? {}),
    tables: input.tables,
    notes: input.notes ?? [],
  };
}

export function materialMarketIntelligenceExportFilename(
  scope: MaterialMarketIntelligenceExportScope,
  format: MaterialMarketIntelligenceExportFormat,
  generatedAt = new Date()
): string {
  const stamp = generatedAt.toISOString().slice(0, 10);
  return `inteligencia-mercado-${scope}-${stamp}.${format}`;
}

export function buildMaterialMarketIntelligenceExportCsv(
  doc: MaterialMarketIntelligenceExportDocument
): string {
  const chunks: string[] = [];
  for (const table of doc.tables) {
    chunks.push(fleetRowsToCsv(table.headers, table.rows));
  }
  if (doc.notes.length > 0) {
    chunks.push(fleetRowsToCsv(["Notas"], doc.notes.map((n) => [n])));
  }
  return chunks.join("\n\n");
}

export function buildMaterialMarketIntelligenceExportXlsx(
  doc: MaterialMarketIntelligenceExportDocument
): Uint8Array {
  const wb = XLSX.utils.book_new();

  const metaRows = [
    ["Título", doc.title],
    ["Escopo", doc.scope],
    ["Gerado em", formatDateTimePtBr(doc.generatedAt)],
    ...doc.appliedFilters.map((f) => [`Filtro: ${f.label}`, f.value]),
    ...doc.notes.map((n, i) => [`Nota ${i + 1}`, n]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), "Filtros");

  for (const table of doc.tables) {
    const aoa = [table.headers, ...table.rows.map((row) => row.map((cell) => cell ?? ""))];
    const sheetName = table.sheetName.slice(0, 31) || "Dados";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }

  const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function buildMaterialMarketIntelligenceExportPdf(
  doc: MaterialMarketIntelligenceExportDocument
): Buffer {
  const lines: string[] = [`Gerado em: ${formatDateTimePtBr(doc.generatedAt)}`, ""];

  if (doc.appliedFilters.length > 0) {
    lines.push("Filtros aplicados:");
    for (const filter of doc.appliedFilters) {
      lines.push(`- ${filter.label}: ${filter.value}`);
    }
    lines.push("");
  }

  for (const table of doc.tables) {
    lines.push(table.sheetName);
    lines.push(table.headers.join(" | "));
    for (const row of table.rows.slice(0, 80)) {
      lines.push(row.map((cell) => (cell == null ? "" : String(cell))).join(" | "));
    }
    if (table.rows.length > 80) {
      lines.push(`... (${table.rows.length - 80} linhas adicionais omitidas no PDF)`);
    }
    lines.push("");
  }

  for (const note of doc.notes) {
    lines.push(`Nota: ${note}`);
  }

  return buildMinimalPdfDocument({
    title: pdfSafeText(doc.title),
    lines: lines.map((line) => pdfSafeText(line)),
  });
}

export function renderMaterialMarketIntelligenceExport(
  doc: MaterialMarketIntelligenceExportDocument,
  format: MaterialMarketIntelligenceExportFormat
): { body: Buffer | string | Uint8Array; contentType: string; filename: string } {
  const filename = materialMarketIntelligenceExportFilename(doc.scope, format);
  if (format === "csv") {
    return {
      body: buildMaterialMarketIntelligenceExportCsv(doc),
      contentType: "text/csv; charset=utf-8",
      filename,
    };
  }
  if (format === "xlsx") {
    return {
      body: buildMaterialMarketIntelligenceExportXlsx(doc),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
    };
  }
  return {
    body: buildMaterialMarketIntelligenceExportPdf(doc),
    contentType: "application/pdf",
    filename,
  };
}

export function buildMaterialMarketIntelligenceExportQueryString(params: {
  scope: MaterialMarketIntelligenceExportScope;
  format: MaterialMarketIntelligenceExportFormat;
  filters?: MaterialMarketIntelligenceExportAppliedFilters;
}): string {
  const qs = new URLSearchParams();
  qs.set("scope", params.scope);
  qs.set("format", params.format);
  const filters = params.filters ?? {};
  if (filters.q?.trim()) qs.set("q", filters.q.trim());
  if (filters.criticality?.trim()) qs.set("criticality", filters.criticality.trim());
  if (filters.materialId?.trim()) qs.set("materialId", filters.materialId.trim());
  if (filters.supplier?.trim()) qs.set("supplier", filters.supplier.trim());
  if (filters.group?.trim()) qs.set("group", filters.group.trim());
  if (filters.period?.trim()) qs.set("period", filters.period.trim());
  if (filters.status?.trim()) qs.set("status", filters.status.trim());
  if (filters.dateFrom?.trim()) qs.set("dateFrom", filters.dateFrom.trim());
  if (filters.dateTo?.trim()) qs.set("dateTo", filters.dateTo.trim());
  return qs.toString();
}

export const MATERIALS_MARKET_INTELLIGENCE_EXPORT_API =
  "/api/materials/market-intelligence/export" as const;
