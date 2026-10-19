/**
 * Compras — Qualidade das Condições de Compra (regra pura, browser-safe).
 *
 * Usa SEMPRE o motor `computePurchasePaymentTerms` com data-base = emissão do pedido
 * ("prazo médio ponderado desde a emissão"). A data-base contratual não é informada pelo Nomus;
 * por isso o indicador é derivado e é rotulado assim em todas as telas.
 *
 * População da carteira: pedidos oficiais emitidos no período (data civil de emissão), exceto
 * cancelados. Pedidos recebidos/pagos continuam (mede-se a negociação, não o pagamento).
 * Não identificados entram na cobertura e nunca na média.
 */
import {
  classifyPaymentTermsBucket,
  computePurchasePaymentTerms,
  PAYMENT_TERMS_BUCKETS,
  PAYMENT_TERMS_REASON_LABELS,
  PAYMENT_TERMS_WARNING_LABELS,
  type PaymentTermsBucket,
  type PaymentTermsInstallmentInput,
  type PaymentTermsNotIdentifiedReason,
  type PaymentTermsResult,
} from "./purchasePaymentTerms.js";

export const PAYMENT_TERMS_ANALYSIS_BASE_LABEL = "Prazo médio ponderado desde a emissão do pedido";
export const PAYMENT_TERMS_ANALYSIS_BASE_NOTE =
  "Dias contados da emissão do Pedido de Compra até o vencimento de cada parcela planejada no Nomus. " +
  "O Nomus não informa a data-base contratual; este prazo não é uma condição contratual confirmada.";
export const PAYMENT_TERMS_OPPORTUNITY_NOTE =
  "Estimativa gerencial: compras mensais de referência × dias adicionais até a meta ÷ 30. " +
  "Não é economia realizada, saldo de caixa, lucro nem garantia de negociação.";

/** Média de dias de um mês civil (365,25 / 12). */
export const DAYS_PER_MONTH = 30.4375;

export type PaymentTermsOrderInput = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string;
  buyerPersonId: number | null;
  /** Data civil de emissão AAAA-MM-DD (null = ausente). */
  issuedDate: string | null;
  stage: string;
  canceled: boolean | null;
  /** Total oficial do pedido (derivado dos itens no espelho). */
  totalAmount: number | null;
  conditionText: string | null;
  installments: readonly PaymentTermsInstallmentInput[];
};

export type PaymentTermsOrderEvaluation = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string;
  buyerPersonId: number | null;
  issuedDate: string | null;
  month: string | null;
  stage: string;
  canceled: boolean;
  /** Valor comprado: total do pedido; sem total, a soma das parcelas. */
  purchaseAmount: number;
  conditionText: string | null;
  result: PaymentTermsResult;
  pmpDays: number | null;
  gapDays: number | null;
  belowTarget: boolean | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function dateKeyToDate(key: string | null): Date | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isPaymentTermsOrderCanceled(order: Pick<PaymentTermsOrderInput, "stage" | "canceled">): boolean {
  return order.canceled === true || order.stage === "CANCELED";
}

/** Gap em dias inteiros (o mesmo número exibido): PMP − meta. Sem meta ou sem PMP → null. */
export function paymentTermsGapDays(pmpDays: number | null, targetDays: number | null): number | null {
  if (pmpDays == null || targetDays == null || !Number.isFinite(pmpDays) || !Number.isFinite(targetDays)) return null;
  return Math.round(pmpDays) - targetDays;
}

export function evaluatePaymentTermsOrder(order: PaymentTermsOrderInput, targetDays: number | null): PaymentTermsOrderEvaluation {
  const result = computePurchasePaymentTerms({
    installments: order.installments,
    baseDate: dateKeyToDate(order.issuedDate),
    baseKind: "ORDER_ISSUE_DATE",
    orderTotal: order.totalAmount,
  });
  const pmpDays = result.status === "IDENTIFIED" ? result.pmpDays : null;
  const canceled = isPaymentTermsOrderCanceled(order);
  // Cancelado não é comparado com a meta (está fora da carteira).
  const gapDays = canceled ? null : paymentTermsGapDays(pmpDays, targetDays);
  const installmentsTotal = result.status === "IDENTIFIED" ? result.installmentsTotal : null;
  return {
    id: order.id,
    externalId: order.externalId,
    orderNumber: order.orderNumber,
    supplierExternalId: order.supplierExternalId,
    supplierName: order.supplierName,
    buyerPersonId: order.buyerPersonId,
    issuedDate: order.issuedDate,
    month: order.issuedDate ? order.issuedDate.slice(0, 7) : null,
    stage: order.stage,
    canceled,
    purchaseAmount: round2(order.totalAmount ?? installmentsTotal ?? 0),
    conditionText: order.conditionText?.trim() && order.conditionText.trim() !== "." ? order.conditionText.trim() : null,
    result,
    pmpDays,
    gapDays,
    belowTarget: gapDays == null ? null : gapDays < 0,
  };
}

