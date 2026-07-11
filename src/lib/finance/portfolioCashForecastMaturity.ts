/**
 * Forecast de caixa por maturidade — Central de Auditoria da Carteira (camada paralela).
 *
 * Hierarquia de evidência (substituição):
 * Baixa > CR > Documento/NF > Pedido futuro > Pedido em atenção > Pedido bloqueado.
 *
 * Não altera Fluxo de Caixa oficial, Contas a Receber oficial nem faz write.
 *
 * @see docs/finance/portfolio-cash-forecast-audit-requirements.md
 */

import {
  MATURITY_FUTURE_HORIZON_DAYS,
  MATURITY_PRESENT_OVERDUE_GRACE_DAYS,
  MATURITY_STALE_ORDER_DAYS,
  type PortfolioConfidenceLabel,
} from "./portfolioMaturityClassification.js";

export type PortfolioCashForecastSourceType =
  | "RECEIVED"
  | "RECEIVABLE"
  | "DOCUMENT_OR_NFE"
  | "ORDER_FUTURE"
  | "ORDER_ATTENTION"
  | "ORDER_BLOCKED";

export type PortfolioCashForecastMaturityBucket =
  | "CAIXA_REALIZADO"
  | "FINANCEIRO_CONFIRMADO"
  | "FATURADO_SEM_CR"
  | "PEDIDO_FUTURO_PROVAVEL"
  | "PEDIDO_PRESENTE_ATENCAO"
  | "PEDIDO_VENCIDO_BLOQUEADO";

export const CASH_FORECAST_SOURCE_LABEL: Record<
  PortfolioCashForecastSourceType,
  string
> = {
  RECEIVED: "Baixa / caixa realizado",
  RECEIVABLE: "Contas a Receber aberto",
  DOCUMENT_OR_NFE: "Documento de saída / NF (sem CR)",
  ORDER_FUTURE: "Pedido futuro (previsão)",
  ORDER_ATTENTION: "Pedido em atenção",
  ORDER_BLOCKED: "Pedido bloqueado / risco",
};

export const CASH_FORECAST_BUCKET_LABEL: Record<
  PortfolioCashForecastMaturityBucket,
  string
> = {
  CAIXA_REALIZADO: "Caixa realizado",
  FINANCEIRO_CONFIRMADO: "Financeiro confirmado (CR)",
  FATURADO_SEM_CR: "Faturado sem CR",
  PEDIDO_FUTURO_PROVAVEL: "Pedido futuro provável",
  PEDIDO_PRESENTE_ATENCAO: "Pedido presente / atenção",
  PEDIDO_VENCIDO_BLOQUEADO: "Pedido vencido / bloqueado",
};

const SOURCE_BASE_CONFIDENCE: Record<PortfolioCashForecastSourceType, number> = {
  RECEIVED: 100,
  RECEIVABLE: 90,
  DOCUMENT_OR_NFE: 75,
  ORDER_FUTURE: 65,
  ORDER_ATTENTION: 50,
  ORDER_BLOCKED: 20,
};

export type PortfolioCashForecastItemInput = {
  salesOrderItemId?: string | null;
  /** Data prevista do item (entrega / faturamento). */
  expectedDate?: string | null;
  orderItemValue?: number | null;
};

export type PortfolioCashForecastOrderInput = {
  salesOrderId?: string | null;
  orderCode: string;
  orderValue: number;
  asOfDate?: string | null;
  orderIssueDate?: string | null;
  expectedDeliveryDate?: string | null;
  /** Previsão agregada já resolvida (CR > NF > ORDER). */
  forecastDate?: string | null;
  forecastSource?: string | null;
  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue?: number | null;
  receivableDueDate?: string | null;
  receivableSettlementDate?: string | null;
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocation?: boolean;
  nfeDate?: string | null;
  stockDocumentDate?: string | null;
  paymentTermsAvailable?: boolean | null;
  items?: readonly PortfolioCashForecastItemInput[] | null;
};

