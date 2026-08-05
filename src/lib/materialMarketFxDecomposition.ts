/**
 * Decomposição da variação de preço BRL em componente cambial (PTAX) vs preço/fornecedor.
 *
 * Metodologia (cotações em USD):
 * - brlVariationPct: variação percentual do preço convertido em BRL (netPrice × PTAX venda).
 * - exchangeVariationPct: variação percentual da taxa PTAX usada em cada cotação.
 * - originalPriceVariationPct: variação percentual do preço na moeda original (USD).
 * - unexplainedVariationPct: residual multiplicativo não explicado só pelo câmbio:
 *     (1 + brl%/100) / (1 + fx%/100) − 1, em percentual.
 *   Aproxima o quanto do movimento em BRL veio de preço/fornecedor, isolando o efeito do dólar.
 *
 * Cotações em BRL:
 * - exchangeVariationPct = 0; unexplainedVariationPct = brlVariationPct (tudo é preço/fornecedor).
 *
 * Dados insuficientes: menos de 2 cotações comparáveis, moedas mistas, ou USD sem PTAX nas duas datas.
 */

import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import {
  computeMaterialQuotePriceBRL,
  UNKNOWN_SUPPLIER_KEY,
  type MaterialMarketPriceHistoryPoint,
} from "./materialMarketPriceHistory.js";
import {
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS,
  parseMaterialMarketQuoteAnalyticsPeriod,
  type MaterialMarketQuoteAnalyticsPeriod,
} from "./materialMarketQuoteAnalytics.js";
import { formatMaterialIntelligenceQuoteDate } from "./materialIntelligence360Sections.js";
import { resolveSupplierKey } from "./materialMarketSupplierComparison.js";

export type MaterialMarketFxDecompositionQuoteRef = {
  quoteDate: string;
  quoteDateLabel: string;
  originalCurrency: string;
  originalPrice: number;
  priceBRL: number;
  exchangeRateUsed: number | null;
};

export type MaterialMarketFxDecompositionResult = {
  hasSufficientData: boolean;
  materialName: string;
  periodLabel: string;
  brlVariationPct: number | null;
  originalPriceVariationPct: number | null;
  exchangeVariationPct: number | null;
  unexplainedVariationPct: number | null;
  explanation: string;
  calculationBasis: string;
  fromQuote: MaterialMarketFxDecompositionQuoteRef | null;
  toQuote: MaterialMarketFxDecompositionQuoteRef | null;
};

export type MaterialMarketFxDecompositionPeriod =
  | MaterialMarketQuoteAnalyticsPeriod
  | "latest";