export type PaymentTermsPeriod = { from: string; to: string };

export function periodDays(period: PaymentTermsPeriod): number {
  const a = dateKeyToDate(period.from);
  const b = dateKeyToDate(period.to);
  if (!a || !b || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Período imediatamente anterior com a mesma quantidade de dias. */
export function previousPeriod(period: PaymentTermsPeriod): PaymentTermsPeriod | null {
  const days = periodDays(period);
  const from = dateKeyToDate(period.from);
  if (!days || !from) return null;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

export function isInPeriod(dateKey: string | null, period: PaymentTermsPeriod): boolean {
  return !!dateKey && dateKey >= period.from && dateKey <= period.to;
}

type Acc = {
  orderCount: number;
  purchaseAmount: number;
  identifiedCount: number;
  identifiedPurchaseAmount: number;
  installmentsAmount: number;
  weightedDaysAmount: number;
  belowTargetAmount: number;
  belowTargetCount: number;
};

const emptyAcc = (): Acc => ({
  orderCount: 0,
  purchaseAmount: 0,
  identifiedCount: 0,
  identifiedPurchaseAmount: 0,
  installmentsAmount: 0,
  weightedDaysAmount: 0,
  belowTargetAmount: 0,
  belowTargetCount: 0,
});

function add(acc: Acc, e: PaymentTermsOrderEvaluation): void {
  acc.orderCount += 1;
  acc.purchaseAmount += e.purchaseAmount;
  if (e.result.status === "IDENTIFIED") {
    acc.identifiedCount += 1;
    acc.identifiedPurchaseAmount += e.purchaseAmount;
    acc.installmentsAmount += e.result.installmentsTotal;
    acc.weightedDaysAmount += e.result.weightedDaysAmount;
    if (e.belowTarget) {
      acc.belowTargetAmount += e.purchaseAmount;
      acc.belowTargetCount += 1;
    }
  }
}

export type PaymentTermsSummary = {
  orderCount: number;
  purchaseAmount: number;
  identifiedCount: number;
  identifiedPurchaseAmount: number;
  /** PMP ponderado pelo valor das parcelas (Σ valor×dias / Σ valor). */
  pmpDays: number | null;
  gapDays: number | null;
  coveragePercentByValue: number | null;
  coveragePercentByCount: number | null;
  belowTargetAmount: number | null;
  belowTargetCount: number | null;
  /** % do valor identificado que ficou abaixo da meta. */
  belowTargetPercent: number | null;
};

function summarize(acc: Acc, targetDays: number | null): PaymentTermsSummary {
  const pmpDays = acc.installmentsAmount > 0 ? round2(acc.weightedDaysAmount / acc.installmentsAmount) : null;
  const hasTarget = targetDays != null;
  return {
    orderCount: acc.orderCount,
    purchaseAmount: round2(acc.purchaseAmount),
    identifiedCount: acc.identifiedCount,
    identifiedPurchaseAmount: round2(acc.identifiedPurchaseAmount),
    pmpDays,
    gapDays: paymentTermsGapDays(pmpDays, targetDays),
    coveragePercentByValue: acc.purchaseAmount > 0 ? round2((acc.identifiedPurchaseAmount / acc.purchaseAmount) * 100) : null,
    coveragePercentByCount: acc.orderCount > 0 ? round2((acc.identifiedCount / acc.orderCount) * 100) : null,
    belowTargetAmount: hasTarget ? round2(acc.belowTargetAmount) : null,
    belowTargetCount: hasTarget ? acc.belowTargetCount : null,
    belowTargetPercent:
      hasTarget && acc.identifiedPurchaseAmount > 0 ? round2((acc.belowTargetAmount / acc.identifiedPurchaseAmount) * 100) : null,
  };
}

export type OpportunityReliability = "OK" | "LOW" | "NOT_CALCULABLE";

export const OPPORTUNITY_RELIABILITY_LABELS: Record<OpportunityReliability, string> = {
  OK: "Estimativa",
  LOW: "Baixa confiabilidade",
  NOT_CALCULABLE: "Não calculável",
};

export type SupplierOpportunity = PaymentTermsSummary & {
  key: string;
  supplierExternalId: number | null;
  supplierName: string;
  /** Meses civis com compra no período. */
  activeMonths: number;
  /** Compras mensais de referência: valor identificado ÷ meses de exposição do período (mín. 1). */
  monthlyVolume: number | null;
  /** max(0, meta − PMP) em dias inteiros. */
  extraDays: number | null;
  potentialWorkingCapital: number | null;
  reliability: OpportunityReliability;
  reliabilityReason: string | null;
};

export type BuyerSummary = PaymentTermsSummary & {
  buyerPersonId: number | null;
  /** Identificação oficial (sem nome inventado). */
  label: string;
  monthly: Array<{ month: string; pmpDays: number | null; purchaseAmount: number }>;
};

export type PaymentTermsAnalysis = {
  period: PaymentTermsPeriod;
  previousPeriod: PaymentTermsPeriod | null;
  targetDays: number | null;
  baseLabel: string;
  baseNote: string;
  opportunityNote: string;
  portfolio: PaymentTermsSummary & { potentialWorkingCapital: number | null };
  previous: PaymentTermsSummary | null;
  excluded: { canceledCount: number; canceledAmount: number };
  notIdentifiedByReason: Array<{ reason: PaymentTermsNotIdentifiedReason; count: number; amount: number }>;
  monthly: Array<{ month: string } & PaymentTermsSummary>;
  buckets: Array<{ bucket: PaymentTermsBucket; count: number; amount: number }>;
  suppliers: SupplierOpportunity[];
  buyers: BuyerSummary[];
  belowTargetOrders: PaymentTermsOrderEvaluation[];
  /** Pedidos do período (inclui cancelados, marcados) para tabelas/filtros da tela. */
  orders: PaymentTermsOrderRow[];
  ordersTruncated: boolean;
};

/** Linha leve de pedido para a tela (rastreável até o pedido e o motivo de exclusão). */
export type PaymentTermsOrderRow = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string;
  buyerPersonId: number | null;
  issuedDate: string | null;
  purchaseAmount: number;
  canceled: boolean;
  status: "IDENTIFIED" | "NOT_IDENTIFIED";
  label: string;
  pmpDays: number | null;
  gapDays: number | null;
  belowTarget: boolean | null;
  bucket: PaymentTermsBucket;
  reasonLabel: string | null;
  installmentCount: number;
};

export function toPaymentTermsOrderRow(e: PaymentTermsOrderEvaluation): PaymentTermsOrderRow {
  return {
    id: e.id,
    externalId: e.externalId,
    orderNumber: e.orderNumber,
    supplierExternalId: e.supplierExternalId,
    supplierName: e.supplierName,
    buyerPersonId: e.buyerPersonId,
    issuedDate: e.issuedDate,
    purchaseAmount: e.purchaseAmount,
    canceled: e.canceled,
    status: e.result.status,
    label: e.result.status === "IDENTIFIED" ? e.result.label : "Não identificado",
    pmpDays: e.pmpDays,
    gapDays: e.gapDays,
    belowTarget: e.belowTarget,
    bucket: classifyPaymentTermsBucket(e.pmpDays),
    reasonLabel: e.result.status === "NOT_IDENTIFIED" ? PAYMENT_TERMS_REASON_LABELS[e.result.reason] : null,
    installmentCount: e.result.status === "IDENTIFIED" ? e.result.installments.length : 0,
  };
}

export const PAYMENT_TERMS_ORDERS_LIMIT = 2000;

export function buyerLabel(buyerPersonId: number | null): string {
  return buyerPersonId != null ? `Comprador #${buyerPersonId}` : "Sem comprador informado";
}

function supplierKey(e: Pick<PaymentTermsOrderEvaluation, "supplierExternalId" | "supplierName">): string {
  return e.supplierExternalId != null ? `ext:${e.supplierExternalId}` : `name:${e.supplierName}`;
}

/** Oportunidade de capital de giro por fornecedor (estimativa; nunca economia realizada). */
export function computeSupplierOpportunity(input: {
  summary: PaymentTermsSummary;
  activeMonths: number;
  periodDays: number;
  targetDays: number | null;
}): Pick<SupplierOpportunity, "monthlyVolume" | "extraDays" | "potentialWorkingCapital" | "reliability" | "reliabilityReason"> {
  const { summary, targetDays } = input;
  const exposureMonths = Math.max(1, input.periodDays / DAYS_PER_MONTH);
  const monthlyVolume = summary.identifiedPurchaseAmount > 0 ? round2(summary.identifiedPurchaseAmount / exposureMonths) : null;
  if (targetDays == null) {
    return { monthlyVolume, extraDays: null, potentialWorkingCapital: null, reliability: "NOT_CALCULABLE", reliabilityReason: "Meta de PMP não configurada." };
  }
  if (summary.pmpDays == null || monthlyVolume == null) {
    return { monthlyVolume, extraDays: null, potentialWorkingCapital: null, reliability: "NOT_CALCULABLE", reliabilityReason: "Sem compras com prazo identificado." };
  }
  const extraDays = Math.max(0, targetDays - Math.round(summary.pmpDays));
  const potential = round2((monthlyVolume * extraDays) / 30);
  let reliability: OpportunityReliability = "OK";
  let reason: string | null = null;
  if (input.periodDays < 60) {
    reliability = "LOW";
    reason = "Período curto (menos de 2 meses) para estimar compras mensais.";
  } else if (input.activeMonths < 2 || summary.identifiedCount < 3) {
    reliability = "LOW";
    reason = "Poucas compras no período (recorrência não comprovada).";
  }
  return { monthlyVolume, extraDays, potentialWorkingCapital: potential, reliability, reliabilityReason: reason };
}

export function buildPaymentTermsAnalysis(input: {
  orders: readonly PaymentTermsOrderInput[];
  period: PaymentTermsPeriod;
  targetDays: number | null;
  belowTargetLimit?: number;
}): PaymentTermsAnalysis {
  const { period, targetDays } = input;
  const prev = previousPeriod(period);
  const days = periodDays(period);
  // Deduplicação pela identidade oficial do pedido (externalId).
  const unique = new Map<number, PaymentTermsOrderInput>();
  for (const o of input.orders) if (!unique.has(o.externalId)) unique.set(o.externalId, o);
  const evaluations = [...unique.values()].map((o) => evaluatePaymentTermsOrder(o, targetDays));

  const current = evaluations.filter((e) => isInPeriod(e.issuedDate, period));
  const canceled = current.filter((e) => e.canceled);
  const population = current.filter((e) => !e.canceled);

  const portfolioAcc = emptyAcc();
  const reasonMap = new Map<PaymentTermsNotIdentifiedReason, { count: number; amount: number }>();
  const monthMap = new Map<string, Acc>();
  const bucketMap = new Map<PaymentTermsBucket, { count: number; amount: number }>(
    PAYMENT_TERMS_BUCKETS.map((b) => [b, { count: 0, amount: 0 }]),
  );
  const supplierMap = new Map<string, { acc: Acc; name: string; ext: number | null; months: Set<string> }>();
  const buyerMap = new Map<string, { acc: Acc; id: number | null; months: Map<string, Acc> }>();

  for (const e of population) {
    add(portfolioAcc, e);
    if (e.result.status === "NOT_IDENTIFIED") {
      const r = reasonMap.get(e.result.reason) ?? { count: 0, amount: 0 };
      r.count += 1;
      r.amount += e.purchaseAmount;
      reasonMap.set(e.result.reason, r);
    }
    if (e.month) {
      const m = monthMap.get(e.month) ?? emptyAcc();
      add(m, e);
      monthMap.set(e.month, m);
    }
    const b = bucketMap.get(classifyPaymentTermsBucket(e.pmpDays))!;
    b.count += 1;
    b.amount += e.purchaseAmount;

    const sk = supplierKey(e);
    const s = supplierMap.get(sk) ?? { acc: emptyAcc(), name: e.supplierName, ext: e.supplierExternalId, months: new Set<string>() };
    add(s.acc, e);
    if (e.month) s.months.add(e.month);
    supplierMap.set(sk, s);

    const bk = e.buyerPersonId != null ? String(e.buyerPersonId) : "none";
    const bu = buyerMap.get(bk) ?? { acc: emptyAcc(), id: e.buyerPersonId, months: new Map<string, Acc>() };
    add(bu.acc, e);
    if (e.month) {
      const bm = bu.months.get(e.month) ?? emptyAcc();
      add(bm, e);
      bu.months.set(e.month, bm);
    }
    buyerMap.set(bk, bu);
  }

  const suppliers: SupplierOpportunity[] = [...supplierMap.entries()].map(([key, s]) => {
    const summary = summarize(s.acc, targetDays);
    return {
      key,
      supplierExternalId: s.ext,
      supplierName: s.name,
      ...summary,
      activeMonths: s.months.size,
      ...computeSupplierOpportunity({ summary, activeMonths: s.months.size, periodDays: days, targetDays }),
    };
  });
  // Maior oportunidade estimada primeiro; empate → gap mais severo; depois maior volume.
  suppliers.sort(
    (a, b) =>
      (b.potentialWorkingCapital ?? -1) - (a.potentialWorkingCapital ?? -1) ||
      (a.gapDays ?? Infinity) - (b.gapDays ?? Infinity) ||
      b.purchaseAmount - a.purchaseAmount,
  );

  const buyers: BuyerSummary[] = [...buyerMap.values()]
    .map((bu) => ({
      buyerPersonId: bu.id,
      label: buyerLabel(bu.id),
      ...summarize(bu.acc, targetDays),
      monthly: [...bu.months.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([month, acc]) => {
          const s = summarize(acc, targetDays);
          return { month, pmpDays: s.pmpDays, purchaseAmount: s.purchaseAmount };
        }),
    }))
    .sort((a, b) => b.purchaseAmount - a.purchaseAmount);

  const portfolio = summarize(portfolioAcc, targetDays);
  const totalPotential = suppliers.reduce((acc, s) => acc + (s.potentialWorkingCapital ?? 0), 0);
  const previousAcc = emptyAcc();
  if (prev) for (const e of evaluations) if (!e.canceled && isInPeriod(e.issuedDate, prev)) add(previousAcc, e);

  return {
    period,
    previousPeriod: prev,
    targetDays,
    baseLabel: PAYMENT_TERMS_ANALYSIS_BASE_LABEL,
    baseNote: PAYMENT_TERMS_ANALYSIS_BASE_NOTE,
    opportunityNote: PAYMENT_TERMS_OPPORTUNITY_NOTE,
    portfolio: { ...portfolio, potentialWorkingCapital: targetDays == null ? null : round2(totalPotential) },
    previous: prev && previousAcc.orderCount > 0 ? summarize(previousAcc, targetDays) : null,
    excluded: {
      canceledCount: canceled.length,
      canceledAmount: round2(canceled.reduce((acc, e) => acc + e.purchaseAmount, 0)),
    },
    notIdentifiedByReason: [...reasonMap.entries()].map(([reason, v]) => ({ reason, count: v.count, amount: round2(v.amount) })),
    monthly: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, acc]) => ({ month, ...summarize(acc, targetDays) })),
    buckets: [...bucketMap.entries()].map(([bucket, v]) => ({ bucket, count: v.count, amount: round2(v.amount) })),
    suppliers,
    buyers,
    belowTargetOrders: population
      .filter((e) => e.belowTarget)
      .sort((a, b) => b.purchaseAmount - a.purchaseAmount)
      .slice(0, input.belowTargetLimit ?? 50),
    orders: [...current]
      .sort((a, b) => (b.issuedDate ?? "").localeCompare(a.issuedDate ?? "") || b.externalId - a.externalId)
      .slice(0, PAYMENT_TERMS_ORDERS_LIMIT)
      .map(toPaymentTermsOrderRow),
    ordersTruncated: current.length > PAYMENT_TERMS_ORDERS_LIMIT,
  };
}