export type PortfolioCashForecastLine = {
  salesOrderId: string | null;
  orderCode: string;
  sourceType: PortfolioCashForecastSourceType;
  sourceLabel: string;
  forecastDate: string | null;
  forecastValue: number;
  confidenceScore: number;
  confidenceLabel: PortfolioConfidenceLabel;
  maturityBucket: PortfolioCashForecastMaturityBucket;
  /** false = não tratar como caixa/fluxo confiável (ex.: bloqueado). */
  isReliableCash: boolean;
  evidence: string[];
  warnings: string[];
  explanation: string;
};

export type PortfolioCashForecastBucketSummary = {
  maturityBucket: PortfolioCashForecastMaturityBucket;
  label: string;
  linesCount: number;
  forecastValue: number;
  averageConfidence: number;
  isReliableCash: boolean;
};

export type PortfolioCashForecastMaturityResult = {
  lines: PortfolioCashForecastLine[];
  byMaturity: PortfolioCashForecastBucketSummary[];
  totals: {
    reliableCashValue: number;
    unreliableValue: number;
    linesCount: number;
  };
  warnings: string[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 86_400_000);
}

function confidenceLabelFromScore(score: number): PortfolioConfidenceLabel {
  if (score >= 85) return "ALTA";
  if (score >= 60) return "MEDIA";
  if (score >= 35) return "BAIXA";
  return "MUITO_BAIXA";
}

function hasFulfillment(input: PortfolioCashForecastOrderInput): boolean {
  return Boolean(
    input.hasNfe || input.hasStockDocument || input.hasAllocation
  );
}

function blockedConfidence(
  daysOverdue: number | null,
  daysSinceIssue: number | null
): number {
  const lag = Math.max(daysOverdue ?? 0, daysSinceIssue ?? 0);
  if (lag > 180) return 5;
  if (lag > 120) return 10;
  if (lag > 90) return 15;
  return 20;
}

function sourceToBucket(
  source: PortfolioCashForecastSourceType
): PortfolioCashForecastMaturityBucket {
  switch (source) {
    case "RECEIVED":
      return "CAIXA_REALIZADO";
    case "RECEIVABLE":
      return "FINANCEIRO_CONFIRMADO";
    case "DOCUMENT_OR_NFE":
      return "FATURADO_SEM_CR";
    case "ORDER_FUTURE":
      return "PEDIDO_FUTURO_PROVAVEL";
    case "ORDER_ATTENTION":
      return "PEDIDO_PRESENTE_ATENCAO";
    case "ORDER_BLOCKED":
      return "PEDIDO_VENCIDO_BLOQUEADO";
  }
}

function isReliableCashBucket(bucket: PortfolioCashForecastMaturityBucket): boolean {
  return bucket === "CAIXA_REALIZADO" || bucket === "FINANCEIRO_CONFIRMADO";
}

/**
 * Resolve a fonte de forecast do pedido pela hierarquia Baixa > CR > Doc/NF > Pedido.
 */