const PERIOD_DAYS: Record<Exclude<MaterialMarketQuoteAnalyticsPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const INSUFFICIENT_EXPLANATION = "Dados insuficientes para análise.";
const INSUFFICIENT_BASIS =
  "São necessárias pelo menos duas cotações na mesma moeda; cotações em USD exigem PTAX venda nas duas datas.";

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toDate(value: string | Date): Date {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function computePercentVariation(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const percent = ((current - previous) / previous) * 100;
  return Number.isFinite(percent) ? roundPercent(percent) : null;
}

/**
 * Componente de preço/fornecedor em BRL, isolando o efeito multiplicativo do câmbio.
 * unexplained = (1 + brl%) / (1 + fx%) − 1
 */
export function computeUnexplainedBrlVariationPct(
  brlVariationPct: number,
  exchangeVariationPct: number
): number {
  const brlFactor = 1 + brlVariationPct / 100;
  const fxFactor = 1 + exchangeVariationPct / 100;
  if (!Number.isFinite(brlFactor) || !Number.isFinite(fxFactor) || fxFactor === 0) {
    return 0;
  }
  return roundPercent((brlFactor / fxFactor - 1) * 100);
}

function formatSignedPercent(value: number): string {
  const abs = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  if (value > 0) return `subiu ${abs}%`;
  if (value < 0) return `caiu ${abs}%`;
  return "permaneceu estável";
}

export function buildFxDecompositionExplanation(input: {
  materialName: string;
  brlVariationPct: number;
  exchangeVariationPct: number;
  unexplainedVariationPct: number;
  currency: string;
}): string {
  const name = input.materialName.trim() || "O material";
  const brlText = formatSignedPercent(input.brlVariationPct);
  const currency = input.currency.toUpperCase();

  if (currency === "BRL") {
    return `${name} ${brlText} em BRL. Toda a variação é atribuída a preço/fornecedor (sem efeito cambial).`;
  }

  const fxText = formatSignedPercent(input.exchangeVariationPct);
  const unexplainedAbs = Math.abs(input.unexplainedVariationPct).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  const direction =
    input.unexplainedVariationPct > 0
      ? "subiu"
      : input.unexplainedVariationPct < 0
        ? "caiu"
        : "permaneceu estável em";

  if (input.unexplainedVariationPct === 0) {
    return `${name} ${brlText} em BRL, enquanto o dólar ${fxText}. A variação em BRL é explicada pelo câmbio.`;
  }

  return `${name} ${brlText} em BRL, enquanto o dólar ${fxText}. A variação não explicada pelo câmbio ${direction} aproximadamente ${unexplainedAbs}%.`;
}

export function buildFxDecompositionCalculationBasis(input: {
  fromQuote: MaterialMarketFxDecompositionQuoteRef;
  toQuote: MaterialMarketFxDecompositionQuoteRef;
  brlVariationPct: number;
  originalPriceVariationPct: number;
  exchangeVariationPct: number;
  unexplainedVariationPct: number;
}): string {
  const lines = [
    `De ${input.fromQuote.quoteDateLabel} para ${input.toQuote.quoteDateLabel}:`,
    `Preço BRL: ${input.fromQuote.priceBRL.toLocaleString("pt-BR")} → ${input.toQuote.priceBRL.toLocaleString("pt-BR")} (${input.brlVariationPct >= 0 ? "+" : ""}${input.brlVariationPct}%)`,
    `Preço original (${input.fromQuote.originalCurrency}): ${input.fromQuote.originalPrice.toLocaleString("pt-BR")} → ${input.toQuote.originalPrice.toLocaleString("pt-BR")} (${input.originalPriceVariationPct >= 0 ? "+" : ""}${input.originalPriceVariationPct}%)`,
  ];

  if (input.fromQuote.originalCurrency === "USD") {
    const fromRate = input.fromQuote.exchangeRateUsed ?? "—";
    const toRate = input.toQuote.exchangeRateUsed ?? "—";
    lines.push(
      `PTAX venda: ${fromRate} → ${toRate} (${input.exchangeVariationPct >= 0 ? "+" : ""}${input.exchangeVariationPct}%)`
    );
    lines.push(
      `Componente preço/fornecedor (multiplicativo): ${input.unexplainedVariationPct >= 0 ? "+" : ""}${input.unexplainedVariationPct}%`
    );
    lines.push("Fórmula: (1 + var.BRL%) / (1 + var.PTAX%) − 1");
  } else {
    lines.push("Moeda BRL: sem conversão cambial.");
  }

  return lines.join("\n");
}

function mapQuoteToRef(point: MaterialMarketPriceHistoryPoint): MaterialMarketFxDecompositionQuoteRef {
  return {
    quoteDate: point.date,
    quoteDateLabel: point.dateLabel,
    originalCurrency: point.originalCurrency,
    originalPrice: point.originalPrice,
    priceBRL: point.priceBRL,
    exchangeRateUsed: point.exchangeRateUsed,
  };
}

function sortQuotesChronologicallyDesc(rows: MaterialMarketQuoteSourceRow[]): MaterialMarketQuoteSourceRow[] {
  return [...rows].sort((a, b) => {
    const dateDiff = toDate(b.quoteDate).getTime() - toDate(a.quoteDate).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function findQuoteNearestDaysAgo(
  pointsDesc: MaterialMarketPriceHistoryPoint[],
  daysAgo: number
): MaterialMarketPriceHistoryPoint | null {
  if (pointsDesc.length < 2) return null;

  const reference = toDate(pointsDesc[0].date);
  const targetMs = reference.getTime() - daysAgo * 24 * 60 * 60 * 1000;

  let best: MaterialMarketPriceHistoryPoint | null = null;
  let bestDiff = Infinity;

  for (const candidate of pointsDesc.slice(1)) {
    const diff = Math.abs(toDate(candidate.date).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return best;
}

export function parseMaterialMarketFxDecompositionPeriod(
  value: unknown
): MaterialMarketFxDecompositionPeriod {
  if (value == null || value === "" || value === "latest") return "latest";
  return parseMaterialMarketQuoteAnalyticsPeriod(value);
}

export function resolveFxDecompositionPeriodLabel(
  period: MaterialMarketFxDecompositionPeriod
): string {
  if (period === "latest") return "Últimas duas cotações";
  return MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period];
}

function mapRowToPoint(
  row: MaterialMarketQuoteSourceRow,
  exchangeRatesByDate: Map<string, number | null>
): MaterialMarketPriceHistoryPoint | null {
  if (row.status === "CANCELLED") return null;

  const date = toIsoDateOnly(row.quoteDate);
  if (!date) return null;

  const currency = row.currency.trim().toUpperCase();
  const rate =
    currency === "USD" || currency !== "BRL"
      ? (exchangeRatesByDate.get(date) ?? null)
      : null;

  const netPrice = toNumber(row.netPrice);
  const converted = computeMaterialQuotePriceBRL({
    netPrice,
    currency,
    exchangeRateUsed: rate,
  });

  return {
    id: row.id,
    date,
    dateLabel: formatMaterialIntelligenceQuoteDate(date),
    supplierId: row.supplierId?.trim() || null,
    supplierKey:
      resolveSupplierKey({ supplierId: row.supplierId, supplierName: row.supplierName }) ??
      "unknown",
    supplierName: row.supplierName?.trim() || null,
    originalCurrency: currency,
    originalPrice: netPrice,
    priceBRL: converted.priceBRL,
    exchangeRateUsed: converted.exchangeRateUsed,
    notes: row.notes?.trim() || null,
  };
}

function insufficientResult(materialName: string, periodLabel: string): MaterialMarketFxDecompositionResult {
  return {
    hasSufficientData: false,
    materialName,
    periodLabel,
    brlVariationPct: null,
    originalPriceVariationPct: null,
    exchangeVariationPct: null,
    unexplainedVariationPct: null,
    explanation: INSUFFICIENT_EXPLANATION,
    calculationBasis: INSUFFICIENT_BASIS,
    fromQuote: null,
    toQuote: null,
  };
}

export function computeMaterialMarketFxDecomposition(input: {
  materialName: string;
  fromQuote: MaterialMarketFxDecompositionQuoteRef;
  toQuote: MaterialMarketFxDecompositionQuoteRef;
  periodLabel: string;
}): MaterialMarketFxDecompositionResult {
  const { fromQuote, toQuote, materialName, periodLabel } = input;
  const currency = toQuote.originalCurrency;

  if (fromQuote.originalCurrency !== currency) {
    return insufficientResult(materialName, periodLabel);
  }

  const brlVariationPct = computePercentVariation(toQuote.priceBRL, fromQuote.priceBRL);
  const originalPriceVariationPct = computePercentVariation(
    toQuote.originalPrice,
    fromQuote.originalPrice
  );

  if (brlVariationPct == null || originalPriceVariationPct == null) {
    return insufficientResult(materialName, periodLabel);
  }

  if (currency === "BRL") {
    const explanation = buildFxDecompositionExplanation({
      materialName,
      brlVariationPct,
      exchangeVariationPct: 0,
      unexplainedVariationPct: brlVariationPct,
      currency,
    });
    const calculationBasis = buildFxDecompositionCalculationBasis({
      fromQuote,
      toQuote,
      brlVariationPct,
      originalPriceVariationPct,
      exchangeVariationPct: 0,
      unexplainedVariationPct: brlVariationPct,
    });

    return {
      hasSufficientData: true,
      materialName,
      periodLabel,
      brlVariationPct,
      originalPriceVariationPct,
      exchangeVariationPct: 0,
      unexplainedVariationPct: brlVariationPct,
      explanation,
      calculationBasis,
      fromQuote,
      toQuote,
    };
  }

  if (currency === "USD") {
    if (
      fromQuote.exchangeRateUsed == null ||
      toQuote.exchangeRateUsed == null ||
      fromQuote.exchangeRateUsed <= 0 ||
      toQuote.exchangeRateUsed <= 0
    ) {
      return insufficientResult(materialName, periodLabel);
    }

    const exchangeVariationPct = computePercentVariation(
      toQuote.exchangeRateUsed,
      fromQuote.exchangeRateUsed
    );
    if (exchangeVariationPct == null) {
      return insufficientResult(materialName, periodLabel);
    }

    const unexplainedVariationPct = computeUnexplainedBrlVariationPct(
      brlVariationPct,
      exchangeVariationPct
    );

    const explanation = buildFxDecompositionExplanation({
      materialName,
      brlVariationPct,
      exchangeVariationPct,
      unexplainedVariationPct,
      currency,
    });
    const calculationBasis = buildFxDecompositionCalculationBasis({
      fromQuote,
      toQuote,
      brlVariationPct,
      originalPriceVariationPct,
      exchangeVariationPct,
      unexplainedVariationPct,
    });

    return {
      hasSufficientData: true,
      materialName,
      periodLabel,
      brlVariationPct,
      originalPriceVariationPct,
      exchangeVariationPct,
      unexplainedVariationPct,
      explanation,
      calculationBasis,
      fromQuote,
      toQuote,
    };
  }

  return insufficientResult(materialName, periodLabel);
}

export function buildMaterialMarketFxDecompositionFromRows(input: {
  materialName: string;
  rows: MaterialMarketQuoteSourceRow[];
  period?: MaterialMarketFxDecompositionPeriod;
  exchangeRatesByDate?: Map<string, number | null>;
  referenceDate?: Date;
}): MaterialMarketFxDecompositionResult {
  const period = input.period ?? "latest";
  const periodLabel = resolveFxDecompositionPeriodLabel(period);
  const materialName = input.materialName.trim() || "Material";

  const rates = input.exchangeRatesByDate ?? new Map<string, number | null>();
  const sortedRows = sortQuotesChronologicallyDesc(input.rows);

  const pointsDesc = sortedRows
    .map((row) => mapRowToPoint(row, rates))
    .filter((p): p is MaterialMarketPriceHistoryPoint => p != null);

  if (pointsDesc.length < 2) {
    return insufficientResult(materialName, periodLabel);
  }

  const toPoint = pointsDesc[0];
  let fromPoint: MaterialMarketPriceHistoryPoint | null = null;

  if (period === "latest") {
    fromPoint = pointsDesc[1];
  } else if (period === "all") {
    fromPoint = pointsDesc[pointsDesc.length - 1];
  } else {
    fromPoint = findQuoteNearestDaysAgo(pointsDesc, PERIOD_DAYS[period]);
  }

  if (!fromPoint || fromPoint.id === toPoint.id) {
    return insufficientResult(materialName, periodLabel);
  }

  return computeMaterialMarketFxDecomposition({
    materialName,
    fromQuote: mapQuoteToRef(fromPoint),
    toQuote: mapQuoteToRef(toPoint),
    periodLabel,
  });
}
