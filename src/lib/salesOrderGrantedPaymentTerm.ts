/**
 * Prazo médio de recebimento — listagem Comercial de Pedidos de Venda.
 *
 * Motor PURO (sem Prisma, sem React, sem Node).
 *
 * Definição (revisão 2026-09-25): o prazo de um título é o número de dias entre a
 * DATA DE EMISSÃO DA NF-e de origem e o VENCIMENTO do título do Contas a Receber
 * (SalesOrder → SalesOrderNfeLink → NomusNfe.xmlDhEmi / NomusAccountsReceivable.dueDate).
 * O prazo do pedido é a média dos seus títulos ponderada pelo valor de cada título.
 * O prazo médio geral é a média dos PEDIDOS FATURADOS do filtro ponderada por
 * `SalesOrder.totalNetValue` (somente valores positivos).
 *
 * Só pedidos faturados (com NF-e válida) entram na média e na cobertura: sem NF-e
 * ainda não há recebimento a medir. A participação do valor faturado no valor
 * vendido do filtro é informada à parte (`invoicedSharePercent`).
 *
 * Pedidos faturados sem títulos válidos usam, como fallback declarado, a condição
 * comercial de pagamento (`SalesOrder.paymentTerms`) interpretada por um parser
 * fail-closed ("30/60" → 45; "À vista" → 0). Faturados sem título e sem condição
 * interpretável ficam fora da média e aparecem na cobertura.
 *
 * Não mede atraso nem liquidação: usa vencimento, nunca `settlementDate` ou
 * `amountReceived`. `paymentMethod` (PIX/boleto/…) nunca define prazo.
 */

export const SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE =
  "NomusAccountsReceivable.dueDate - NomusNfe.xmlDhEmi | SalesOrder.paymentTerms" as const;

/** Metodologia estável exposta no DTO (não é só texto de UI). */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY =
  "Prazo por título = vencimento do título do Contas a Receber menos a data de emissão da NF-e de origem, " +
  "ponderado pelo valor do título; prazo do pedido = média dos seus títulos; prazo médio geral = média dos " +
  "pedidos faturados do filtro ponderada pelo valor líquido (SalesOrder.totalNetValue > 0). Pedidos sem NF-e " +
  "válida não entram na média nem na cobertura (participação do faturado informada à parte). Pedidos faturados " +
  "sem títulos usam SalesOrder.paymentTerms quando interpretável (média das parcelas). Faturados sem título e " +
  "sem condição interpretável são excluídos e refletidos na cobertura. Não considera liquidação nem atraso.";

/** Limite superior defensivo de dias por parcela da condição comercial. */
export const GRANTED_PAYMENT_TERM_MAX_DAYS = 365;
/** Limite defensivo de parcelas numa condição comercial. */
export const GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS = 24;
/** Limite defensivo de dias entre emissão da NF-e e vencimento do título (2 anos). */
export const GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS = 730;

/** Qualidade por cobertura (% do valor líquido positivo FATURADO com prazo resolvido). */
export const GRANTED_PAYMENT_TERM_FULL_COVERAGE_PERCENT = 95;
export const GRANTED_PAYMENT_TERM_PARTIAL_COVERAGE_PERCENT = 80;

/** Top N de condições não reconhecidas devolvidas para auditoria. */
export const GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT = 20;

export const GRANTED_PAYMENT_TERM_QUALITY_VALUES = [
  "FULL",
  "PARTIAL",
  "LOW",
  "UNAVAILABLE",
] as const;

export type GrantedPaymentTermQuality = (typeof GRANTED_PAYMENT_TERM_QUALITY_VALUES)[number];

export type GrantedPaymentTermParseReason =
  /** À vista / 0 dias. */
  | "CASH"
  /** Um único prazo ("30", "30 dias", "30 DDL"). */
  | "SINGLE_TERM"
  /** Parcelas com peso igual ("30/60/90"). */
  | "INSTALLMENTS"
  /** null / vazio / só espaços. */
  | "MISSING"
  /** Percentuais, entrada, sinal, antecipação — peso das parcelas indeterminado. */
  | "AMBIGUOUS_WEIGHTS"
  | "NEGATIVE_DAYS"
  | "OUT_OF_RANGE"
  | "TOO_MANY_INSTALLMENTS"
  /** Parcelas repetidas ou fora de ordem ("30/30", "60/30"). */
  | "NON_INCREASING_SEQUENCE"
  | "UNRECOGNIZED_FORMAT";

export type GrantedPaymentTermParseResult = {
  recognized: boolean;
  /** Prazo médio da condição em dias (null quando não reconhecida). */
  averageDays: number | null;
  installmentDays: number[];
  /** Texto normalizado usado só para comparação (trim, espaços, acentos, caixa). */
  normalized: string;
  reason: GrantedPaymentTermParseReason;
};

const GRANTED_PAYMENT_TERM_REASON_LABELS: Record<GrantedPaymentTermParseReason, string> = {
  CASH: "À vista",
  SINGLE_TERM: "Prazo único",
  INSTALLMENTS: "Parcelas com peso igual",
  MISSING: "Condição não informada",
  AMBIGUOUS_WEIGHTS: "Peso das parcelas indeterminado (%, entrada, sinal…)",
  NEGATIVE_DAYS: "Dias negativos",
  OUT_OF_RANGE: `Prazo acima de ${GRANTED_PAYMENT_TERM_MAX_DAYS} dias`,
  TOO_MANY_INSTALLMENTS: `Mais de ${GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS} parcelas`,
  NON_INCREASING_SEQUENCE: "Sequência de parcelas repetida ou fora de ordem",
  UNRECOGNIZED_FORMAT: "Formato não interpretável",
};

export function describeGrantedPaymentTermReason(reason: GrantedPaymentTermParseReason): string {
  return GRANTED_PAYMENT_TERM_REASON_LABELS[reason] ?? reason;
}

/**
 * Normalização só para comparação: trim, espaços múltiplos, acentos e caixa.
 * Não altera semanticamente o conteúdo (não remove/insere números ou sinais).
 */
export function normalizeGrantedPaymentTermText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CASH_PATTERN = /^a ?vista$/;
/** Unidades aceitas após o(s) número(s): dias, dia, DDL, DD, D. */
const DAY_UNIT = "(?:dias|dia|ddl|dd|d)";
const SINGLE_TERM_PATTERN = new RegExp(`^(\\d+) ?${DAY_UNIT}?$`);
/** Números inteiros separados por "/", "-" ou "+" (espaços opcionais ao redor). */
const SEQUENCE_PATTERN = new RegExp(`^(\\d+(?: ?[/+-] ?\\d+)+) ?${DAY_UNIT}?$`);
const AMBIGUOUS_WEIGHTS_PATTERN = /%|\b(entrada|sinal|antecip\w*|adiant\w*)\b/;
const NEGATIVE_DAYS_PATTERN = /(^|[/+])\s*-\s*\d/;

