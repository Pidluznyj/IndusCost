/**
 * Motor de geração de alertas de mercado — regras puras, sem acesso ao banco.
 *
 * Limiares padrão (configuráveis via EffectiveAlertConfig / MaterialMarketAlertThresholds):
 * - risePercentThreshold / fallPercentThreshold: 10% — alta/queda relevante
 * - supplierAboveAvgPercent: 15% — fornecedor acima da média do material
 * - noRecentQuoteDays / daysWithoutQuote: 90 — dias sem cotação ativa
 * - savingsOpportunityPercent: 10% — menor cotação abaixo da média
 */

import type {
  MaterialMarketAlertSeverity,
  MaterialMarketAlertType,
} from "./materialMarketAlert.js";

export const MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS = {
  risePercentThreshold: 10,
  fallPercentThreshold: 10,
  priceChangePercent: 10,
  supplierAboveAvgPercent: 15,
  noRecentQuoteDays: 90,
  savingsOpportunityPercent: 10,
} as const;

export type MaterialMarketAlertThresholds = {
  risePercentThreshold: number;
  fallPercentThreshold: number;
  priceChangePercent: number;
  supplierAboveAvgPercent: number;
  noRecentQuoteDays: number;
  savingsOpportunityPercent: number;
};

export type MaterialMarketAlertQuoteInput = {
  id?: string;
  quoteDate: string | Date;
  netPrice: number | string | { toString(): string };
  supplierName?: string | null;
  status?: string;
};

export type MaterialMarketAlertEvaluationInput = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  isMarketMonitored: boolean;
  alertsEnabled?: boolean;
  marketMonitoringFrequencyDays?: number | null;
  quotes: MaterialMarketAlertQuoteInput[];
  referenceDate?: Date;
  thresholds?: Partial<MaterialMarketAlertThresholds>;
};