/** Drill-down de um fornecedor: pedidos que compõem o PMP, com parcelas, dias e motivos. */
export function buildSupplierPaymentTermsDetail(input: {
  orders: readonly PaymentTermsOrderInput[];
  period: PaymentTermsPeriod;
  targetDays: number | null;
  supplierExternalId: number;
}) {
  const own = input.orders.filter((o) => o.supplierExternalId === input.supplierExternalId);
  // Mesma regra da carteira, aplicada só aos pedidos do fornecedor (evolução mensal própria).
  const analysis = buildPaymentTermsAnalysis({ orders: own, period: input.period, targetDays: input.targetDays });
  const supplier = analysis.suppliers[0] ?? null;
  const orders = own
    .filter((o) => isInPeriod(o.issuedDate, input.period))
    .map((o) => evaluatePaymentTermsOrder(o, input.targetDays))
    .sort((a, b) => (b.issuedDate ?? "").localeCompare(a.issuedDate ?? ""));
  return { period: input.period, targetDays: input.targetDays, baseNote: PAYMENT_TERMS_ANALYSIS_BASE_NOTE, supplier, monthly: analysis.monthly, orders };
}

// ── Célula do grid (mesmo motor; o frontend só exibe) ────────────────────────

export type PaymentTermsCellDto = {
  status: "IDENTIFIED" | "NOT_IDENTIFIED";
  /** "30/60/90", "28 dias", "À vista" ou "Não identificado". */
  label: string;
  pmpDays: number | null;
  reasonLabel: string | null;
  /** Data-base usada (emissão do pedido), AAAA-MM-DD. */
  baseDate: string | null;
  installmentCount: number;
  warnings: string[];
  bucket: PaymentTermsBucket;
  gapDays: number | null;
  belowTarget: boolean | null;
};