export function resolveCashForecastSourceType(
  input: PortfolioCashForecastOrderInput,
  asOf: string
): {
  sourceType: PortfolioCashForecastSourceType;
  daysUntil: number | null;
  daysOverdue: number | null;
  daysSinceIssue: number | null;
} {
  const received = toNumber(input.receivedValue);
  const open = toNumber(input.openReceivableValue);
  const issueDate = toIsoDate(input.orderIssueDate);
  const daysSinceIssue = issueDate ? daysBetween(issueDate, asOf) : null;

  // 1. Baixa completa
  if (received > 0.01 && open <= 0.01) {
    return {
      sourceType: "RECEIVED",
      daysUntil: null,
      daysOverdue: null,
      daysSinceIssue,
    };
  }

  // 2. CR aberto (substitui pedido / doc)
  if (open > 0.01) {
    const due = toIsoDate(input.receivableDueDate) ?? toIsoDate(input.forecastDate);
    let daysUntil: number | null = null;
    let daysOverdue: number | null = null;
    if (due) {
      const delta = daysBetween(asOf, due);
      if (delta >= 0) daysUntil = delta;
      else daysOverdue = -delta;
    }
    return { sourceType: "RECEIVABLE", daysUntil, daysOverdue, daysSinceIssue };
  }

  // 3. Documento / NF sem CR
  if (hasFulfillment(input)) {
    const docDate =
      toIsoDate(input.nfeDate) ??
      toIsoDate(input.stockDocumentDate) ??
      toIsoDate(input.forecastDate);
    let daysUntil: number | null = null;
    let daysOverdue: number | null = null;
    if (docDate) {
      const delta = daysBetween(asOf, docDate);
      if (delta >= 0) daysUntil = delta;
      else daysOverdue = -delta;
    }
    return {
      sourceType: "DOCUMENT_OR_NFE",
      daysUntil,
      daysOverdue,
      daysSinceIssue,
    };
  }

  // 4–6. Só pedido: futuro / atenção / bloqueado
  const orderDate =
    toIsoDate(input.forecastDate) ??
    toIsoDate(input.expectedDeliveryDate) ??
    issueDate;
  let daysUntil: number | null = null;
  let daysOverdue: number | null = null;
  if (orderDate) {
    const delta = daysBetween(asOf, orderDate);
    if (delta >= 0) daysUntil = delta;
    else daysOverdue = -delta;
  }

  const stale =
    daysSinceIssue != null && daysSinceIssue > MATURITY_STALE_ORDER_DAYS;

  if (daysUntil != null && daysUntil > MATURITY_FUTURE_HORIZON_DAYS) {
    return {
      sourceType: "ORDER_FUTURE",
      daysUntil,
      daysOverdue,
      daysSinceIssue,
    };
  }

  if (
    (daysUntil != null && daysUntil >= 0 && daysUntil <= MATURITY_FUTURE_HORIZON_DAYS) ||
    (daysOverdue != null &&
      daysOverdue > 0 &&
      daysOverdue <= MATURITY_PRESENT_OVERDUE_GRACE_DAYS)
  ) {
    return {
      sourceType: "ORDER_ATTENTION",
      daysUntil,
      daysOverdue,
      daysSinceIssue,
    };
  }

  if (
    (daysOverdue != null && daysOverdue > MATURITY_PRESENT_OVERDUE_GRACE_DAYS) ||
    stale ||
    orderDate == null
  ) {
    return {
      sourceType: "ORDER_BLOCKED",
      daysUntil,
      daysOverdue,
      daysSinceIssue,
    };
  }

  return {
    sourceType: "ORDER_ATTENTION",
    daysUntil,
    daysOverdue,
    daysSinceIssue,
  };
}

function pickForecastDate(
  input: PortfolioCashForecastOrderInput,
  sourceType: PortfolioCashForecastSourceType,
  warnings: string[]
): { date: string | null; usedItemDate: boolean } {
  const itemDates = (input.items ?? [])
    .map((it) => toIsoDate(it.expectedDate))
    .filter((d): d is string => Boolean(d))
    .sort();

  if (
    (sourceType === "ORDER_FUTURE" ||
      sourceType === "ORDER_ATTENTION" ||
      sourceType === "ORDER_BLOCKED") &&
    itemDates.length > 0
  ) {
    return { date: itemDates[0]!, usedItemDate: true };
  }

  if (sourceType === "RECEIVED") {
    return {
      date:
        toIsoDate(input.receivableSettlementDate) ??
        toIsoDate(input.forecastDate),
      usedItemDate: false,
    };
  }

  if (sourceType === "RECEIVABLE") {
    // CR real substitui previsão do pedido
    const crDue = toIsoDate(input.receivableDueDate);
    const orderForecast = toIsoDate(input.forecastDate);
    if (
      crDue &&
      orderForecast &&
      crDue !== orderForecast &&
      (input.forecastSource ?? "").toUpperCase() !== "RECEIVABLE"
    ) {
      warnings.push(
        "Vencimento do CR substituiu a previsão do pedido (datas diferentes)."
      );
    }
    return {
      date: crDue ?? orderForecast,
      usedItemDate: false,
    };
  }

  if (sourceType === "DOCUMENT_OR_NFE") {
    return {
      date:
        toIsoDate(input.nfeDate) ??
        toIsoDate(input.stockDocumentDate) ??
        toIsoDate(input.forecastDate) ??
        toIsoDate(input.expectedDeliveryDate),
      usedItemDate: false,
    };
  }

  // Pedido sem data de item
  const orderDate =
    toIsoDate(input.forecastDate) ?? toIsoDate(input.expectedDeliveryDate);
  if (input.items != null && !itemDates.length && orderDate) {
    warnings.push(
      "Sem data por item do pedido; usei a data prevista do pedido."
    );
  }
  return { date: orderDate ?? toIsoDate(input.orderIssueDate), usedItemDate: false };
}

