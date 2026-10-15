/**
 * Compras — Prazo de pagamento negociado dos Pedidos de Compra Nomus (regra pura, browser-safe).
 *
 * Fonte: parcelas planejadas do próprio pedido (`rawPayload.parcelas[]`, lidas pelo parser oficial
 * `parsePurchaseOrderPlannedInstallments`). Nada é inventado:
 *  - sem parcelas, parcela sem vencimento/valor ou data-base ausente → NÃO IDENTIFICADO (nunca 0);
 *  - "À vista" só quando todas as parcelas vencem na própria data-base;
 *  - a quantidade de parcelas nunca gera parcelas iguais presumidas.
 *
 * PMP = Σ(valor da parcela × dias) / Σ(valor das parcelas), dias corridos entre a data-base e o
 * vencimento, contados por data de calendário (sem hora/fuso).
 */

export type PaymentTermsInstallmentInput = {
  index: number;
  dueDate: Date | null;
  amount: number | null;
  generatesAdvance?: boolean | null;
};

/**
 * Referência da contagem de dias. A definição da data-base contratual depende da decisão
 * registrada em docs/purchases/payment-terms-sla.md; o motor sempre devolve qual foi usada.
 */
export type PaymentTermsBaseKind = "ORDER_ISSUE_DATE" | "EXPECTED_DELIVERY_DATE" | "INVOICE_DATE";

export const PAYMENT_TERMS_BASE_LABELS: Record<PaymentTermsBaseKind, string> = {
  ORDER_ISSUE_DATE: "emissão do pedido",
  EXPECTED_DELIVERY_DATE: "entrega prevista",
  INVOICE_DATE: "emissão da NF-e",
};

export type PaymentTermsNotIdentifiedReason =
  | "NO_INSTALLMENTS"
  | "MISSING_BASE_DATE"
  | "INSTALLMENT_WITHOUT_DUE_DATE"
  | "INSTALLMENT_WITHOUT_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "NO_POSITIVE_AMOUNT";

export const PAYMENT_TERMS_REASON_LABELS: Record<PaymentTermsNotIdentifiedReason, string> = {
  NO_INSTALLMENTS: "Sem parcelas disponíveis.",
  MISSING_BASE_DATE: "Sem data-base para contar o prazo.",
  INSTALLMENT_WITHOUT_DUE_DATE: "Parcela sem vencimento.",
  INSTALLMENT_WITHOUT_AMOUNT: "Parcela sem valor.",
  NEGATIVE_AMOUNT: "Parcela com valor negativo.",
  NO_POSITIVE_AMOUNT: "Nenhuma parcela com valor positivo.",
};

export type PaymentTermsWarning =
  | "ZERO_AMOUNT_INSTALLMENT_IGNORED"
  | "DUE_BEFORE_BASE"
  | "ADVANCE_PAYMENT_FLAG"
  | "TOTAL_DIVERGENCE";

export const PAYMENT_TERMS_WARNING_LABELS: Record<PaymentTermsWarning, string> = {
  ZERO_AMOUNT_INSTALLMENT_IGNORED: "Parcela de valor zero ignorada no cálculo.",
  DUE_BEFORE_BASE: "Há parcela com vencimento antes da data-base (pagamento antecipado).",
  ADVANCE_PAYMENT_FLAG: "Parcela marcada como adiantamento no Nomus.",
  TOTAL_DIVERGENCE: "Soma das parcelas diverge do total do pedido.",
};

export type PaymentTermsInstallmentView = {
  index: number;
  dueDate: string; // AAAA-MM-DD
  amount: number;
  days: number;
};

export type PaymentTermsResult =
  | {
      status: "IDENTIFIED";
      baseKind: PaymentTermsBaseKind;
      baseDate: string; // AAAA-MM-DD
      label: string;
      pmpDays: number; // com 2 casas; exibição arredonda
      installmentsTotal: number;
      /** Σ(valor × dias) — base para consolidar carteiras sem média de médias. */
      weightedDaysAmount: number;
      installments: PaymentTermsInstallmentView[];
      warnings: PaymentTermsWarning[];
    }
  | {
      status: "NOT_IDENTIFIED";
      baseKind: PaymentTermsBaseKind;
      baseDate: string | null;
      reason: PaymentTermsNotIdentifiedReason;
      warnings: PaymentTermsWarning[];
    };