export function buildPaymentTermsCell(
  input: {
    installments: readonly PaymentTermsInstallmentInput[];
    issuedAt: Date | null;
    totalAmount: number | null;
    /** Pedido cancelado: mostra o prazo, mas não compara com a meta. */
    canceled?: boolean;
  },
  targetDays: number | null,
): PaymentTermsCellDto {
  const result = computePurchasePaymentTerms({
    installments: input.installments,
    baseDate: input.issuedAt,
    baseKind: "ORDER_ISSUE_DATE",
    orderTotal: input.totalAmount,
  });
  const pmpDays = result.status === "IDENTIFIED" ? result.pmpDays : null;
  const gapDays = input.canceled ? null : paymentTermsGapDays(pmpDays, targetDays);
  return {
    status: result.status,
    label: result.status === "IDENTIFIED" ? result.label : "Não identificado",
    pmpDays,
    reasonLabel: result.status === "NOT_IDENTIFIED" ? PAYMENT_TERMS_REASON_LABELS[result.reason] : null,
    baseDate: result.baseDate,
    installmentCount: result.status === "IDENTIFIED" ? result.installments.length : input.installments.length,
    warnings: result.warnings.map((w) => PAYMENT_TERMS_WARNING_LABELS[w]),
    bucket: classifyPaymentTermsBucket(pmpDays),
    gapDays,
    belowTarget: gapDays == null ? null : gapDays < 0,
  };
}