function pickForecastValue(
  input: PortfolioCashForecastOrderInput,
  sourceType: PortfolioCashForecastSourceType
): number {
  const orderValue = round2(toNumber(input.orderValue));
  const received = round2(toNumber(input.receivedValue));
  const open = round2(toNumber(input.openReceivableValue));
  const receivable = round2(toNumber(input.receivableTotalValue));

  switch (sourceType) {
    case "RECEIVED":
      return received > 0 ? received : orderValue;
    case "RECEIVABLE":
      return open > 0 ? open : receivable > 0 ? receivable : orderValue;
    case "DOCUMENT_OR_NFE":
    case "ORDER_FUTURE":
    case "ORDER_ATTENTION":
    case "ORDER_BLOCKED":
      return orderValue;
  }
}

function buildExplanation(
  sourceType: PortfolioCashForecastSourceType,
  orderCode: string,
  forecastDate: string | null
): string {
  const when = forecastDate
    ? ` Data de referência: ${forecastDate}.`
    : " Sem data de referência confiável.";
  switch (sourceType) {
    case "RECEIVED":
      return `O pedido ${orderCode} já tem baixa: o dinheiro entrou no caixa. Esta linha substitui CR e previsão do pedido.${when}`;
    case "RECEIVABLE":
      return `O pedido ${orderCode} já virou Contas a Receber. O vencimento do CR guia o forecast e substitui a previsão pura do pedido.${when}`;
    case "DOCUMENT_OR_NFE":
      return `O pedido ${orderCode} tem NF ou documento de saída, mas ainda não tem CR. A previsão usa a evidência de faturamento/entrega — ainda não é caixa.${when}`;
    case "ORDER_FUTURE":
      return `O pedido ${orderCode} ainda é só previsão comercial (futuro). Confiança média — não é dinheiro confirmado.${when}`;
    case "ORDER_ATTENTION":
      return `O pedido ${orderCode} está na janela de atenção (próximo ou recém vencido sem documento/CR). Acompanhar evolução.${when}`;
    case "ORDER_BLOCKED":
      return `O pedido ${orderCode} está vencido/antigo sem documento ou CR. Não trate como caixa confiável nem some no fluxo seguro.${when}`;
  }
}

function buildEvidence(
  input: PortfolioCashForecastOrderInput,
  sourceType: PortfolioCashForecastSourceType
): string[] {
  const evidence: string[] = [];
  if (toNumber(input.receivedValue) > 0.01) {
    evidence.push(`Recebido: ${round2(input.receivedValue)}`);
  }
  if (toNumber(input.openReceivableValue) > 0.01) {
    evidence.push(`CR aberto: ${round2(input.openReceivableValue)}`);
  }
  if (input.hasNfe) evidence.push("NF vinculada");
  if (input.hasStockDocument) evidence.push("Documento de saída");
  if (input.hasAllocation) evidence.push("Alocação itemizada");
  if (toIsoDate(input.expectedDeliveryDate)) {
    evidence.push(`Entrega prevista pedido: ${toIsoDate(input.expectedDeliveryDate)}`);
  }
  if (toIsoDate(input.receivableDueDate)) {
    evidence.push(`Vencimento CR: ${toIsoDate(input.receivableDueDate)}`);
  }
  evidence.push(`Fonte ativa: ${CASH_FORECAST_SOURCE_LABEL[sourceType]}`);
  return evidence;
}