function unrecognized(
  normalized: string,
  reason: GrantedPaymentTermParseReason
): GrantedPaymentTermParseResult {
  return { recognized: false, averageDays: null, installmentDays: [], normalized, reason };
}

function validateInstallmentDays(
  normalized: string,
  days: number[]
): GrantedPaymentTermParseResult | null {
  if (days.length > GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS) {
    return unrecognized(normalized, "TOO_MANY_INSTALLMENTS");
  }
  for (const value of days) {
    if (!Number.isFinite(value) || value < 0) return unrecognized(normalized, "NEGATIVE_DAYS");
    if (!Number.isSafeInteger(value) || value > GRANTED_PAYMENT_TERM_MAX_DAYS) {
      return unrecognized(normalized, "OUT_OF_RANGE");
    }
  }
  for (let i = 1; i < days.length; i += 1) {
    if (days[i]! <= days[i - 1]!) return unrecognized(normalized, "NON_INCREASING_SEQUENCE");
  }
  return null;
}

function recognized(
  normalized: string,
  installmentDays: number[],
  reason: GrantedPaymentTermParseReason
): GrantedPaymentTermParseResult {
  const total = installmentDays.reduce((sum, value) => sum + value, 0);
  const averageDays = total / installmentDays.length;
  if (!Number.isFinite(averageDays)) return unrecognized(normalized, "UNRECOGNIZED_FORMAT");
  return { recognized: true, averageDays, installmentDays, normalized, reason };
}

/**
 * Parser FAIL-CLOSED da condição comercial de pagamento (fallback para pedidos
 * faturados sem títulos válidos de CR).
 *
 * Reconhece apenas quando o texto COMPLETO é interpretável sem ambiguidade:
 *   "À vista" / "A vista" / "AVISTA"      → 0
 *   "0", "0 dias", "0 DDL"                → 0
 *   "30", "30 dias", "30 DDL"             → 30
 *   "30/60", "30 / 60", "30-60-90",
 *   "30 + 60 + 90", "30/60/90 dias"       → média simples das parcelas
 *
 * Rejeita (recognized=false, com motivo): null/vazio, percentuais, entrada/sinal/
 * antecipação, números negativos, dias acima do limite, sequências repetidas ou
 * decrescentes, separadores misturados e qualquer outro texto. Nunca extrai
 * números soltos de um texto livre e nunca produz NaN/Infinity.
 */
export function parseGrantedPaymentTerm(
  value: string | null | undefined
): GrantedPaymentTermParseResult {
  const normalized = normalizeGrantedPaymentTermText(value);
  if (!normalized) return unrecognized(normalized, "MISSING");

  if (CASH_PATTERN.test(normalized)) return recognized(normalized, [0], "CASH");

  const single = SINGLE_TERM_PATTERN.exec(normalized);
  if (single) {
    const days = Number(single[1]);
    const invalid = validateInstallmentDays(normalized, [days]);
    if (invalid) return invalid;
    return recognized(normalized, [days], days === 0 ? "CASH" : "SINGLE_TERM");
  }

  const sequence = SEQUENCE_PATTERN.exec(normalized);
  if (sequence) {
    const body = sequence[1]!;
    const separators = new Set(body.match(/[/+-]/g) ?? []);
    if (separators.size !== 1) return unrecognized(normalized, "UNRECOGNIZED_FORMAT");
    const days = body.split(/ ?[/+-] ?/).map((token) => Number(token));
    const invalid = validateInstallmentDays(normalized, days);
    if (invalid) return invalid;
    return recognized(normalized, days, "INSTALLMENTS");
  }

  if (AMBIGUOUS_WEIGHTS_PATTERN.test(normalized)) return unrecognized(normalized, "AMBIGUOUS_WEIGHTS");
  if (NEGATIVE_DAYS_PATTERN.test(normalized)) return unrecognized(normalized, "NEGATIVE_DAYS");
  return unrecognized(normalized, "UNRECOGNIZED_FORMAT");
}

// ---------------------------------------------------------------------------
// Prazo por título / por pedido (emissão da NF-e → vencimento do CR)
// ---------------------------------------------------------------------------

/** Título do Contas a Receber vinculado ao pedido via NF-e de origem. */
export type GrantedPaymentTermTitleInput = {
  /** Vencimento do título (NomusAccountsReceivable.dueDate). */
  dueDate: Date | null;
  /** Emissão da NF-e de origem (NomusNfe.xmlDhEmi; fallback dataProcessamento). */
  invoiceIssueDate: Date | null;
  /** Valor do título (amountReceivable). Só valores positivos pesam. */
  amount: number;
};

export type GrantedPaymentTermOrderInput = {
  id: string;
  /** SalesOrder.totalNetValue — peso do pedido na média geral (só > 0). */
  totalNetValue: number;
  /** SalesOrder.paymentTerms — fallback quando o pedido faturado não tem títulos válidos. */
  paymentTerms: string | null;
  /** Tem ao menos uma NF-e válida (processada, não cancelada) — mesma regra do filtro "Com NF". */
  invoiced: boolean;
  titles: GrantedPaymentTermTitleInput[];
};

export type GrantedPaymentTermOrderSource =
  | "RECEIVABLE_TITLES"
  | "COMMERCIAL_TERMS"
  | "NOT_INVOICED"
  | "NONE";

export type GrantedPaymentTermOrderResolution = {
  orderId: string;
  source: GrantedPaymentTermOrderSource;
  /** Prazo do pedido em dias (null quando não resolvido). */
  days: number | null;
  titlesUsed: number;
  titlesIgnored: number;
  /** Motivo do parser quando a condição comercial foi consultada. */
  reason: GrantedPaymentTermParseReason | null;
};

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Dias civis (calendário local) de `from` até `to`; ignora hora. */
export function civilDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Prazo de um título: vencimento − emissão da NF-e. Inválido (null) quando falta
 * data, o valor não é positivo, o prazo é negativo ou excede o limite defensivo.
 */
export function resolveReceivableTitleTermDays(title: GrantedPaymentTermTitleInput): number | null {
  if (!isValidDate(title.dueDate) || !isValidDate(title.invoiceIssueDate)) return null;
  if (!Number.isFinite(title.amount) || title.amount <= 0) return null;
  const days = civilDaysBetween(title.invoiceIssueDate, title.dueDate);
  if (!Number.isFinite(days) || days < 0 || days > GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS) return null;
  return days;
}