/** Bloco "Condição de Pagamento da Compra" do detalhe: célula + dias por parcela (mesmo motor). */
export type PaymentTermsDetailDto = {
  cell: PaymentTermsCellDto;
  /** Dias entre a emissão e o vencimento, por índice da parcela planejada. */
  daysByInstallmentIndex: Record<number, number>;
  conditionText: string | null;
  targetDays: number | null;
  baseLabel: string;
  baseNote: string;
};

export function buildPaymentTermsDetail(
  input: {
    installments: readonly PaymentTermsInstallmentInput[];
    issuedAt: Date | null;
    totalAmount: number | null;
    conditionText: string | null;
  },
  targetDays: number | null,
): PaymentTermsDetailDto {
  const result = computePurchasePaymentTerms({
    installments: input.installments,
    baseDate: input.issuedAt,
    baseKind: "ORDER_ISSUE_DATE",
    orderTotal: input.totalAmount,
  });
  const days: Record<number, number> = {};
  if (result.status === "IDENTIFIED") for (const row of result.installments) days[row.index] = row.days;
  const text = input.conditionText?.trim();
  return {
    cell: buildPaymentTermsCell(input, targetDays),
    daysByInstallmentIndex: days,
    conditionText: text && text !== "." ? text : null,
    targetDays,
    baseLabel: PAYMENT_TERMS_ANALYSIS_BASE_LABEL,
    baseNote: PAYMENT_TERMS_ANALYSIS_BASE_NOTE,
  };
}