/** Data de calendário (AAAA-MM-DD) da data informada, sem efeito de hora/fuso (componentes UTC). */
export function calendarDateKey(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Diferença em dias corridos entre duas datas de calendário (b − a). */
export function calendarDaysBetween(a: Date, b: Date): number | null {
  const ka = calendarDateKey(a);
  const kb = calendarDateKey(b);
  if (!ka || !kb) return null;
  const ms = Date.parse(`${kb}T00:00:00Z`) - Date.parse(`${ka}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rótulo da condição a partir dos prazos das parcelas: "À vista", "28 dias", "30/60/90". */
export function formatPaymentTermsLabel(days: readonly number[]): string {
  if (days.length === 0) return "Não identificado";
  if (days.every((d) => d === 0)) return "À vista";
  if (days.length === 1) return `${days[0]} ${Math.abs(days[0]) === 1 ? "dia" : "dias"}`;
  return days.map((d) => (d === 0 ? "0" : String(d))).join("/");
}

export function computePurchasePaymentTerms(input: {
  installments: readonly PaymentTermsInstallmentInput[];
  baseDate: Date | null;
  baseKind: PaymentTermsBaseKind;
  /** Total do pedido (para apontar divergência; nunca substitui o valor das parcelas). */
  orderTotal?: number | null;
}): PaymentTermsResult {
  const baseKey = input.baseDate ? calendarDateKey(input.baseDate) : null;
  const warnings: PaymentTermsWarning[] = [];
  const fail = (reason: PaymentTermsNotIdentifiedReason): PaymentTermsResult => ({
    status: "NOT_IDENTIFIED",
    baseKind: input.baseKind,
    baseDate: baseKey,
    reason,
    warnings,
  });

  if (input.installments.length === 0) return fail("NO_INSTALLMENTS");
  if (!input.baseDate || !baseKey) return fail("MISSING_BASE_DATE");
  for (const row of input.installments) {
    if (!row.dueDate || !calendarDateKey(row.dueDate)) return fail("INSTALLMENT_WITHOUT_DUE_DATE");
    if (row.amount == null || !Number.isFinite(row.amount)) return fail("INSTALLMENT_WITHOUT_AMOUNT");
    if (row.amount < 0) return fail("NEGATIVE_AMOUNT");
  }
  if (input.installments.some((r) => r.generatesAdvance === true)) warnings.push("ADVANCE_PAYMENT_FLAG");

  const positive = input.installments.filter((r) => (r.amount as number) > 0);
  if (positive.length < input.installments.length) warnings.push("ZERO_AMOUNT_INSTALLMENT_IGNORED");
  if (positive.length === 0) return fail("NO_POSITIVE_AMOUNT");

  const rows: PaymentTermsInstallmentView[] = positive
    .map((r) => ({
      index: r.index,
      dueDate: calendarDateKey(r.dueDate as Date) as string,
      amount: round2(r.amount as number),
      days: calendarDaysBetween(input.baseDate as Date, r.dueDate as Date) as number,
    }))
    .sort((a, b) => a.days - b.days || a.index - b.index);

  if (rows.some((r) => r.days < 0)) warnings.push("DUE_BEFORE_BASE");

  const total = round2(rows.reduce((acc, r) => acc + r.amount, 0));
  const weighted = rows.reduce((acc, r) => acc + r.amount * r.days, 0);
  if (input.orderTotal != null && Number.isFinite(input.orderTotal) && input.orderTotal > 0) {
    const tolerance = Math.max(0.01, input.orderTotal * 0.005);
    if (Math.abs(total - input.orderTotal) > tolerance) warnings.push("TOTAL_DIVERGENCE");
  }

  return {
    status: "IDENTIFIED",
    baseKind: input.baseKind,
    baseDate: baseKey,
    label: formatPaymentTermsLabel(rows.map((r) => r.days)),
    pmpDays: round2(weighted / total),
    installmentsTotal: total,
    weightedDaysAmount: round2(weighted),
    installments: rows,
    warnings,
  };
}

/** "PMP: 60 dias" (dias inteiros; formatação brasileira). */
export function formatPmpDays(pmpDays: number | null | undefined): string {
  if (pmpDays == null || !Number.isFinite(pmpDays)) return "PMP: —";
  const n = Math.round(pmpDays);
  return `PMP: ${n.toLocaleString("pt-BR")} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
}

// ── Faixas e consolidação ────────────────────────────────────────────────────

export type PaymentTermsBucket = "AT_SIGHT" | "D1_29" | "D30_59" | "D60_89" | "D90_PLUS" | "NOT_IDENTIFIED";

export const PAYMENT_TERMS_BUCKETS: readonly PaymentTermsBucket[] = [
  "AT_SIGHT",
  "D1_29",
  "D30_59",
  "D60_89",
  "D90_PLUS",
  "NOT_IDENTIFIED",
];

export const PAYMENT_TERMS_BUCKET_LABELS: Record<PaymentTermsBucket, string> = {
  AT_SIGHT: "À vista / antecipado",
  D1_29: "1 a 29 dias",
  D30_59: "30 a 59 dias",
  D60_89: "60 a 89 dias",
  D90_PLUS: "90 dias ou mais",
  NOT_IDENTIFIED: "Não identificado",
};

/** Faixa pelo PMP arredondado em dias inteiros (o mesmo número exibido no grid). */
export function classifyPaymentTermsBucket(pmpDays: number | null | undefined): PaymentTermsBucket {
  if (pmpDays == null || !Number.isFinite(pmpDays)) return "NOT_IDENTIFIED";
  const d = Math.round(pmpDays);
  if (d <= 0) return "AT_SIGHT";
  if (d < 30) return "D1_29";
  if (d < 60) return "D30_59";
  if (d < 90) return "D60_89";
  return "D90_PLUS";
}

/** Comparação informativa com a meta gerencial (sem meta configurada → null; nunca bloqueia). */
export function paymentTermsMeetsTarget(pmpDays: number | null | undefined, targetDays: number | null | undefined): boolean | null {
  if (targetDays == null || !Number.isFinite(targetDays)) return null;
  if (pmpDays == null || !Number.isFinite(pmpDays)) return null;
  return Math.round(pmpDays) >= targetDays;
}

export type PaymentTermsAggregateInput = {
  /** Σ valor das parcelas consideradas (null quando não identificado). */
  installmentsTotal: number | null;
  /** Σ(valor × dias) (null quando não identificado). */
  weightedDaysAmount: number | null;
};

export type PaymentTermsAggregate = {
  orderCount: number;
  identifiedCount: number;
  notIdentifiedCount: number;
  /** % de pedidos com condição identificada (qualidade dos dados). */
  identifiedPercent: number | null;
  identifiedAmount: number;
  /** PMP ponderado pelo valor das parcelas — nunca média simples de PMPs. */
  pmpDays: number | null;
};

export function aggregatePaymentTerms(rows: readonly PaymentTermsAggregateInput[]): PaymentTermsAggregate {
  let identified = 0;
  let amount = 0;
  let weighted = 0;
  for (const r of rows) {
    if (r.installmentsTotal == null || r.weightedDaysAmount == null || !(r.installmentsTotal > 0)) continue;
    identified += 1;
    amount += r.installmentsTotal;
    weighted += r.weightedDaysAmount;
  }
  return {
    orderCount: rows.length,
    identifiedCount: identified,
    notIdentifiedCount: rows.length - identified,
    identifiedPercent: rows.length ? round2((identified / rows.length) * 100) : null,
    identifiedAmount: round2(amount),
    pmpDays: amount > 0 ? round2(weighted / amount) : null,
  };
}