/** Prazo do pedido = média dos títulos válidos ponderada pelo valor de cada título. */
export function resolveOrderReceivableTermDays(
  titles: readonly GrantedPaymentTermTitleInput[]
): { days: number | null; titlesUsed: number; titlesIgnored: number } {
  let weightedDays = 0;
  let weight = 0;
  let titlesUsed = 0;
  let titlesIgnored = 0;
  for (const title of titles) {
    const days = resolveReceivableTitleTermDays(title);
    if (days == null) {
      titlesIgnored += 1;
      continue;
    }
    weightedDays += title.amount * days;
    weight += title.amount;
    titlesUsed += 1;
  }
  const days = weight > 0 ? weightedDays / weight : null;
  return {
    days: days != null && Number.isFinite(days) ? days : null,
    titlesUsed,
    titlesIgnored,
  };
}

/**
 * Prazo de um pedido: só faturados. Títulos do CR (fonte principal); sem títulos
 * válidos, a condição comercial interpretável (fallback); senão, não resolvido.
 */
export function resolveGrantedPaymentTermForOrder(
  order: GrantedPaymentTermOrderInput
): GrantedPaymentTermOrderResolution {
  if (!order.invoiced) {
    return {
      orderId: order.id,
      source: "NOT_INVOICED",
      days: null,
      titlesUsed: 0,
      titlesIgnored: 0,
      reason: null,
    };
  }
  const receivable = resolveOrderReceivableTermDays(order.titles);
  if (receivable.days != null) {
    return {
      orderId: order.id,
      source: "RECEIVABLE_TITLES",
      days: receivable.days,
      titlesUsed: receivable.titlesUsed,
      titlesIgnored: receivable.titlesIgnored,
      reason: null,
    };
  }
  const parsed = parseGrantedPaymentTerm(order.paymentTerms);
  if (parsed.recognized && parsed.averageDays != null) {
    return {
      orderId: order.id,
      source: "COMMERCIAL_TERMS",
      days: parsed.averageDays,
      titlesUsed: 0,
      titlesIgnored: receivable.titlesIgnored,
      reason: parsed.reason,
    };
  }
  return {
    orderId: order.id,
    source: "NONE",
    days: null,
    titlesUsed: 0,
    titlesIgnored: receivable.titlesIgnored,
    reason: parsed.reason,
  };
}

// ---------------------------------------------------------------------------
// Média geral (pedidos faturados, ponderada por SalesOrder.totalNetValue > 0)
// ---------------------------------------------------------------------------

export type GrantedPaymentTermSourceStats = {
  orders: number;
  salesAmount: number;
  /** % do valor líquido positivo FATURADO resolvido por esta fonte. */
  salesSharePercent: number;
  weightedAverageDays: number | null;
};

export type SalesOrderGrantedPaymentTermUnrecognizedTerm = {
  paymentTerms: string | null;
  orderCount: number;
  salesAmount: number;
  reason: GrantedPaymentTermParseReason;
  reasonLabel: string;
};

export type SalesOrderGrantedPaymentTermSummary = {
  /** false quando nenhum pedido faturado resolvido / sem população válida. */
  available: boolean;
  /** Dias, precisão interna (UI arredonda para 1 casa). null quando indisponível. */
  weightedAverageDays: number | null;
  /** % do valor líquido positivo FATURADO com prazo resolvido — cobertura PRINCIPAL. */
  coveragePercent: number;
  /** % dos pedidos faturados (com peso) com prazo resolvido. */
  orderCoveragePercent: number;
  quality: GrantedPaymentTermQuality;
  /** Pedidos da população filtrada (mesmo count da listagem). */
  totalOrders: number;
  /** Pedidos faturados com totalNetValue > 0 (população de ponderação). */
  weightedPopulationOrders: number;
  coveredOrders: number;
  uncoveredOrders: number;
  /** Pedidos filtrados fora do peso (totalNetValue <= 0) — auditoria. */
  zeroOrNegativeOrders: number;
  /** Pedidos com valor positivo ainda sem NF-e válida (não entram na média). */
  notInvoicedOrders: number;
  notInvoicedSalesAmount: number;
  /** Σ totalNetValue de todos os pedidos filtrados com valor positivo. */
  positiveSalesAmount: number;
  /** Σ totalNetValue dos pedidos faturados com valor positivo (denominador da cobertura). */
  invoicedSalesAmount: number;
  /** % do valor vendido positivo que já está faturado. */
  invoicedSharePercent: number;
  coveredSalesAmount: number;
  uncoveredSalesAmount: number;
  /** Quanto da média veio de títulos do CR e quanto da condição comercial. */
  sources: {
    receivableTitles: GrantedPaymentTermSourceStats;
    commercialTerms: GrantedPaymentTermSourceStats;
  };
  titlesUsed: number;
  titlesIgnored: number;
  source: typeof SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE;
  methodology: string;
  /** Faturados sem título válido e sem condição interpretável, agrupados por condição (valor desc). */
  unrecognizedTerms: SalesOrderGrantedPaymentTermUnrecognizedTerm[];
};

export function resolveGrantedPaymentTermQuality(coveragePercent: number): GrantedPaymentTermQuality {
  if (!Number.isFinite(coveragePercent) || coveragePercent <= 0) return "UNAVAILABLE";
  if (coveragePercent >= GRANTED_PAYMENT_TERM_FULL_COVERAGE_PERCENT) return "FULL";
  if (coveragePercent >= GRANTED_PAYMENT_TERM_PARTIAL_COVERAGE_PERCENT) return "PARTIAL";
  return "LOW";
}

function safePercent(part: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(part)) return 0;
  const percent = (part * 100) / total;
  return Number.isFinite(percent) ? percent : 0;
}

function safeAverage(weightedDays: number, weight: number): number | null {
  if (!(weight > 0)) return null;
  const average = weightedDays / weight;
  return Number.isFinite(average) ? average : null;
}

function compareUnrecognizedTerms(
  a: SalesOrderGrantedPaymentTermUnrecognizedTerm,
  b: SalesOrderGrantedPaymentTermUnrecognizedTerm
): number {
  if (b.salesAmount !== a.salesAmount) return b.salesAmount - a.salesAmount;
  if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
  return (a.paymentTerms ?? "").localeCompare(b.paymentTerms ?? "", "pt-BR");
}

function emptySourceStats(): GrantedPaymentTermSourceStats {
  return { orders: 0, salesAmount: 0, salesSharePercent: 0, weightedAverageDays: null };
}

