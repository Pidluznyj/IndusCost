/**
 * Vínculo Contas a Receber → fatos de Conciliação de Carteira (camada paralela).
 *
 * Não altera NomusAccountsReceivable, Fluxo, Faturamento nem Comissões.
 * CR é no nível da NF/título; rateio ao pedido só com alocação itemizada confiável.
 */

import {
  PORTFOLIO_PRICE_TOLERANCE,
  type PortfolioConfidenceLevel,
  type PortfolioFactStatus,
  type PortfolioForecastSource,
  type PortfolioReconciliationFactDraft,
  type SnapshotNfe,
  type SnapshotNfeLink,
} from "./portfolioReconciliationAllocationEngine.js";
import {
  applyPortfolioPaymentCalendarToFacts,
  type PortfolioPaymentRule,
} from "./portfolioPaymentCalendar.js";

export type SnapshotReceivable = {
  id?: string | null;
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personName?: string | null;
  personCnpj?: string | null;
  personId?: number | null;
  amountReceivable: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  dueDate: Date | null;
  settlementDate: Date | null;
};

export type ReceivableMatchMethod = "ID_NFE" | "NFE_NUMBER_SERIE_KEY" | "NONE";

export type ReceivableNfeMatch = {
  receivables: SnapshotReceivable[];
  matchMethod: ReceivableMatchMethod;
  confidence: PortfolioConfidenceLevel;
};

export type EnrichPortfolioFactsWithReceivablesInput = {
  facts: PortfolioReconciliationFactDraft[];
  receivables: SnapshotReceivable[];
  nfes: SnapshotNfe[];
  nfeLinks?: SnapshotNfeLink[];
  /** Regras de calendário (DB). Britânia usa fallback embutido se ausente. */
  paymentRules?: readonly PortfolioPaymentRule[];
  /** Default true — aplica calendário após vínculo CR. */
  applyPaymentCalendar?: boolean;
};

const CONFIDENT_ALLOCATION_STATUSES = new Set<PortfolioFactStatus>([
  "ITEM_ALLOCATED",
  "PRICE_MISMATCH",
]);

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function normalizeInvoiceNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits.replace(/^0+/, "") || "0" : null;
}

function normalizeKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSerie(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

/** Título considerado liquidado/baixado. */
export function isReceivableSettled(row: SnapshotReceivable): boolean {
  if (row.settlementDate != null) return true;
  const balance = row.balanceReceivable;
  const received = row.amountReceived ?? 0;
  const receivable = row.amountReceivable ?? 0;
  if (balance != null && Math.abs(balance) <= PORTFOLIO_PRICE_TOLERANCE && received > 0) {
    return true;
  }
  if (receivable > 0 && received + PORTFOLIO_PRICE_TOLERANCE >= receivable) return true;
  return false;
}

/**
 * Proporção de rateio CR → pedido.
 * null quando não há base segura (sem header ou sem alocação).
 */
export function computeReceivableAllocationRatio(
  allocatedToOrderValue: number,
  nfeHeaderValue: number | null | undefined
): number | null {
  if (
    !Number.isFinite(allocatedToOrderValue) ||
    allocatedToOrderValue <= 0 ||
    nfeHeaderValue == null ||
    !Number.isFinite(nfeHeaderValue) ||
    nfeHeaderValue <= PORTFOLIO_PRICE_TOLERANCE
  ) {
    return null;
  }
  return round6(Math.min(1, allocatedToOrderValue / nfeHeaderValue));
}

/**
 * Vincula títulos AR a uma NF.
 * Preferência: sourceInvoiceId (= idNfe).
 * Fallback frágil: número (+ série/chave quando disponíveis) — nunca cliente+valor isolado.
 */
export function matchReceivablesToNfe(params: {
  nfeExternalId: number;
  nfeNumber?: string | null;
  nfeSerie?: string | null;
  nfeKey?: string | null;
  receivables: SnapshotReceivable[];
}): ReceivableNfeMatch {
  const byId = params.receivables.filter((row) => row.sourceInvoiceId === params.nfeExternalId);
  if (byId.length > 0) {
    return { receivables: byId, matchMethod: "ID_NFE", confidence: "HIGH" };
  }

  const wantNumber = normalizeInvoiceNumber(params.nfeNumber);
  if (!wantNumber) {
    return { receivables: [], matchMethod: "NONE", confidence: "BLOCKED" };
  }

  const wantSerie = normalizeSerie(params.nfeSerie);
  const wantKey = normalizeKey(params.nfeKey);

  const weak = params.receivables.filter((row) => {
    if (row.sourceInvoiceId != null) return false;
    const rowNumber = normalizeInvoiceNumber(row.sourceInvoiceNumber);
    if (rowNumber !== wantNumber) return false;
    // Número sozinho é frágil; exige série ou chave quando a NF as tem.
    // Se a NF não tem série/chave, ainda assim não usa cliente+valor — só número (confiança LOW).
    if (wantKey) {
      // sem chave no AR: aceita número (+ série se ambos presentes)
      if (wantSerie) {
        // AR não carrega série tipicamente — número + existência de série na NF = LOW
        return true;
      }
      return true;
    }
    if (wantSerie) return true;
    return true;
  });

  if (weak.length === 0) {
    return { receivables: [], matchMethod: "NONE", confidence: "BLOCKED" };
  }

  return {
    receivables: weak,
    matchMethod: "NFE_NUMBER_SERIE_KEY",
    confidence: "LOW",
  };
}

/** Bloqueia heurística cliente+valor (e qualquer match sem idNfe/número). */
export function wouldMatchReceivableByCustomerAndValueOnly(
  receivable: SnapshotReceivable,
  candidate: { customerName?: string | null; customerExternalId?: number | null; value?: number | null }
): boolean {
  const nameOk =
    !!receivable.personName &&
    !!candidate.customerName &&
    receivable.personName.trim().toLowerCase() === candidate.customerName.trim().toLowerCase();
  const valueOk =
    receivable.amountReceivable != null &&
    candidate.value != null &&
    Math.abs(receivable.amountReceivable - candidate.value) <= PORTFOLIO_PRICE_TOLERANCE;
  const hasInvoiceHook =
    receivable.sourceInvoiceId != null || normalizeInvoiceNumber(receivable.sourceInvoiceNumber) != null;
  return nameOk && valueOk && !hasInvoiceHook;
}

function sumReceivableField(
  rows: SnapshotReceivable[],
  field: "amountReceivable" | "amountReceived" | "balanceReceivable"
): number {
  return round6(rows.reduce((sum, row) => sum + (row[field] ?? 0), 0));
}

function earliestDueDate(rows: SnapshotReceivable[]): Date | null {
  const dates = rows
    .map((row) => row.dueDate)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

function isConfidentItemAllocation(fact: PortfolioReconciliationFactDraft): boolean {
  return (
    CONFIDENT_ALLOCATION_STATUSES.has(fact.status) &&
    fact.allocatedQuantity != null &&
    fact.allocatedQuantity > 0 &&
    (fact.allocatedValueByOrderPrice ?? 0) > 0
  );
}

type NfeOrderBucket = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeHeaderValue: number | null;
  allocatedToOrderValue: number;
  hasHeaderOnly: boolean;
  hasConfidentAllocation: boolean;
  factIndexes: number[];
};

function buildNfeOrderBuckets(facts: PortfolioReconciliationFactDraft[]): Map<string, NfeOrderBucket> {
  const buckets = new Map<string, NfeOrderBucket>();

  facts.forEach((fact, index) => {
    if (fact.nfeExternalId == null || fact.salesOrderId == null) return;
    const key = `${fact.salesOrderId}::${fact.nfeExternalId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        nfeExternalId: fact.nfeExternalId,
        nfeNumber: fact.nfeNumber,
        nfeSerie: fact.nfeSerie,
        nfeKey: fact.nfeKey,
        nfeHeaderValue: fact.nfeHeaderValue,
        allocatedToOrderValue: 0,
        hasHeaderOnly: false,
        hasConfidentAllocation: false,
        factIndexes: [],
      };
      buckets.set(key, bucket);
    }
    bucket.factIndexes.push(index);
    bucket.nfeNumber = bucket.nfeNumber ?? fact.nfeNumber;
    bucket.nfeSerie = bucket.nfeSerie ?? fact.nfeSerie;
    bucket.nfeKey = bucket.nfeKey ?? fact.nfeKey;
    bucket.nfeHeaderValue = bucket.nfeHeaderValue ?? fact.nfeHeaderValue;
    if (fact.status === "HEADER_ONLY_LINK") bucket.hasHeaderOnly = true;
    if (isConfidentItemAllocation(fact)) {
      bucket.hasConfidentAllocation = true;
      bucket.allocatedToOrderValue = round6(
        bucket.allocatedToOrderValue + (fact.allocatedValueByOrderPrice ?? 0)
      );
    }
  });

  return buckets;
}

function applyReceivableFields(
  fact: PortfolioReconciliationFactDraft,
  params: {
    receivables: SnapshotReceivable[];
    matchMethod: ReceivableMatchMethod;
    matchConfidence: PortfolioConfidenceLevel;
    ratio: number | null;
    canRateToOrder: boolean;
  }
): PortfolioReconciliationFactDraft {
  const { receivables, matchMethod, matchConfidence, ratio, canRateToOrder } = params;
  const ids = receivables.map((row) => row.externalId);
  const total = sumReceivableField(receivables, "amountReceivable");
  const received = sumReceivableField(receivables, "amountReceived");
  const open = sumReceivableField(receivables, "balanceReceivable");
  const dueDates = receivables.map((row) => toIsoDate(row.dueDate));
  const settlements = receivables.map((row) => toIsoDate(row.settlementDate));
  const allSettled = receivables.length > 0 && receivables.every(isReceivableSettled);

  const rateadoTotal = canRateToOrder && ratio != null ? round6(total * ratio) : null;
  const rateadoReceived = canRateToOrder && ratio != null ? round6(received * ratio) : null;
  const rateadoOpen = canRateToOrder && ratio != null ? round6(open * ratio) : null;

  const alerts = [...fact.alertsJson];
  const trace = {
    ...fact.traceJson,
    receivableMatchMethod: matchMethod,
    receivableMatchConfidence: matchConfidence,
    receivableRatio: ratio,
    receivableRateadoToOrder: canRateToOrder,
    receivableExternalIds: ids,
  };

  let status = fact.status;
  let forecastSource: PortfolioForecastSource = fact.forecastSource;
  let forecastDate = fact.forecastDate;
  let forecastValue = fact.forecastValue;
  let confidenceLevel = fact.confidenceLevel;

  if (receivables.length === 0) {
    return {
      ...fact,
      receivableIdsJson: null,
      receivableTotalValue: null,
      receivedValue: null,
      openReceivableValue: null,
      dueDatesJson: null,
      settlementDatesJson: null,
      alertsJson: alerts,
      traceJson: trace,
    };
  }

  if (!canRateToOrder) {
    // Mostra CR da NF sem consumir o pedido.
    alerts.push("CR associado à NF sem alocação itemizada confiável ao pedido");
    if (matchMethod !== "ID_NFE") {
      alerts.push("Vínculo CR↔NF por número/série/chave (confiança reduzida)");
    }
    status = "DATA_QUALITY_ISSUE";
    forecastSource = "UNRESOLVED";
    forecastValue = null;
    confidenceLevel = "BLOCKED";
    return {
      ...fact,
      receivableIdsJson: ids,
      receivableTotalValue: total,
      receivedValue: received,
      openReceivableValue: open,
      dueDatesJson: dueDates,
      settlementDatesJson: settlements,
      forecastSource,
      forecastDate: earliestDueDate(receivables) ?? forecastDate,
      forecastValue,
      confidenceLevel,
      status,
      alertsJson: alerts,
      traceJson: {
        ...trace,
        note: "CR visível no nível da NF; não rateado ao pedido",
      },
    };
  }

  // Rateio seguro ao pedido
  if (matchMethod !== "ID_NFE") {
    alerts.push("Vínculo CR↔NF por número/série/chave (confiança reduzida)");
  }
  if (ratio != null && ratio < 1 - PORTFOLIO_PRICE_TOLERANCE) {
    alerts.push("CR rateado pela proporção valor alocado ao pedido / valor da NF");
  }

  status = allSettled ? "RECEIVED" : "RECEIVABLE_CONFIRMED";
  forecastSource = "RECEIVABLE";
  forecastDate = allSettled
    ? receivables.map((r) => r.settlementDate).find((d) => d != null) ?? earliestDueDate(receivables)
    : earliestDueDate(receivables);
  forecastValue = allSettled ? rateadoReceived : rateadoOpen ?? rateadoTotal;
  confidenceLevel =
    matchMethod === "ID_NFE"
      ? allSettled
        ? "HIGH"
        : "HIGH"
      : "LOW";

  // Linha itemizada: compartilha metadados do CR; valor rateado da linha = proporção do valor alocado da linha
  const lineShare =
    fact.allocatedValueByOrderPrice != null &&
    params.ratio != null &&
    // ratio already is orderAllocated/nfeHeader; line gets (lineAllocated/orderAllocated)*rateadoTotal
    // simpler: lineRateado = lineAllocatedValue / nfeHeader * totalCR = lineAllocated * (totalCR/nfeHeader)
    fact.nfeHeaderValue != null &&
    fact.nfeHeaderValue > PORTFOLIO_PRICE_TOLERANCE
      ? round6(((fact.allocatedValueByOrderPrice ?? 0) / fact.nfeHeaderValue) * total)
      : rateadoTotal;

  const lineReceived =
    fact.nfeHeaderValue != null && fact.nfeHeaderValue > PORTFOLIO_PRICE_TOLERANCE
      ? round6(((fact.allocatedValueByOrderPrice ?? 0) / fact.nfeHeaderValue) * received)
      : rateadoReceived;
  const lineOpen =
    fact.nfeHeaderValue != null && fact.nfeHeaderValue > PORTFOLIO_PRICE_TOLERANCE
      ? round6(((fact.allocatedValueByOrderPrice ?? 0) / fact.nfeHeaderValue) * open)
      : rateadoOpen;

  // Rollups / surplus / etc. without allocated value keep order-level rateado totals
  const useLineSplit = isConfidentItemAllocation(fact);

  return {
    ...fact,
    receivableIdsJson: ids,
    receivableTotalValue: useLineSplit ? lineShare : rateadoTotal,
    receivedValue: useLineSplit ? lineReceived : rateadoReceived,
    openReceivableValue: useLineSplit ? lineOpen : rateadoOpen,
    dueDatesJson: dueDates,
    settlementDatesJson: settlements,
    forecastSource,
    forecastDate,
    forecastValue: useLineSplit
      ? allSettled
        ? lineReceived
        : lineOpen ?? lineShare
      : forecastValue,
    confidenceLevel,
    status,
    alertsJson: alerts,
    traceJson: trace,
  };
}

/**
 * Enriquece drafts de fato com CR Nomus (somente leitura).
 * Prioridade de previsão: RECEIVABLE > NFE > ORDER > UNRESOLVED.
 */
export function enrichPortfolioFactsWithReceivables(
  input: EnrichPortfolioFactsWithReceivablesInput
): PortfolioReconciliationFactDraft[] {
  const nfeByExternalId = new Map(input.nfes.map((nfe) => [nfe.externalId, nfe] as const));
  const facts = input.facts.map((fact) => ({ ...fact, alertsJson: [...fact.alertsJson], traceJson: { ...fact.traceJson } }));
  const buckets = buildNfeOrderBuckets(facts);

  for (const bucket of buckets.values()) {
    const nfe = nfeByExternalId.get(bucket.nfeExternalId);
    const match = matchReceivablesToNfe({
      nfeExternalId: bucket.nfeExternalId,
      nfeNumber: bucket.nfeNumber ?? nfe?.numero,
      nfeSerie: bucket.nfeSerie ?? nfe?.serie,
      nfeKey: bucket.nfeKey ?? nfe?.chave,
      receivables: input.receivables,
    });

    if (match.receivables.length === 0) continue;

    const headerValue = bucket.nfeHeaderValue ?? nfe?.valorLiquido ?? null;
    const canRateToOrder = bucket.hasConfidentAllocation && !bucket.hasHeaderOnly;
    // HEADER_ONLY_LINK sozinho: não rateia
    const onlyHeader =
      bucket.hasHeaderOnly && !bucket.hasConfidentAllocation;
    const ratio = canRateToOrder
      ? computeReceivableAllocationRatio(bucket.allocatedToOrderValue, headerValue)
      : null;

    for (const index of bucket.factIndexes) {
      const fact = facts[index]!;
      // Não sobrescrever ORDER_ONLY / OVER_LINKED sem NF neste bucket (já filtrado por nfeExternalId)
      if (fact.status === "HEADER_ONLY_LINK" || onlyHeader) {
        facts[index] = applyReceivableFields(fact, {
          receivables: match.receivables,
          matchMethod: match.matchMethod,
          matchConfidence: match.confidence,
          ratio: null,
          canRateToOrder: false,
        });
        continue;
      }

      if (!isConfidentItemAllocation(fact) && fact.status !== "FULLY_ALLOCATED" && fact.status !== "PARTIALLY_ALLOCATED") {
        // Surplus / foreign items: anexa IDs da NF mas não rateia como consumo do pedido
        if (fact.nfeExternalId === bucket.nfeExternalId) {
          facts[index] = applyReceivableFields(fact, {
            receivables: match.receivables,
            matchMethod: match.matchMethod,
            matchConfidence: match.confidence,
            ratio: null,
            canRateToOrder: false,
          });
        }
        continue;
      }

      facts[index] = applyReceivableFields(fact, {
        receivables: match.receivables,
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        ratio,
        canRateToOrder: canRateToOrder && ratio != null,
      });
    }
  }

  // Prioridade de forecast em linhas sem CR: mantém NFE/ORDER; com CR já viraram RECEIVABLE.
  // ORDER_ONLY permanece ORDER.
  const withSources = facts.map((fact) => {
    if (fact.forecastSource === "RECEIVABLE") return fact;
    if (
      fact.status === "ITEM_ALLOCATED" ||
      fact.status === "PRICE_MISMATCH" ||
      fact.status === "FULLY_ALLOCATED" ||
      fact.status === "PARTIALLY_ALLOCATED"
    ) {
      if (fact.forecastSource === "ORDER") {
        return { ...fact, forecastSource: "NFE" as const };
      }
    }
    return fact;
  });

  if (input.applyPaymentCalendar === false) return withSources;

  return applyPortfolioPaymentCalendarToFacts({
    facts: withSources,
    rules: input.paymentRules ?? [],
  });
}

/**
 * Resolve forecastSource dominante para um conjunto de fatos do mesmo pedido.
 * RECEIVABLE > NFE > ORDER > UNRESOLVED
 */
export function resolveDominantForecastSource(
  sources: PortfolioForecastSource[]
): PortfolioForecastSource {
  const set = new Set(sources);
  if (set.has("RECEIVABLE")) return "RECEIVABLE";
  if (set.has("NFE")) return "NFE";
  if (set.has("ORDER")) return "ORDER";
  return "UNRESOLVED";
}
