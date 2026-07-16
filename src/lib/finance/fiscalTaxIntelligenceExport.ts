/**
 * Exportação XLSX — Inteligência tributária (T07).
 * Colunas incluem natureza da fonte (camadas A/B/C/D).
 */
import * as XLSX from "xlsx";
import {
  FISCAL_TAX_INTEL_COLUMN_SOURCES,
  FISCAL_TAX_INTEL_GROUP_BY_LABELS,
  type FiscalTaxIntelPayload,
} from "./fiscalTaxIntelligenceClient.js";

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function colHeader(
  key: keyof typeof FISCAL_TAX_INTEL_COLUMN_SOURCES
): string {
  const meta = FISCAL_TAX_INTEL_COLUMN_SOURCES[key];
  return `${meta.label} [${meta.source}]`;
}

export function buildFiscalTaxIntelligenceExportFilename(
  payload: FiscalTaxIntelPayload
): string {
  const start = payload.filters.periodStart.replace(/-/g, "");
  const end = payload.filters.periodEnd.replace(/-/g, "");
  return `inteligencia-tributaria_${start}_${end}_${payload.filters.groupBy}.xlsx`;
}

export function buildFiscalTaxIntelligenceExportWorkbook(
  payload: FiscalTaxIntelPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const k = payload.kpis;

  const resumo = [
    { Campo: "Relatório", Valor: "Inteligência tributária" },
    { Campo: "Gerado em", Valor: formatDateTimeBr(payload.generatedAt) },
    { Campo: "Aviso", Valor: payload.disclaimer },
    {
      Campo: "Agrupamento",
      Valor: FISCAL_TAX_INTEL_GROUP_BY_LABELS[payload.filters.groupBy],
    },
    { Campo: "Período início", Valor: payload.filters.periodStart },
    { Campo: "Período fim", Valor: payload.filters.periodEnd },
    {
      Campo: colHeader("highlightedAmount"),
      Valor: k.highlightedAmount,
    },
    { Campo: colHeader("creditsAmount"), Valor: k.creditsAmount },
    { Campo: colHeader("assessedAmount"), Valor: k.assessedAmount },
    { Campo: colHeader("amountDue"), Valor: k.amountDue },
    { Campo: colHeader("amountPaid"), Valor: k.amountPaid },
    { Campo: colHeader("interestAmount"), Valor: k.interestAmount },
    { Campo: colHeader("fineAmount"), Valor: k.fineAmount },
    { Campo: colHeader("guideBalanceDue"), Valor: k.guideBalanceDue },
    { Campo: colHeader("allocatedAmount"), Valor: k.allocatedAmount },
    { Campo: colHeader("revenueBase"), Valor: k.revenueBase },
    {
      Campo: colHeader("highlightedVsAssessed"),
      Valor: k.highlightedVsAssessed,
    },
    { Campo: colHeader("assessedVsPaid"), Valor: k.assessedVsPaid },
    {
      Campo: colHeader("fiscalLoadOnRevenue"),
      Valor: k.fiscalLoadOnRevenue ?? "",
    },
    { Campo: "Guias válidas", Valor: k.validGuideCount },
    { Campo: "Guias canceladas/estornadas", Valor: k.cancelledGuideCount },
    { Campo: "NFs válidas no período", Valor: k.nfeCount },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "KPIs");

  const fontes = Object.entries(FISCAL_TAX_INTEL_COLUMN_SOURCES).map(
    ([key, meta]) => ({
      Coluna: key,
      Rotulo: meta.label,
      Fonte: meta.source,
      Natureza: meta.nature,
    })
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fontes), "Fontes");

  const detail = payload.rows.map((r) => ({
    Agrupamento: r.groupLabel,
    Chave: r.groupKey,
    [colHeader("highlightedAmount")]: r.highlightedAmount,
    [colHeader("creditsAmount")]: r.creditsAmount,
    [colHeader("assessedAmount")]: r.assessedAmount,
    [colHeader("amountDue")]: r.amountDue,
    [colHeader("amountPaid")]: r.amountPaid,
    [colHeader("interestAmount")]: r.interestAmount,
    [colHeader("fineAmount")]: r.fineAmount,
    [colHeader("guideBalanceDue")]: r.guideBalanceDue,
    [colHeader("allocatedAmount")]: r.allocatedAmount,
    [colHeader("revenueBase")]: r.revenueBase,
    [colHeader("highlightedVsAssessed")]: r.highlightedVsAssessed,
    [colHeader("assessedVsPaid")]: r.assessedVsPaid,
    [colHeader("fiscalLoadOnRevenue")]: r.fiscalLoadOnRevenue ?? "",
    Tributo: r.taxType ?? "",
    Pedido: r.orderCode ?? "",
    "NF externalId": r.nfeExternalId ?? "",
    Guia: r.guideId ?? "",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      detail.length
        ? detail
        : [{ Agrupamento: "(sem linhas)", Chave: "" }]
    ),
    "Detalhe"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Filtro: "periodStart", Valor: payload.filters.periodStart },
      { Filtro: "periodEnd", Valor: payload.filters.periodEnd },
      { Filtro: "groupBy", Valor: payload.filters.groupBy },
      { Filtro: "taxType", Valor: payload.filters.taxType ?? "" },
      { Filtro: "jurisdiction", Valor: payload.filters.jurisdiction ?? "" },
      { Filtro: "guideStatus", Valor: payload.filters.guideStatus ?? "" },
      { Filtro: "customerId", Valor: payload.filters.customerId ?? "" },
      { Filtro: "salesOrderId", Valor: payload.filters.salesOrderId ?? "" },
    ]),
    "Filtros"
  );

  return wb;
}

export function buildFiscalTaxIntelligenceExportBuffer(
  payload: FiscalTaxIntelPayload
): Buffer {
  const wb = buildFiscalTaxIntelligenceExportWorkbook(payload);
  const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return Buffer.from(arr);
}
