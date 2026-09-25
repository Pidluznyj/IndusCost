/**
 * Prazo médio de recebimento — listagem Comercial de Pedidos de Venda.
 *
 * Motor PURO (sem Prisma, sem React, sem Node).
 *
 * Definição (revisão 2026-09-25): o prazo de um título é o número de dias entre a
 * DATA DE EMISSÃO DA NF-e de origem e o VENCIMENTO do título do Contas a Receber
 * (SalesOrder → SalesOrderNfeLink → NomusNfe.xmlDhEmi / NomusAccountsReceivable.dueDate).
 * O prazo do pedido é a média dos seus títulos ponderada pelo valor de cada título.
 * O prazo médio geral é a média dos pedidos filtrados ponderada por
 * `SalesOrder.totalNetValue` (somente valores positivos).
 *
 * Pedidos ainda sem títulos de CR usam, como fallback declarado, a condição
 * comercial de pagamento (`SalesOrder.paymentTerms`) interpretada por um parser
 * fail-closed ("30/60" → 45; "À vista" → 0). Pedidos sem título e sem condição
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
  "pedidos filtrados ponderada pelo valor líquido (SalesOrder.totalNetValue > 0). Pedidos sem títulos usam " +
  "SalesOrder.paymentTerms quando interpretável (média das parcelas). Pedidos sem título e sem condição " +
  "interpretável são excluídos e refletidos na cobertura. Não considera liquidação nem atraso.";

/** Limite superior defensivo de dias por parcela da condição comercial. */
export const GRANTED_PAYMENT_TERM_MAX_DAYS = 365;
/** Limite defensivo de parcelas numa condição comercial. */
export const GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS = 24;
/** Limite defensivo de dias entre emissão da NF-e e vencimento do título (2 anos). */
export const GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS = 730;

/** Qualidade por cobertura (% do valor líquido positivo com prazo resolvido). */
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
 * ainda sem títulos de CR).
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
  /** SalesOrder.paymentTerms — fallback quando o pedido não tem títulos válidos. */
  paymentTerms: string | null;
  titles: GrantedPaymentTermTitleInput[];
};

export type GrantedPaymentTermOrderSource = "RECEIVABLE_TITLES" | "COMMERCIAL_TERMS" | "NONE";

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
 * Prazo de um pedido: títulos do CR (fonte principal); sem títulos válidos, a
 * condição comercial interpretável (fallback); senão, não resolvido.
 */