/**
 * Monta a linha de forecast de um pedido (auditoria / maturidade).
 */
export function buildOrderCashForecastLine(
  input: PortfolioCashForecastOrderInput
): PortfolioCashForecastLine {
  const asOf = toIsoDate(input.asOfDate) ?? startOfDayIso();
  const warnings: string[] = [];
  const resolved = resolveCashForecastSourceType(input, asOf);
  const sourceType = resolved.sourceType;
  const maturityBucket = sourceToBucket(sourceType);
  const { date: forecastDate } = pickForecastDate(input, sourceType, warnings);
  const forecastValue = pickForecastValue(input, sourceType);

  let confidenceScore = SOURCE_BASE_CONFIDENCE[sourceType];
  if (sourceType === "ORDER_BLOCKED") {
    confidenceScore = blockedConfidence(
      resolved.daysOverdue,
      resolved.daysSinceIssue
    );
  }

  if (input.paymentTermsAvailable !== true) {
    warnings.push("SEM_CONDICAO_PAGAMENTO");
    if (sourceType !== "RECEIVED" && sourceType !== "RECEIVABLE") {
      confidenceScore = clamp(confidenceScore - 10, 0, 100);
    }
  }

  return {
    salesOrderId: input.salesOrderId ?? null,
    orderCode: input.orderCode,
    sourceType,
    sourceLabel: CASH_FORECAST_SOURCE_LABEL[sourceType],
    forecastDate,
    forecastValue,
    confidenceScore,
    confidenceLabel: confidenceLabelFromScore(confidenceScore),
    maturityBucket,
    isReliableCash: isReliableCashBucket(maturityBucket),
    evidence: buildEvidence(input, sourceType),
    warnings,
    explanation: buildExplanation(sourceType, input.orderCode, forecastDate),
  };
}

function orderInputFromMaturityLike(row: {
  salesOrderId?: string | null;
  orderCode: string;
  orderValue: number;
  issueDate?: string | null;
  expectedDeliveryDate?: string | null;
  forecastDate?: string | null;
  forecastSource?: string | null;
  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue?: number;
  receivableDueDate?: string | null;
  receivableSettlementDate?: string | null;
  evidenceFlags?: {
    hasNfe?: boolean;
    hasStockDocument?: boolean;
    hasAllocatedStockDocument?: boolean;
  };
  nfeDate?: string | null;
  stockDocumentDate?: string | null;
  paymentTermsAvailable?: boolean | null;
}): PortfolioCashForecastOrderInput {
  return {
    salesOrderId: row.salesOrderId ?? null,
    orderCode: row.orderCode,
    orderValue: row.orderValue,
    orderIssueDate: row.issueDate ?? null,
    expectedDeliveryDate: row.expectedDeliveryDate ?? null,
    forecastDate: row.forecastDate ?? null,
    forecastSource: row.forecastSource ?? null,
    receivedValue: row.receivedValue,
    openReceivableValue: row.openReceivableValue,
    receivableTotalValue: row.receivableTotalValue ?? null,
    receivableDueDate: row.receivableDueDate ?? null,
    receivableSettlementDate: row.receivableSettlementDate ?? null,
    hasNfe: Boolean(row.evidenceFlags?.hasNfe),
    hasStockDocument: Boolean(row.evidenceFlags?.hasStockDocument),
    hasAllocation: Boolean(row.evidenceFlags?.hasAllocatedStockDocument),
    nfeDate: row.nfeDate ?? null,
    stockDocumentDate: row.stockDocumentDate ?? null,
    paymentTermsAvailable: row.paymentTermsAvailable ?? null,
  };
}