export function buildEmptySalesOrderGrantedPaymentTermSummary(
  totalOrders = 0
): SalesOrderGrantedPaymentTermSummary {
  const total = Math.max(0, Number.isFinite(totalOrders) ? Math.trunc(totalOrders) : 0);
  return {
    available: false,
    weightedAverageDays: null,
    coveragePercent: 0,
    orderCoveragePercent: 0,
    quality: "UNAVAILABLE",
    totalOrders: total,
    weightedPopulationOrders: 0,
    coveredOrders: 0,
    uncoveredOrders: 0,
    zeroOrNegativeOrders: total,
    notInvoicedOrders: 0,
    notInvoicedSalesAmount: 0,
    positiveSalesAmount: 0,
    invoicedSalesAmount: 0,
    invoicedSharePercent: 0,
    coveredSalesAmount: 0,
    uncoveredSalesAmount: 0,
    sources: { receivableTitles: emptySourceStats(), commercialTerms: emptySourceStats() },
    titlesUsed: 0,
    titlesIgnored: 0,
    source: SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
    methodology: SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
    unrecognizedTerms: [],
  };
}

type SourceAccumulator = { orders: number; salesAmount: number; weightedDays: number };

/**
 * Média geral pura: `orders` é a população filtrada completa da listagem (mesmo
 * where), cada um com seus títulos de CR já vinculados. Pedidos com
 * totalNetValue <= 0 não pesam (auditoria em `zeroOrNegativeOrders`); pedidos
 * sem NF-e válida não entram na média nem na cobertura (`notInvoiced*`).
 */
export function computeSalesOrderGrantedPaymentTermSummary(
  orders: readonly GrantedPaymentTermOrderInput[],
  options?: { unrecognizedTopLimit?: number }
): SalesOrderGrantedPaymentTermSummary {
  const topLimit = Math.max(
    0,
    Math.trunc(options?.unrecognizedTopLimit ?? GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT)
  );

  let weightedPopulationOrders = 0;
  let zeroOrNegativeOrders = 0;
  let notInvoicedOrders = 0;
  let notInvoicedSalesAmount = 0;
  let coveredOrders = 0;
  let uncoveredOrders = 0;
  let coveredSalesAmount = 0;
  let uncoveredSalesAmount = 0;
  let weightedDays = 0;
  let titlesUsed = 0;
  let titlesIgnored = 0;
  const bySource: Record<"RECEIVABLE_TITLES" | "COMMERCIAL_TERMS", SourceAccumulator> = {
    RECEIVABLE_TITLES: { orders: 0, salesAmount: 0, weightedDays: 0 },
    COMMERCIAL_TERMS: { orders: 0, salesAmount: 0, weightedDays: 0 },
  };
  const unrecognizedByTerms = new Map<string | null, SalesOrderGrantedPaymentTermUnrecognizedTerm>();

  for (const order of orders) {
    const weight = Number.isFinite(order.totalNetValue) ? order.totalNetValue : 0;
    // Só valor líquido POSITIVO pesa. Zero/negativo não distorce nem entra no denominador.
    if (weight <= 0) {
      zeroOrNegativeOrders += 1;
      continue;
    }
    const resolution = resolveGrantedPaymentTermForOrder(order);
    if (resolution.source === "NOT_INVOICED") {
      notInvoicedOrders += 1;
      notInvoicedSalesAmount += weight;
      continue;
    }

    weightedPopulationOrders += 1;
    titlesUsed += resolution.titlesUsed;
    titlesIgnored += resolution.titlesIgnored;

    if (resolution.source === "NONE" || resolution.days == null) {
      uncoveredOrders += 1;
      uncoveredSalesAmount += weight;
      const key = order.paymentTerms ?? null;
      const reason = resolution.reason ?? "UNRECOGNIZED_FORMAT";
      const existing = unrecognizedByTerms.get(key);
      if (existing) {
        existing.orderCount += 1;
        existing.salesAmount += weight;
      } else {
        unrecognizedByTerms.set(key, {
          paymentTerms: key,
          orderCount: 1,
          salesAmount: weight,
          reason,
          reasonLabel: describeGrantedPaymentTermReason(reason),
        });
      }
      continue;
    }

    coveredOrders += 1;
    coveredSalesAmount += weight;
    weightedDays += weight * resolution.days;
    const acc = bySource[resolution.source];
    acc.orders += 1;
    acc.salesAmount += weight;
    acc.weightedDays += weight * resolution.days;
  }

  const invoicedSalesAmount = coveredSalesAmount + uncoveredSalesAmount;
  const positiveSalesAmount = invoicedSalesAmount + notInvoicedSalesAmount;
  const coveragePercent = safePercent(coveredSalesAmount, invoicedSalesAmount);
  const orderCoveragePercent = safePercent(coveredOrders, weightedPopulationOrders);
  const weightedAverageDays = safeAverage(weightedDays, coveredSalesAmount);
  const quality =
    weightedAverageDays == null ? "UNAVAILABLE" : resolveGrantedPaymentTermQuality(coveragePercent);

  const toStats = (acc: SourceAccumulator): GrantedPaymentTermSourceStats => ({
    orders: acc.orders,
    salesAmount: acc.salesAmount,
    salesSharePercent: safePercent(acc.salesAmount, invoicedSalesAmount),
    weightedAverageDays: safeAverage(acc.weightedDays, acc.salesAmount),
  });

  const unrecognizedTerms = [...unrecognizedByTerms.values()].sort(compareUnrecognizedTerms);

  return {
    available: quality !== "UNAVAILABLE",
    weightedAverageDays: quality === "UNAVAILABLE" ? null : weightedAverageDays,
    coveragePercent,
    orderCoveragePercent,
    quality,
    totalOrders: orders.length,
    weightedPopulationOrders,
    coveredOrders,
    uncoveredOrders,
    zeroOrNegativeOrders,
    notInvoicedOrders,
    notInvoicedSalesAmount,
    positiveSalesAmount,
    invoicedSalesAmount,
    invoicedSharePercent: safePercent(invoicedSalesAmount, positiveSalesAmount),
    coveredSalesAmount,
    uncoveredSalesAmount,
    sources: {
      receivableTitles: toStats(bySource.RECEIVABLE_TITLES),
      commercialTerms: toStats(bySource.COMMERCIAL_TERMS),
    },
    titlesUsed,
    titlesIgnored,
    source: SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
    methodology: SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
    unrecognizedTerms: unrecognizedTerms.slice(0, topLimit),
  };
}