export function resolveGrantedPaymentTermForOrder(
  order: GrantedPaymentTermOrderInput
): GrantedPaymentTermOrderResolution {
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
// Média geral (ponderada por SalesOrder.totalNetValue > 0)
// ---------------------------------------------------------------------------

export type GrantedPaymentTermSourceStats = {
  orders: number;
  salesAmount: number;
  /** % do valor líquido positivo dos pedidos filtrados resolvido por esta fonte. */
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
  /** false quando nenhum pedido resolvido / sem população válida. */
  available: boolean;
  /** Dias, precisão interna (UI arredonda para 1 casa). null quando indisponível. */
  weightedAverageDays: number | null;
  /** % do valor líquido positivo com prazo resolvido — cobertura PRINCIPAL. */
  coveragePercent: number;
  /** % dos pedidos (com peso) com prazo resolvido. */
  orderCoveragePercent: number;
  quality: GrantedPaymentTermQuality;
  /** Pedidos da população filtrada (mesmo count da listagem). */
  totalOrders: number;
  /** Pedidos com totalNetValue > 0 (população de ponderação). */
  weightedPopulationOrders: number;
  coveredOrders: number;
  uncoveredOrders: number;
  /** Pedidos filtrados fora do peso (totalNetValue <= 0) — auditoria. */
  zeroOrNegativeOrders: number;
  totalWeightedSalesAmount: number;
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
  /** Pedidos sem título válido e sem condição interpretável, agrupados por condição (valor desc). */
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
    totalWeightedSalesAmount: 0,
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
 * totalNetValue <= 0 não pesam nem entram no denominador (auditoria em
 * `zeroOrNegativeOrders`).
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
    weightedPopulationOrders += 1;
    const resolution = resolveGrantedPaymentTermForOrder(order);
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

  const totalWeightedSalesAmount = coveredSalesAmount + uncoveredSalesAmount;
  const coveragePercent = safePercent(coveredSalesAmount, totalWeightedSalesAmount);
  const orderCoveragePercent = safePercent(coveredOrders, weightedPopulationOrders);
  const weightedAverageDays = safeAverage(weightedDays, coveredSalesAmount);
  const quality =
    weightedAverageDays == null ? "UNAVAILABLE" : resolveGrantedPaymentTermQuality(coveragePercent);

  const toStats = (acc: SourceAccumulator): GrantedPaymentTermSourceStats => ({
    orders: acc.orders,
    salesAmount: acc.salesAmount,
    salesSharePercent: safePercent(acc.salesAmount, totalWeightedSalesAmount),
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
    totalWeightedSalesAmount,
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
  "ponderados pelo valor dos títulos; média geral ponderada pelo valor líquido dos pedidos filtrados. " +
  "Pedidos sem títulos usam a condição comercial de pagamento quando interpretável (ex.: 30/60 = 45 dias). " +
  "Não mede atraso nem data real de recebimento.";
export const GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT =
  `${GRANTED_PAYMENT_TERM_HELP_TEXT} Pedidos sem títulos de CR e sem condição interpretável foram excluídos da média.`;
export const GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL = "Cobertura insuficiente";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL = "Indisponível";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE = "Sem títulos ou condições de pagamento suficientes";
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

/** Texto de ajuda do card: metodologia + participação de cada fonte quando houver cobertura. */
export function buildGrantedPaymentTermHelpText(
  summary: SalesOrderGrantedPaymentTermSummary | null | undefined,
  quality: GrantedPaymentTermQuality
): string {
  const base =
    quality === "PARTIAL" || quality === "LOW"
      ? GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT
      : GRANTED_PAYMENT_TERM_HELP_TEXT;
  if (!summary || !(summary.coveredSalesAmount > 0)) return base;
  const titles = formatGrantedPaymentTermCoverage(summary.sources.receivableTitles.salesSharePercent);
  const terms = formatGrantedPaymentTermCoverage(summary.sources.commercialTerms.salesSharePercent);
  return `${base} Fonte: títulos do CR em ${titles} do valor vendido; condição comercial em ${terms}.`;
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
 * Estado visual do card por qualidade:
 *   FULL        → "47,8 dias" / "Cobertura: 98,2% do valor vendido" (info)
 *   PARTIAL     → "47,8 dias" / "Cobertura parcial: 89,4%" (warning)
 *   LOW         → "Cobertura insuficiente" / "Cobertura: 54,1%" (warning) — número não é exibido
 *   UNAVAILABLE → "Indisponível" / "Sem títulos ou condições de pagamento suficientes" (neutral)
 *   null (endpoint falhou) → "Indisponível" / "Não foi possível carregar o indicador." (neutral)
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
        subtitle: `Cobertura: ${coverage} do valor vendido`,
        tone: "info",
        helperText,
      };
    case "PARTIAL":
      return {
        quality,
        value: formatGrantedPaymentTermDays(days),
        valueSize: "default",
        subtitle: `Cobertura parcial: ${coverage}`,
        tone: "warning",
        helperText,
      };
    case "LOW":
      return {
        quality,
        value: GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL,
        valueSize: "text",
        subtitle: `Cobertura: ${coverage}`,
        tone: "warning",
        helperText,
      };
    default:
      return {
        quality: "UNAVAILABLE",
        value: GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL,
        valueSize: "text",
        subtitle: GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE,
        tone: "neutral",
        helperText: GRANTED_PAYMENT_TERM_HELP_TEXT,
      };
  }
}