export type MaterialMarketAlertProposal = {
  materialId: string;
  alertType: MaterialMarketAlertType;
  title: string;
  message: string;
  severity: MaterialMarketAlertSeverity;
  metadata: Record<string, unknown>;
  triggeredAt: Date;
};

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: string | Date): Date {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number): string {
  return `${roundPercent(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatDatePtBr(value: Date): string {
  return value.toLocaleDateString("pt-BR");
}

function resolveThresholds(
  partial?: Partial<MaterialMarketAlertThresholds>
): MaterialMarketAlertThresholds {
  const rise =
    partial?.risePercentThreshold ??
    partial?.priceChangePercent ??
    MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.risePercentThreshold;
  const fall =
    partial?.fallPercentThreshold ??
    partial?.priceChangePercent ??
    MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.fallPercentThreshold;
  return {
    risePercentThreshold: rise,
    fallPercentThreshold: fall,
    priceChangePercent: partial?.priceChangePercent ?? rise,
    supplierAboveAvgPercent:
      partial?.supplierAboveAvgPercent ??
      MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.supplierAboveAvgPercent,
    noRecentQuoteDays:
      partial?.noRecentQuoteDays ?? MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.noRecentQuoteDays,
    savingsOpportunityPercent:
      partial?.savingsOpportunityPercent ??
      MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.savingsOpportunityPercent,
  };
}

function filterActiveQuotes(quotes: MaterialMarketAlertQuoteInput[]): {
  quoteDate: Date;
  netPrice: number;
  supplierName: string | null;
}[] {
  return quotes
    .filter((q) => !q.status || q.status === "ACTIVE")
    .map((q) => ({
      quoteDate: toDate(q.quoteDate),
      netPrice: roundMoney(toNumber(q.netPrice)),
      supplierName: q.supplierName?.trim() || null,
    }))
    .sort((a, b) => b.quoteDate.getTime() - a.quoteDate.getTime());
}

function computePercentChange(current: number, reference: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) {
    return null;
  }
  return roundPercent(((current - reference) / reference) * 100);
}

function resolveNoRecentQuoteDays(
  thresholds: MaterialMarketAlertThresholds,
  monitoringFrequencyDays?: number | null
): number {
  if (monitoringFrequencyDays && monitoringFrequencyDays > 0) {
    return Math.max(thresholds.noRecentQuoteDays, monitoringFrequencyDays * 13);
  }
  return thresholds.noRecentQuoteDays;
}

function buildBaseMetadata(input: {
  materialCode: string;
  thresholds: MaterialMarketAlertThresholds;
}): Record<string, unknown> {
  return {
    materialCode: input.materialCode,
    thresholds: input.thresholds,
  };
}

export function evaluateMaterialMarketAlerts(
  input: MaterialMarketAlertEvaluationInput
): MaterialMarketAlertProposal[] {
  if (!input.isMarketMonitored) return [];
  if (input.alertsEnabled === false) return [];

  const thresholds = resolveThresholds(input.thresholds);
  const referenceDate = input.referenceDate ?? new Date();
  const activeQuotes = filterActiveQuotes(input.quotes);
  const proposals: MaterialMarketAlertProposal[] = [];
  const baseMeta = buildBaseMetadata({
    materialCode: input.materialCode,
    thresholds,
  });

  const noRecentDays = resolveNoRecentQuoteDays(
    thresholds,
    input.marketMonitoringFrequencyDays
  );

  if (activeQuotes.length === 0) {
    proposals.push({
      materialId: input.materialId,
      alertType: "NO_RECENT_QUOTE",
      title: "Sem cotação recente",
      message: `${input.materialDescription} (${input.materialCode}) não possui cotações ativas registradas. Atualize o mercado para manter o monitoramento confiável.`,
      severity: "WARNING",
      metadata: {
        ...baseMeta,
        daysThreshold: noRecentDays,
        lastQuoteDate: null,
      },
      triggeredAt: referenceDate,
    });
    return proposals;
  }

  const latest = activeQuotes[0];
  const previous = activeQuotes[1] ?? null;
  const allPrices = activeQuotes.map((q) => q.netPrice);
  const average = roundMoney(allPrices.reduce((s, p) => s + p, 0) / allPrices.length);
  const historicalMax = Math.max(...allPrices);
  const historicalMin = Math.min(...allPrices);
  const historicalExcludingLatest = activeQuotes.slice(1).map((q) => q.netPrice);
  const priorMax =
    historicalExcludingLatest.length > 0 ? Math.max(...historicalExcludingLatest) : null;
  const priorMin =
    historicalExcludingLatest.length > 0 ? Math.min(...historicalExcludingLatest) : null;

  const daysSinceLatest = Math.floor(
    (referenceDate.getTime() - latest.quoteDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysSinceLatest > noRecentDays) {
    proposals.push({
      materialId: input.materialId,
      alertType: "NO_RECENT_QUOTE",
      title: "Sem cotação recente",
      message: `Última cotação de ${input.materialDescription} (${input.materialCode}) registrada em ${formatDatePtBr(latest.quoteDate)} — há ${daysSinceLatest} dias. O limite configurado é ${noRecentDays} dias.`,
      severity: daysSinceLatest > noRecentDays * 1.5 ? "CRITICAL" : "WARNING",
      metadata: {
        ...baseMeta,
        daysSinceLatest,
        daysThreshold: noRecentDays,
        lastQuoteDate: latest.quoteDate.toISOString().slice(0, 10),
        lastQuotePrice: latest.netPrice,
      },
      triggeredAt: referenceDate,
    });
  }

  const referenceForChange = previous?.netPrice ?? (activeQuotes.length >= 2 ? average : null);
  if (referenceForChange != null) {
    const changePct = computePercentChange(latest.netPrice, referenceForChange);
    if (changePct != null && changePct >= thresholds.risePercentThreshold) {
      proposals.push({
        materialId: input.materialId,
        alertType: "PRICE_UP_PCT",
        title: "Alta relevante de preço",
        message: `Cotação atual de ${formatBRL(latest.netPrice)} representa alta de ${formatPercent(changePct)} em relação à ${previous ? "cotação anterior" : "média"} (${formatBRL(referenceForChange)}).`,
        severity: changePct >= thresholds.risePercentThreshold * 2 ? "CRITICAL" : "WARNING",
        metadata: {
          ...baseMeta,
          currentPrice: latest.netPrice,
          referencePrice: referenceForChange,
          changePercent: changePct,
          referenceKind: previous ? "previous_quote" : "average",
        },
        triggeredAt: referenceDate,
      });
    } else if (changePct != null && changePct <= -thresholds.fallPercentThreshold) {
      proposals.push({
        materialId: input.materialId,
        alertType: "PRICE_DOWN_PCT",
        title: "Queda relevante de preço",
        message: `Cotação atual de ${formatBRL(latest.netPrice)} representa queda de ${formatPercent(Math.abs(changePct))} em relação à ${previous ? "cotação anterior" : "média"} (${formatBRL(referenceForChange)}).`,
        severity: "INFO",
        metadata: {
          ...baseMeta,
          currentPrice: latest.netPrice,
          referencePrice: referenceForChange,
          changePercent: changePct,
          referenceKind: previous ? "previous_quote" : "average",
        },
        triggeredAt: referenceDate,
      });
    }
  }

  if (priorMax != null && latest.netPrice > priorMax) {
    proposals.push({
      materialId: input.materialId,
      alertType: "BREAK_MAX",
      title: "Novo máximo histórico",
      message: `Cotação de ${formatBRL(latest.netPrice)} superou o máximo histórico anterior de ${formatBRL(priorMax)} para ${input.materialCode}.`,
      severity: "CRITICAL",
      metadata: {
        ...baseMeta,
        currentPrice: latest.netPrice,
        previousMax: priorMax,
        historicalMax,
      },
      triggeredAt: referenceDate,
    });
  }

  if (priorMin != null && latest.netPrice < priorMin) {
    proposals.push({
      materialId: input.materialId,
      alertType: "BREAK_MIN",
      title: "Novo mínimo histórico",
      message: `Cotação de ${formatBRL(latest.netPrice)} ficou abaixo do mínimo histórico anterior de ${formatBRL(priorMin)} para ${input.materialCode}.`,
      severity: "INFO",
      metadata: {
        ...baseMeta,
        currentPrice: latest.netPrice,
        previousMin: priorMin,
        historicalMin,
      },
      triggeredAt: referenceDate,
    });
  }

  if (activeQuotes.length >= 2 && average > 0) {
    const supplierLabel = latest.supplierName ?? "Fornecedor";
    const aboveAvgPct = computePercentChange(latest.netPrice, average);
    if (aboveAvgPct != null && aboveAvgPct >= thresholds.supplierAboveAvgPercent) {
      proposals.push({
        materialId: input.materialId,
        alertType: "SUPPLIER_ABOVE_AVG",
        title: "Fornecedor acima da média",
        message: `${supplierLabel} cotou ${formatBRL(latest.netPrice)}, ${formatPercent(aboveAvgPct)} acima da média do material (${formatBRL(average)}).`,
        severity: aboveAvgPct >= thresholds.supplierAboveAvgPercent * 2 ? "CRITICAL" : "WARNING",
        metadata: {
          ...baseMeta,
          supplierName: latest.supplierName,
          currentPrice: latest.netPrice,
          averagePrice: average,
          aboveAvgPercent: aboveAvgPct,
        },
        triggeredAt: referenceDate,
      });
    }

    const lowestQuote = [...activeQuotes].sort((a, b) => a.netPrice - b.netPrice)[0];
    const savingsPct = computePercentChange(average, lowestQuote.netPrice);
    if (
      savingsPct != null &&
      savingsPct >= thresholds.savingsOpportunityPercent &&
      lowestQuote.netPrice < average
    ) {
      proposals.push({
        materialId: input.materialId,
        alertType: "SAVINGS_OPPORTUNITY",
        title: "Oportunidade de economia",
        message: `Cotação de ${lowestQuote.supplierName ?? "fornecedor"} em ${formatBRL(lowestQuote.netPrice)} está ${formatPercent(savingsPct)} abaixo da média (${formatBRL(average)}). Avalie negociação ou troca de fornecedor.`,
        severity: "INFO",
        metadata: {
          ...baseMeta,
          bestSupplierName: lowestQuote.supplierName,
          bestPrice: lowestQuote.netPrice,
          averagePrice: average,
          savingsPercent: savingsPct,
        },
        triggeredAt: referenceDate,
      });
    }
  }

  return proposals;
}

/** Evita alertas OPEN duplicados do mesmo tipo — mantém o mais recente por tipo. */
export function dedupeMaterialMarketAlertProposals(
  proposals: MaterialMarketAlertProposal[]
): MaterialMarketAlertProposal[] {
  const byType = new Map<MaterialMarketAlertType, MaterialMarketAlertProposal>();
  for (const proposal of proposals) {
    byType.set(proposal.alertType, proposal);
  }
  return [...byType.values()];
}

export function shouldUpdateOpenMaterialMarketAlert(
  existing: { title: string; message: string; metadata: unknown },
  proposal: MaterialMarketAlertProposal
): boolean {
  const existingMeta = JSON.stringify(existing.metadata ?? null);
  const proposalMeta = JSON.stringify(proposal.metadata ?? null);
  return (
    existing.title !== proposal.title ||
    existing.message !== proposal.message ||
    existingMeta !== proposalMeta
  );
}

export function resolveAutoResolvableAlertTypes(
  proposals: MaterialMarketAlertProposal[]
): MaterialMarketAlertType[] {
  const activeTypes = new Set(proposals.map((p) => p.alertType));
  const resolvable: MaterialMarketAlertType[] = [];
  if (!activeTypes.has("NO_RECENT_QUOTE")) {
    resolvable.push("NO_RECENT_QUOTE");
  }
  return resolvable;
}
