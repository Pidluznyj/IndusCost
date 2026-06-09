/** Regras de elegibilidade de faturamento NF-e alinhadas ao Power BI. */

import { NomusNfeBillingClassification } from "@prisma/client";
import {
  NOMUS_NFE_CLIENT_ISSUED,
  NOMUS_NFE_PRODUCTION_ENV,
  NOMUS_NFE_SAIDA_TIPO_OPERACAO,
  NOMUS_NFE_STATUS_CANCELLED,
  NOMUS_NFE_XML_CUTOFF,
  NOMUS_NFE_XML_SAIDA_TPNF,
} from "@/src/lib/nomusNfeClassification.js";
import type { MappedNomusNfe } from "@/src/lib/nomusNfeMapper.js";

export type NfeDiscardReasonCode =
  | "sem_xml"
  | "xml_invalido"
  | "tpnf_nao_saida"
  | "data_xml_antes_corte"
  | "operacao_logistica"
  | "grupo_economico"
  | "cancelada"
  | "status_invalido"
  | "ambiente_nao_producao"
  | "fornecedor_entrada"
  | "tipo_operacao_entrada"
  | "outros";

export const NFE_DISCARD_REASON_LABELS: Record<NfeDiscardReasonCode, string> = {
  sem_xml: "Sem XML",
  xml_invalido: "XML inválido ou incompleto",
  tpnf_nao_saida: "tpNF != 1 no XML",
  data_xml_antes_corte: "dhEmi XML antes do corte",
  operacao_logistica: "Operação logística (não receita)",
  grupo_economico: "Destinatário do grupo econômico",
  cancelada: "NF cancelada",
  status_invalido: "Status inválido",
  ambiente_nao_producao: "Ambiente não produção",
  fornecedor_entrada: "NF de fornecedor/entrada",
  tipo_operacao_entrada: "tipoOperacao entrada",
  outros: "Outros",
};

const USEFUL_STATUSES = new Set([1, 2, NOMUS_NFE_STATUS_CANCELLED]);

export function normalizeNomusBooleanInt(value: unknown): number | null {
  if (value === true || value === "true" || value === "S" || value === "s") return 1;
  if (value === false || value === "false" || value === "N" || value === "n") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "1") return 1;
    if (trimmed === "0") return 0;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isXmlCriticallyInvalid(row: MappedNomusNfe): boolean {
  if (!row.xmlRaw?.trim()) return true;
  const alert = row.xmlQualityAlert ?? "";
  return (
    alert.includes("dhEmi ausente") ||
    alert.includes("tpNF ausente") ||
    alert.includes("XML ausente")
  );
}

/**
 * Motivo primário de descarte para contadores do preview (uma NF → um bucket).
 * `null` = elegível como MARKET_REVENUE com regra Power BI (base XML).
 */
export function evaluateNfeBillingDiscardReason(
  row: MappedNomusNfe,
  cutoffDate: Date = NOMUS_NFE_XML_CUTOFF
): NfeDiscardReasonCode | null {
  if (!row.xmlRaw?.trim()) return "sem_xml";
  if (isXmlCriticallyInvalid(row)) return "xml_invalido";

  if (row.status === NOMUS_NFE_STATUS_CANCELLED) return "cancelada";
  if (row.status != null && !USEFUL_STATUSES.has(row.status)) return "status_invalido";

  if (row.xmlDhEmi == null || row.xmlDhEmi < cutoffDate) return "data_xml_antes_corte";
  if (row.xmlTpNF !== NOMUS_NFE_XML_SAIDA_TPNF) return "tpnf_nao_saida";

  if (row.ambiente != null && row.ambiente !== NOMUS_NFE_PRODUCTION_ENV) {
    return "ambiente_nao_producao";
  }
  if (row.isFornecedor != null && row.isFornecedor !== NOMUS_NFE_CLIENT_ISSUED) {
    return "fornecedor_entrada";
  }
  if (row.tipoOperacao != null && row.tipoOperacao !== NOMUS_NFE_SAIDA_TIPO_OPERACAO) {
    return "tipo_operacao_entrada";
  }

  if (row.billingClassification === NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE) {
    return "operacao_logistica";
  }
  if (row.billingClassification === NomusNfeBillingClassification.INTERCOMPANY) {
    return "grupo_economico";
  }

  if (row.billingClassification !== NomusNfeBillingClassification.MARKET_REVENUE) {
    return "outros";
  }

  return null;
}

export function buildNfeDiscardCounts(
  rows: MappedNomusNfe[],
  cutoffDate: Date = NOMUS_NFE_XML_CUTOFF
): Record<NfeDiscardReasonCode, number> {
  const counts = Object.keys(NFE_DISCARD_REASON_LABELS).reduce(
    (acc, key) => {
      acc[key as NfeDiscardReasonCode] = 0;
      return acc;
    },
    {} as Record<NfeDiscardReasonCode, number>
  );

  for (const row of rows) {
    const reason = evaluateNfeBillingDiscardReason(row, cutoffDate);
    if (reason) counts[reason] += 1;
  }

  return counts;
}

export type MarketRevenueMonthBucket = {
  count: number;
  total: number;
};

function valorLiquidoNumber(row: MappedNomusNfe): number {
  if (row.valorLiquido == null) return 0;
  const n =
    typeof row.valorLiquido === "object" && "toNumber" in row.valorLiquido
      ? row.valorLiquido.toNumber()
      : Number(row.valorLiquido);
  return Number.isFinite(n) ? n : 0;
}

/** Totais mensais de MARKET_REVENUE com isMarketSale=true (regra Power BI). */
export function computeMarketRevenueMonthlyTotals(
  rows: MappedNomusNfe[]
): Record<string, MarketRevenueMonthBucket> {
  const buckets: Record<string, MarketRevenueMonthBucket> = {};

  for (const row of rows) {
    if (!row.isMarketSale) continue;
    if (row.billingClassification !== NomusNfeBillingClassification.MARKET_REVENUE) continue;
    if (!row.xmlDhEmi) continue;

    const key = `${row.xmlDhEmi.getFullYear()}-${String(row.xmlDhEmi.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets[key] ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += valorLiquidoNumber(row);
    buckets[key] = bucket;
  }

  for (const key of Object.keys(buckets)) {
    buckets[key]!.total = Math.round(buckets[key]!.total * 100) / 100;
    if (!Number.isFinite(buckets[key]!.total)) buckets[key]!.total = 0;
  }

  return buckets;
}

export function summarizeNfeBillingPreview(
  rows: MappedNomusNfe[],
  cutoffDate: Date = NOMUS_NFE_XML_CUTOFF
): {
  discardCounts: Record<NfeDiscardReasonCode, number>;
  marketRevenueEligible: number;
  marketRevenueByMonth: Record<string, MarketRevenueMonthBucket>;
  marketRevenueFlagMismatches: number;
} {
  const discardCounts = buildNfeDiscardCounts(rows, cutoffDate);
  const marketRevenueEligible = rows.filter(
    (row) => evaluateNfeBillingDiscardReason(row, cutoffDate) === null
  ).length;
  const marketRevenueByMonth = computeMarketRevenueMonthlyTotals(rows);
  const marketRevenueFlagMismatches = rows.filter(
    (row) =>
      row.billingClassification === NomusNfeBillingClassification.MARKET_REVENUE &&
      evaluateNfeBillingDiscardReason(row, cutoffDate) === null &&
      !row.isMarketSale
  ).length;

  return {
    discardCounts,
    marketRevenueEligible,
    marketRevenueByMonth,
    marketRevenueFlagMismatches,
  };
}