/**
 * Agrega linhas de forecast por maturidade para a Central de Auditoria.
 */
export function buildPortfolioCashForecastMaturity(args: {
  orders: readonly PortfolioCashForecastOrderInput[];
  asOfDate?: string | null;
}): PortfolioCashForecastMaturityResult {
  const asOf = toIsoDate(args.asOfDate) ?? startOfDayIso();
  const lines = args.orders.map((o) =>
    buildOrderCashForecastLine({ ...o, asOfDate: o.asOfDate ?? asOf })
  );

  const bucketOrder: PortfolioCashForecastMaturityBucket[] = [
    "CAIXA_REALIZADO",
    "FINANCEIRO_CONFIRMADO",
    "FATURADO_SEM_CR",
    "PEDIDO_FUTURO_PROVAVEL",
    "PEDIDO_PRESENTE_ATENCAO",
    "PEDIDO_VENCIDO_BLOQUEADO",
  ];

  const byMaturity: PortfolioCashForecastBucketSummary[] = bucketOrder.map(
    (maturityBucket) => {
      const bucketLines = lines.filter((l) => l.maturityBucket === maturityBucket);
      const forecastValue = round2(
        bucketLines.reduce((s, l) => s + l.forecastValue, 0)
      );
      const averageConfidence =
        bucketLines.length === 0
          ? 0
          : round2(
              bucketLines.reduce((s, l) => s + l.confidenceScore, 0) /
                bucketLines.length
            );
      return {
        maturityBucket,
        label: CASH_FORECAST_BUCKET_LABEL[maturityBucket],
        linesCount: bucketLines.length,
        forecastValue,
        averageConfidence,
        isReliableCash: isReliableCashBucket(maturityBucket),
      };
    }
  );

  const reliableCashValue = round2(
    byMaturity
      .filter((b) => b.isReliableCash)
      .reduce((s, b) => s + b.forecastValue, 0)
  );
  const unreliableValue = round2(
    byMaturity
      .filter((b) => !b.isReliableCash)
      .reduce((s, b) => s + b.forecastValue, 0)
  );

  const warnings = [
    ...new Set(lines.flatMap((l) => l.warnings)),
  ];

  return {
    lines,
    byMaturity,
    totals: {
      reliableCashValue,
      unreliableValue,
      linesCount: lines.length,
    },
    warnings,
  };
}

/**
 * Atalho: monta forecast a partir de linhas de maturidade já agregadas.
 */
export function buildCashForecastFromMaturityOrders(args: {
  orders: readonly {
    salesOrderId?: string | null;
    orderCode: string;
    orderValue: number;
    issueDate?: string | null;
    expectedDeliveryDate?: string | null;
    forecastDate?: string | null;
    forecastSource?: string | null;
    receivedValue: number;
    openReceivableValue: number;
    receivableTotalValue?: number;
    receivableDueDate?: string | null;
    receivableSettlementDate?: string | null;
    evidenceFlags?: {
      hasNfe?: boolean;
      hasStockDocument?: boolean;
      hasAllocatedStockDocument?: boolean;
    };
    nfeDate?: string | null;
    stockDocumentDate?: string | null;
    tagsAlerta?: readonly string[] | null;
  }[];
  asOfDate?: string | null;
}): PortfolioCashForecastMaturityResult {
  const inputs: PortfolioCashForecastOrderInput[] = args.orders.map((row) => {
    const hasMissingTerms = (row.tagsAlerta ?? []).includes("SEM_CONDICAO_PAGAMENTO");
    return {
      ...orderInputFromMaturityLike(row),
      paymentTermsAvailable: hasMissingTerms ? false : true,
    };
  });

  return buildPortfolioCashForecastMaturity({
    orders: inputs,
    asOfDate: args.asOfDate,
  });
}