// ---------------------------------------------------------------------------
// Apresentação (card) — sem aritmética de negócio no React
// ---------------------------------------------------------------------------

export const GRANTED_PAYMENT_TERM_CARD_LABEL = "Prazo médio de recebimento";
export const GRANTED_PAYMENT_TERM_CARD_TEST_ID = "sales-order-list-average-payment-term-card";
export const GRANTED_PAYMENT_TERM_HELP_TEXT =
  "Dias entre a emissão da NF-e e o vencimento dos títulos do Contas a Receber vinculados ao pedido, " +
  "ponderados pelo valor dos títulos; média geral ponderada pelo valor líquido dos pedidos faturados do filtro. " +
  "Pedidos sem NF-e não entram (ainda não há recebimento a medir); pedidos faturados sem títulos usam a " +
  "condição comercial de pagamento quando interpretável (ex.: 30/60 = 45 dias). " +
  "Não mede atraso nem data real de recebimento.";
export const GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT =
  `${GRANTED_PAYMENT_TERM_HELP_TEXT} Pedidos faturados sem título de CR e sem condição interpretável foram excluídos da média.`;
export const GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL = "Cobertura insuficiente";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL = "Indisponível";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE = "Sem títulos ou condições de pagamento suficientes";
export const GRANTED_PAYMENT_TERM_NOT_INVOICED_SUBTITLE = "Sem pedidos faturados no filtro";
export const GRANTED_PAYMENT_TERM_LOAD_ERROR_SUBTITLE = "Não foi possível carregar o indicador.";

const oneDecimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 47,84 → "47,8 dias"; 0 → "0,0 dias"; inválido → "—". */
export function formatGrantedPaymentTermDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  return `${oneDecimalFormatter.format(days)} dias`;
}

/** 96,44 → "96,4%"; inválido → "—". */
export function formatGrantedPaymentTermCoverage(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${oneDecimalFormatter.format(percent)}%`;
}

/**
 * Participação do valor faturado no valor vendido do filtro. Vai para o TOOLTIP
 * do card (não ocupa linha no card, que mantém a mesma altura dos demais).
 */
export function buildGrantedPaymentTermInvoicedShareText(
  summary: SalesOrderGrantedPaymentTermSummary | null | undefined
): string | null {
  if (!summary || !(summary.positiveSalesAmount > 0)) return null;
  return (
    `Faturado: ${formatGrantedPaymentTermCoverage(summary.invoicedSharePercent)} do valor vendido ` +
    "(pedidos sem NF-e ainda não entram na média)."
  );
}

/**
 * Tooltip do card: primeiro os números do filtro (participação do faturado,
 * fontes títulos do CR × condição comercial, prazo não confiável quando a
 * cobertura é baixa), depois a metodologia.
 */
export function buildGrantedPaymentTermHelpText(
  summary: SalesOrderGrantedPaymentTermSummary | null | undefined,
  quality: GrantedPaymentTermQuality
): string {
  const methodology =
    quality === "PARTIAL" || quality === "LOW"
      ? GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT
      : GRANTED_PAYMENT_TERM_HELP_TEXT;
  const facts: string[] = [];
  const invoicedShare = buildGrantedPaymentTermInvoicedShareText(summary);
  if (invoicedShare) facts.push(invoicedShare);
  if (summary && summary.coveredSalesAmount > 0) {
    const titles = formatGrantedPaymentTermCoverage(summary.sources.receivableTitles.salesSharePercent);
    const terms = formatGrantedPaymentTermCoverage(summary.sources.commercialTerms.salesSharePercent);
    facts.push(`Fonte: títulos do CR em ${titles} do valor faturado; condição comercial em ${terms}.`);
    if (quality === "LOW" && summary.weightedAverageDays != null) {
      facts.push(
        `Prazo calculado só sobre a parte coberta: ${formatGrantedPaymentTermDays(summary.weightedAverageDays)} (não confiável).`
      );
    }
  }
  return facts.length > 0 ? `${facts.join("\n")}\n\n${methodology}` : methodology;
}

export type GrantedPaymentTermCardTone = "info" | "warning" | "neutral";

export type GrantedPaymentTermCardPresentation = {
  quality: GrantedPaymentTermQuality;
  value: string;
  valueSize: "default" | "text";
  subtitle: string;
  tone: GrantedPaymentTermCardTone;
  helperText: string;
};

/**
 * Estado visual do card por qualidade (cobertura = % do valor FATURADO com prazo):
 *   FULL        → "47,8 dias" / "Cobertura: 98,2% do valor faturado" (info)
 *   PARTIAL     → "47,8 dias" / "Cobertura parcial: 89,4% do faturado" (warning)
 *   LOW         → "Cobertura insuficiente" / "Cobertura: 54,1% do faturado" (warning) — número só no tooltip
 *   UNAVAILABLE → "Indisponível" / "Sem pedidos faturados no filtro" ou
 *                 "Sem títulos ou condições de pagamento suficientes" (neutral)
 *   null (endpoint falhou) → "Indisponível" / "Não foi possível carregar o indicador." (neutral)
 * Tooltip: participação do faturado, fontes (títulos do CR × condição comercial) e
 * metodologia. O card não tem linha extra: mantém a altura dos demais da faixa.
 */
export function resolveGrantedPaymentTermCardPresentation(
  summary: SalesOrderGrantedPaymentTermSummary | null | undefined
): GrantedPaymentTermCardPresentation {
  if (!summary) {
    return {
      quality: "UNAVAILABLE",
      value: GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL,
      valueSize: "text",
      subtitle: GRANTED_PAYMENT_TERM_LOAD_ERROR_SUBTITLE,
      tone: "neutral",
      helperText: GRANTED_PAYMENT_TERM_HELP_TEXT,
    };
  }

  const days = summary.weightedAverageDays;
  const usable = summary.available && days != null && Number.isFinite(days);
  const quality: GrantedPaymentTermQuality = usable ? summary.quality : "UNAVAILABLE";
  const coverage = formatGrantedPaymentTermCoverage(summary.coveragePercent);
  const helperText = buildGrantedPaymentTermHelpText(summary, quality);

  switch (quality) {
    case "FULL":
      return {
        quality,
        value: formatGrantedPaymentTermDays(days),
        valueSize: "default",
        subtitle: `Cobertura: ${coverage} do valor faturado`,
        tone: "info",
        helperText,
      };
    case "PARTIAL":
      return {
        quality,
        value: formatGrantedPaymentTermDays(days),
        valueSize: "default",
        subtitle: `Cobertura parcial: ${coverage} do faturado`,
        tone: "warning",
        helperText,
      };
    case "LOW":
      return {
        quality,
        value: GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL,
        valueSize: "text",
        subtitle: `Cobertura: ${coverage} do faturado`,
        tone: "warning",
        helperText,
      };
    default:
      return {
        quality: "UNAVAILABLE",
        value: GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL,
        valueSize: "text",
        subtitle:
          summary.weightedPopulationOrders === 0 && summary.positiveSalesAmount > 0
            ? GRANTED_PAYMENT_TERM_NOT_INVOICED_SUBTITLE
            : GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE,
        tone: "neutral",
        helperText,
      };
  }
}

// ---------------------------------------------------------------------------
// Série mensal (12 meses × mesmo período do ano anterior) — tela Resultado
// ---------------------------------------------------------------------------

export const GRANTED_PAYMENT_TERM_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export const SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_METHODOLOGY =
  "Mês = emissão do pedido (SalesOrder.issueDate), a mesma base do filtro Ano/Mês. Cada mês usa o mesmo " +
  "cálculo do card: prazo por título = vencimento do CR menos a emissão da NF-e, média do pedido ponderada " +
  "pelo valor dos títulos e média do mês ponderada pelo valor líquido dos pedidos faturados. A barra só " +
  "aparece com cobertura de pelo menos 80% do valor faturado. Aplica os filtros da tela, exceto Mês " +
  "(visão de 12 meses comparada ao mesmo período do ano anterior).";

/** Pedido da população com a data de emissão (base do mês na série mensal). */
export type GrantedPaymentTermDatedOrderInput = GrantedPaymentTermOrderInput & {
  issueDate: Date | null;
};

export type SalesOrderGrantedPaymentTermMonthlyPoint = {
  /** Valor da barra: só com qualidade FULL/PARTIAL (mesma regra do card); null = sem barra. */
  chartDays: number | null;
  /** Prazo calculado mesmo com cobertura baixa — só para auditoria/tooltip. */
  weightedAverageDays: number | null;
  quality: GrantedPaymentTermQuality;
  coveragePercent: number;
  invoicedSharePercent: number;
  totalOrders: number;
  invoicedOrders: number;
  coveredOrders: number;
  invoicedSalesAmount: number;
};

export type SalesOrderGrantedPaymentTermMonthlyRow = {
  month: number;
  monthLabel: string;
  current: SalesOrderGrantedPaymentTermMonthlyPoint;
  previous: SalesOrderGrantedPaymentTermMonthlyPoint;
};

export type SalesOrderGrantedPaymentTermMonthlySeries = {
  year: number;
  previousYear: number;
  /** Base do mês: emissão do pedido (mesma do filtro Ano/Mês da listagem). */
  monthBasis: "SalesOrder.issueDate";
  rows: SalesOrderGrantedPaymentTermMonthlyRow[];
  currentYearSummary: SalesOrderGrantedPaymentTermSummary;
  previousYearSummary: SalesOrderGrantedPaymentTermSummary;
  /** Período selecionado × mesmas datas do ano anterior (cards acima do gráfico). */
  periodComparison: SalesOrderGrantedPaymentTermPeriodComparison;
  source: typeof SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE;
  methodology: string;
};

/** Barra do gráfico só quando o card também mostraria o número (FULL/PARTIAL). */
export function resolveGrantedPaymentTermChartDays(
  summary: SalesOrderGrantedPaymentTermSummary
): number | null {
  if (!summary.available) return null;
  if (summary.quality !== "FULL" && summary.quality !== "PARTIAL") return null;
  const days = summary.weightedAverageDays;
  return days != null && Number.isFinite(days) ? days : null;
}

function toGrantedPaymentTermMonthlyPoint(
  summary: SalesOrderGrantedPaymentTermSummary
): SalesOrderGrantedPaymentTermMonthlyPoint {
  return {
    chartDays: resolveGrantedPaymentTermChartDays(summary),
    weightedAverageDays: summary.weightedAverageDays,
    quality: summary.quality,
    coveragePercent: summary.coveragePercent,
    invoicedSharePercent: summary.invoicedSharePercent,
    totalOrders: summary.totalOrders,
    invoicedOrders: summary.weightedPopulationOrders,
    coveredOrders: summary.coveredOrders,
    invoicedSalesAmount: summary.invoicedSalesAmount,
  };
}

function bucketGrantedPaymentTermOrdersByIssueMonth(
  orders: readonly GrantedPaymentTermDatedOrderInput[],
  year: number
): GrantedPaymentTermDatedOrderInput[][] {
  const buckets: GrantedPaymentTermDatedOrderInput[][] = Array.from({ length: 12 }, () => []);
  for (const order of orders) {
    const date = order.issueDate;
    if (!isValidDate(date)) continue;
    if (date.getFullYear() !== year) continue;
    buckets[date.getMonth()]!.push(order);
  }
  return buckets;
}

/**
 * Série mensal pura. Cada mês usa EXATAMENTE o cálculo do card
 * (`computeSalesOrderGrantedPaymentTermSummary`) sobre os pedidos emitidos no mês:
 * o ponto de set/2026 é igual ao card filtrado em Ano 2026 + Mês Setembro com os
 * mesmos demais filtros. O resumo anual usa a população inteira de cada ano.
 */
export function buildSalesOrderGrantedPaymentTermMonthlySeries(input: {
  year: number;
  currentYearOrders: readonly GrantedPaymentTermDatedOrderInput[];
  previousYearOrders: readonly GrantedPaymentTermDatedOrderInput[];
  /** Mês selecionado na tela (1–12) ou null = ano inteiro (acumulado). Só afeta os cards. */
  month?: number | null;
  /** Data de referência (hoje) para cortar o período em andamento; default = fim do ano. */
  referenceDate?: Date;
}): SalesOrderGrantedPaymentTermMonthlySeries {
  const previousYear = input.year - 1;
  const currentBuckets = bucketGrantedPaymentTermOrdersByIssueMonth(input.currentYearOrders, input.year);
  const previousBuckets = bucketGrantedPaymentTermOrdersByIssueMonth(
    input.previousYearOrders,
    previousYear
  );
  const rows = GRANTED_PAYMENT_TERM_MONTH_LABELS.map((monthLabel, index) => ({
    month: index + 1,
    monthLabel,
    current: toGrantedPaymentTermMonthlyPoint(
      computeSalesOrderGrantedPaymentTermSummary(currentBuckets[index]!)
    ),
    previous: toGrantedPaymentTermMonthlyPoint(
      computeSalesOrderGrantedPaymentTermSummary(previousBuckets[index]!)
    ),
  }));
  return {
    year: input.year,
    previousYear,
    monthBasis: "SalesOrder.issueDate",
    rows,
    currentYearSummary: computeSalesOrderGrantedPaymentTermSummary(input.currentYearOrders),
    previousYearSummary: computeSalesOrderGrantedPaymentTermSummary(input.previousYearOrders),
    periodComparison: buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: input.year,
      month: input.month ?? null,
      referenceDate: input.referenceDate ?? new Date(input.year, 11, 31),
      currentYearOrders: input.currentYearOrders,
      previousYearOrders: input.previousYearOrders,
    }),
    source: SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
    methodology: SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_METHODOLOGY,
  };
}

const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Rótulo curto em cima da barra: 35,94 → "36". */
export function formatGrantedPaymentTermChartLabel(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "";
  return integerFormatter.format(days);
}

/** Linha do tooltip de um mês/ano do gráfico (sem aritmética no React). */
export function describeGrantedPaymentTermMonthlyPoint(
  point: SalesOrderGrantedPaymentTermMonthlyPoint
): string {
  if (point.totalOrders === 0) return "Sem pedidos";
  if (point.invoicedOrders === 0) return "Sem pedidos faturados";
  const coverage = formatGrantedPaymentTermCoverage(point.coveragePercent);
  if (point.chartDays != null) {
    const partial = point.quality === "PARTIAL" ? " (parcial)" : "";
    return `${formatGrantedPaymentTermDays(point.chartDays)} · cobertura ${coverage} do faturado${partial} · ${point.invoicedOrders} pedido(s) faturado(s)`;
  }
  if (point.quality === "LOW") return `Cobertura insuficiente (${coverage} do faturado)`;
  return GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE;
}

/** Resumo anual exibido no cabeçalho do gráfico (mesma regra de exibição do card). */
export function describeGrantedPaymentTermYearSummary(
  summary: SalesOrderGrantedPaymentTermSummary
): string {
  const days = resolveGrantedPaymentTermChartDays(summary);
  if (days != null) return formatGrantedPaymentTermDays(days);
  if (summary.available && summary.quality === "LOW") return GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL;
  return GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL;
}

// ---------------------------------------------------------------------------
// Período selecionado × mesmo período do ano anterior (cards acima do gráfico)
// ---------------------------------------------------------------------------

/** Menos dias = recebimento mais rápido = MELHOR. */
export type GrantedPaymentTermTrend = "BETTER" | "WORSE" | "EQUAL" | "UNAVAILABLE";

export type SalesOrderGrantedPaymentTermPeriodSide = {
  year: number;
  /** Datas civis inclusivas (YYYY-MM-DD) pela emissão do pedido. */
  from: string;
  to: string;
  /** "01/01 a 25/09/2026". */
  label: string;
  /** Prazo exibível (FULL/PARTIAL, mesma regra do card); null = sem número. */
  displayDays: number | null;
  summary: SalesOrderGrantedPaymentTermSummary;
};

export type SalesOrderGrantedPaymentTermPeriodComparison = {
  basis: "SalesOrder.issueDate";
  /** Mês selecionado (1–12) ou null = ano (acumulado até a data de referência). */
  month: number | null;
  current: SalesOrderGrantedPaymentTermPeriodSide;
  previous: SalesOrderGrantedPaymentTermPeriodSide;
  /** Dias do período atual − dias do mesmo período do ano anterior (null sem os dois). */
  deltaDays: number | null;
  trend: GrantedPaymentTermTrend;
};

type CivilRange = { from: Date; to: Date };

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function startOfCivilDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftCivilDateOneYearBack(date: Date): Date {
  const year = date.getFullYear() - 1;
  const monthIndex = date.getMonth();
  return new Date(year, monthIndex, Math.min(date.getDate(), lastDayOfMonth(year, monthIndex)));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCivilKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatCivilRangeLabel(range: CivilRange): string {
  const to = `${pad2(range.to.getDate())}/${pad2(range.to.getMonth() + 1)}/${range.to.getFullYear()}`;
  if (range.from.getTime() === range.to.getTime()) return to;
  return `${pad2(range.from.getDate())}/${pad2(range.from.getMonth() + 1)} a ${to}`;
}

function normalizeSelectedMonth(month: number | null | undefined): number | null {
  return month != null && Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

/**
 * Períodos comparados (datas civis inclusivas, pela emissão do pedido):
 *   - sem Mês: 01/01 do ano até a data de referência (acumulado); ano já
 *     encerrado → ano inteiro;
 *   - com Mês: o mês inteiro; mês em andamento → até a data de referência;
 *   - ano anterior: as MESMAS datas um ano antes (29/02 → 28/02).
 * Período que ainda não começou fica inteiro (sem pedidos → sem número).
 */
export function resolveGrantedPaymentTermComparisonRanges(input: {
  year: number;
  month: number | null;
  referenceDate: Date;
}): { current: CivilRange; previous: CivilRange } {
  const month = normalizeSelectedMonth(input.month);
  const start = month == null ? new Date(input.year, 0, 1) : new Date(input.year, month - 1, 1);
  const end =
    month == null
      ? new Date(input.year, 11, 31)
      : new Date(input.year, month - 1, lastDayOfMonth(input.year, month - 1));
  const reference = startOfCivilDay(input.referenceDate);
  const currentEnd =
    reference.getTime() >= start.getTime() && reference.getTime() < end.getTime() ? reference : end;
  return {
    current: { from: start, to: currentEnd },
    previous: {
      from: shiftCivilDateOneYearBack(start),
      to: shiftCivilDateOneYearBack(currentEnd),
    },
  };
}

function filterGrantedPaymentTermOrdersByRange(
  orders: readonly GrantedPaymentTermDatedOrderInput[],
  range: CivilRange
): GrantedPaymentTermDatedOrderInput[] {
  const from = range.from.getTime();
  const toExclusive = new Date(
    range.to.getFullYear(),
    range.to.getMonth(),
    range.to.getDate() + 1
  ).getTime();
  return orders.filter((order) => {
    const date = order.issueDate;
    if (!isValidDate(date)) return false;
    const time = date.getTime();
    return time >= from && time < toExclusive;
  });
}

/** Tendência pelo delta arredondado a 1 casa (mesma precisão exibida). */
export function resolveGrantedPaymentTermTrend(deltaDays: number | null): GrantedPaymentTermTrend {
  if (deltaDays == null || !Number.isFinite(deltaDays)) return "UNAVAILABLE";
  const rounded = Math.round(deltaDays * 10) / 10;
  if (rounded < 0) return "BETTER";
  if (rounded > 0) return "WORSE";
  return "EQUAL";
}

/**
 * Comparação pura do período selecionado com as mesmas datas do ano anterior,
 * usando o MESMO cálculo do card sobre os pedidos emitidos em cada período.
 */
export function buildSalesOrderGrantedPaymentTermPeriodComparison(input: {
  year: number;
  month: number | null;
  referenceDate: Date;
  currentYearOrders: readonly GrantedPaymentTermDatedOrderInput[];
  previousYearOrders: readonly GrantedPaymentTermDatedOrderInput[];
}): SalesOrderGrantedPaymentTermPeriodComparison {
  const month = normalizeSelectedMonth(input.month);
  const ranges = resolveGrantedPaymentTermComparisonRanges({
    year: input.year,
    month,
    referenceDate: input.referenceDate,
  });
  const side = (
    year: number,
    range: CivilRange,
    orders: readonly GrantedPaymentTermDatedOrderInput[]
  ): SalesOrderGrantedPaymentTermPeriodSide => {
    const summary = computeSalesOrderGrantedPaymentTermSummary(
      filterGrantedPaymentTermOrdersByRange(orders, range)
    );
    return {
      year,
      from: formatCivilKey(range.from),
      to: formatCivilKey(range.to),
      label: formatCivilRangeLabel(range),
      displayDays: resolveGrantedPaymentTermChartDays(summary),
      summary,
    };
  };
  const current = side(input.year, ranges.current, input.currentYearOrders);
  const previous = side(input.year - 1, ranges.previous, input.previousYearOrders);
  const deltaDays =
    current.displayDays != null && previous.displayDays != null
      ? current.displayDays - previous.displayDays
      : null;
  return {
    basis: "SalesOrder.issueDate",
    month,
    current,
    previous,
    deltaDays,
    trend: resolveGrantedPaymentTermTrend(deltaDays),
  };
}

const signedOneDecimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** −0,4 → "−0,4 dias"; 3,24 → "+3,2 dias"; 0 → "0,0 dias". */
export function formatGrantedPaymentTermDeltaDays(deltaDays: number | null | undefined): string {
  if (deltaDays == null || !Number.isFinite(deltaDays)) return "—";
  const rounded = Math.round(deltaDays * 10) / 10;
  const text = signedOneDecimalFormatter.format(Math.abs(rounded));
  if (rounded < 0) return `−${text} dias`;
  if (rounded > 0) return `+${text} dias`;
  return `${text} dias`;
}

export type GrantedPaymentTermPeriodCardTone = "success" | "danger" | "info" | "neutral";

export type GrantedPaymentTermPeriodCardPresentation = {
  label: string;
  value: string;
  valueSize: "default" | "text";
  subtitle: string;
  tone: GrantedPaymentTermPeriodCardTone;
  badgeLabel: string;
  badgeTone: GrantedPaymentTermPeriodCardTone;
  helperText: string;
};

function periodSideValue(side: SalesOrderGrantedPaymentTermPeriodSide): {
  value: string;
  valueSize: "default" | "text";
} {
  if (side.displayDays != null) {
    return { value: formatGrantedPaymentTermDays(side.displayDays), valueSize: "default" };
  }
  if (side.summary.available && side.summary.quality === "LOW") {
    return { value: GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL, valueSize: "text" };
  }
  return { value: GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL, valueSize: "text" };
}

function periodSideSubtitle(side: SalesOrderGrantedPaymentTermPeriodSide): string {
  if (side.summary.weightedPopulationOrders === 0) return `${side.label} · sem pedidos faturados`;
  return `${side.label} · cobertura ${formatGrantedPaymentTermCoverage(side.summary.coveragePercent)} do faturado`;
}

function appendInvoicedShare(text: string, side: SalesOrderGrantedPaymentTermPeriodSide): string {
  const share = buildGrantedPaymentTermInvoicedShareText(side.summary);
  return share ? `${text}\n${share}` : text;
}

const TREND_TONE: Record<GrantedPaymentTermTrend, GrantedPaymentTermPeriodCardTone> = {
  BETTER: "success",
  WORSE: "danger",
  EQUAL: "info",
  UNAVAILABLE: "neutral",
};

/**
 * Os dois cards acima do gráfico (sem cálculo no React):
 *   - atual: "Prazo médio 2026 · acumulado" (ou "Prazo médio Set/2026"), selo com o
 *     delta contra o ano anterior (verde = melhor/menos dias, vermelho = pior);
 *   - anterior: "Mesmo período 2025", selo "Base da comparação".
 */
export function resolveGrantedPaymentTermPeriodCards(
  comparison: SalesOrderGrantedPaymentTermPeriodComparison
): { current: GrantedPaymentTermPeriodCardPresentation; previous: GrantedPaymentTermPeriodCardPresentation } {
  const { current, previous } = comparison;
  const monthLabel =
    comparison.month != null ? GRANTED_PAYMENT_TERM_MONTH_LABELS[comparison.month - 1] : null;
  const delta = formatGrantedPaymentTermDeltaDays(comparison.deltaDays);
  const badgeLabel: Record<GrantedPaymentTermTrend, string> = {
    BETTER: `${delta} vs ${previous.year} · melhor`,
    WORSE: `${delta} vs ${previous.year} · pior`,
    EQUAL: `Igual a ${previous.year}`,
    UNAVAILABLE: "Sem base de comparação",
  };
  return {
    current: {
      label: monthLabel ? `Prazo médio ${monthLabel}/${current.year}` : `Prazo médio ${current.year} · acumulado`,
      ...periodSideValue(current),
      subtitle: periodSideSubtitle(current),
      tone: TREND_TONE[comparison.trend],
      badgeLabel: badgeLabel[comparison.trend],
      badgeTone: TREND_TONE[comparison.trend],
      helperText: appendInvoicedShare(
        `Prazo médio de recebimento dos pedidos emitidos de ${current.label}, com os filtros da tela e o ` +
          `mesmo cálculo do card da listagem. Comparado com as mesmas datas de ${previous.year}: menos dias = ` +
          "recebimento mais rápido = melhor.",
        current
      ),
    },
    previous: {
      label: `Mesmo período ${previous.year}`,
      ...periodSideValue(previous),
      subtitle: periodSideSubtitle(previous),
      tone: "neutral",
      badgeLabel: "Base da comparação",
      badgeTone: "neutral",
      helperText: appendInvoicedShare(
        `Pedidos emitidos de ${previous.label}: as mesmas datas do período selecionado, um ano antes, com os ` +
          "mesmos filtros.",
        previous
      ),
    },
  };
}
