/**
 * Prazo médio concedido — listagem Comercial de Pedidos de Venda.
 *
 * Motor PURO (sem Prisma, sem React, sem Node): interpreta a condição comercial
 * de pagamento (`SalesOrder.paymentTerms`) de forma conservadora (fail-closed) e
 * pondera o prazo concedido pelo valor líquido vendido (`SalesOrder.totalNetValue`)
 * da população filtrada da listagem.
 *
 * O indicador mede a CONDIÇÃO COMERCIAL DE PAGAMENTO CONCEDIDA no pedido.
 * NÃO é PMR/DSO, NÃO usa Contas a Receber, recebimento real, liquidação nem
 * vencimentos calculados a partir da emissão. `paymentMethod` (PIX/boleto/…)
 * nunca define prazo.
 *
 * Fórmula:
 *   prazo médio concedido =
 *     Σ (valor líquido positivo do pedido × prazo médio da condição)
 *     ÷ Σ valor líquido positivo dos pedidos com condição reconhecida
 *
 * Prazo médio da condição = média simples das parcelas ("30/60" → 45;
 * "30/60/90" → 60; "À vista" → 0). Pesos desconhecidos (%, entrada, sinal…)
 * são rejeitados em vez de inventar uma média.
 */

export const SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE = "SalesOrder.paymentTerms" as const;

/** Metodologia estável exposta no DTO (não é só texto de UI). */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY =
  "Média ponderada pelo valor líquido dos pedidos filtrados, usando SalesOrder.paymentTerms. " +
  "Condições com múltiplos prazos usam média das parcelas. " +
  "Condições não interpretáveis são excluídas e refletidas na cobertura.";

/** Limite superior defensivo de dias por parcela (acima disso = não reconhecido). */
export const GRANTED_PAYMENT_TERM_MAX_DAYS = 365;
/** Limite defensivo de parcelas numa condição. */
export const GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS = 24;

/** Qualidade por cobertura (% do valor líquido positivo reconhecido). */
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
 * Parser FAIL-CLOSED da condição comercial de pagamento.
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
// Ponderação
// ---------------------------------------------------------------------------

/** Grupo agregado por condição (ex.: `groupBy paymentTerms` da população de peso). */
export type GrantedPaymentTermGroupInput = {
  paymentTerms: string | null;
  orderCount: number;
  /**
   * Σ `totalNetValue` dos pedidos do grupo. Só grupos com valor POSITIVO entram
   * na ponderação — a consulta deve restringir `totalNetValue > 0` (nunca abs()).
   */
  salesAmount: number;
};

export type SalesOrderGrantedPaymentTermUnrecognizedTerm = {
  paymentTerms: string | null;
  orderCount: number;
  salesAmount: number;
  reason: GrantedPaymentTermParseReason;
  reasonLabel: string;
};

export type SalesOrderGrantedPaymentTermSummary = {
  /** false quando nenhum valor reconhecido / sem população válida. */
  available: boolean;
  /** Dias, precisão interna (UI arredonda para 1 casa). null quando indisponível. */
  weightedAverageDays: number | null;
  /** % do valor líquido positivo com condição reconhecida — cobertura PRINCIPAL. */
  coveragePercent: number;
  /** % dos pedidos (com peso) com condição reconhecida. */
  orderCoveragePercent: number;
  quality: GrantedPaymentTermQuality;
  /** Pedidos da população filtrada (mesmo count da listagem). */
  totalOrders: number;
  /** Pedidos com totalNetValue > 0 (população de ponderação). */
  weightedPopulationOrders: number;
  recognizedOrders: number;
  unrecognizedOrders: number;
  /** Pedidos filtrados fora do peso (totalNetValue <= 0) — auditoria. */
  zeroOrNegativeOrders: number;
  totalWeightedSalesAmount: number;
  recognizedSalesAmount: number;
  unrecognizedSalesAmount: number;
  source: typeof SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE;
  methodology: string;
  /** Top condições não reconhecidas (valor vendido desc) — decide novas regras do parser. */
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

function compareUnrecognizedTerms(
  a: SalesOrderGrantedPaymentTermUnrecognizedTerm,
  b: SalesOrderGrantedPaymentTermUnrecognizedTerm
): number {
  if (b.salesAmount !== a.salesAmount) return b.salesAmount - a.salesAmount;
  if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
  return (a.paymentTerms ?? "").localeCompare(b.paymentTerms ?? "", "pt-BR");
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
    recognizedOrders: 0,
    unrecognizedOrders: 0,
    zeroOrNegativeOrders: total,
    totalWeightedSalesAmount: 0,
    recognizedSalesAmount: 0,
    unrecognizedSalesAmount: 0,
    source: SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
    methodology: SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
    unrecognizedTerms: [],
  };
}

/**
 * Ponderação pura (separada da interpretação textual).
 *
 * `groups` deve vir da população de PESO (totalNetValue > 0) agrupada por
 * `paymentTerms`; grupos com valor não positivo ou sem pedidos são ignorados na
 * ponderação (nunca entram no denominador). `totalOrders` é o count da população
 * filtrada completa (mesmo where da listagem), usado para `zeroOrNegativeOrders`.
 */
export function computeGrantedPaymentTermSummary(
  groups: readonly GrantedPaymentTermGroupInput[],
  options: { totalOrders: number; unrecognizedTopLimit?: number }
): SalesOrderGrantedPaymentTermSummary {
  const totalOrders = Math.max(
    0,
    Number.isFinite(options.totalOrders) ? Math.trunc(options.totalOrders) : 0
  );
  const topLimit = Math.max(
    0,
    Math.trunc(options.unrecognizedTopLimit ?? GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT)
  );

  let weightedDays = 0;
  let recognizedSalesAmount = 0;
  let unrecognizedSalesAmount = 0;
  let weightedPopulationOrders = 0;
  let recognizedOrders = 0;
  let unrecognizedOrders = 0;
  const unrecognizedTerms: SalesOrderGrantedPaymentTermUnrecognizedTerm[] = [];

  for (const group of groups) {
    const salesAmount = Number.isFinite(group.salesAmount) ? group.salesAmount : 0;
    const orderCount =
      Number.isFinite(group.orderCount) && group.orderCount > 0
        ? Math.trunc(group.orderCount)
        : 0;
    // Só valor líquido POSITIVO pesa. Zero/negativo não distorce nem entra no denominador.
    if (salesAmount <= 0 || orderCount <= 0) continue;

    weightedPopulationOrders += orderCount;
    const parsed = parseGrantedPaymentTerm(group.paymentTerms);
    if (parsed.recognized && parsed.averageDays != null) {
      weightedDays += salesAmount * parsed.averageDays;
      recognizedSalesAmount += salesAmount;
      recognizedOrders += orderCount;
    } else {
      unrecognizedSalesAmount += salesAmount;
      unrecognizedOrders += orderCount;
      unrecognizedTerms.push({
        paymentTerms: group.paymentTerms,
        orderCount,
        salesAmount,
        reason: parsed.reason,
        reasonLabel: describeGrantedPaymentTermReason(parsed.reason),
      });
    }
  }

  const totalWeightedSalesAmount = recognizedSalesAmount + unrecognizedSalesAmount;
  const coveragePercent = safePercent(recognizedSalesAmount, totalWeightedSalesAmount);
  const orderCoveragePercent = safePercent(recognizedOrders, weightedPopulationOrders);
  const rawAverage = recognizedSalesAmount > 0 ? weightedDays / recognizedSalesAmount : null;
  const weightedAverageDays = rawAverage != null && Number.isFinite(rawAverage) ? rawAverage : null;
  const quality =
    weightedAverageDays == null ? "UNAVAILABLE" : resolveGrantedPaymentTermQuality(coveragePercent);

  unrecognizedTerms.sort(compareUnrecognizedTerms);

  return {
    available: quality !== "UNAVAILABLE",
    weightedAverageDays: quality === "UNAVAILABLE" ? null : weightedAverageDays,
    coveragePercent,
    orderCoveragePercent,
    quality,
    totalOrders,
    weightedPopulationOrders,
    recognizedOrders,
    unrecognizedOrders,
    zeroOrNegativeOrders: Math.max(0, totalOrders - weightedPopulationOrders),
    totalWeightedSalesAmount,
    recognizedSalesAmount,
    unrecognizedSalesAmount,
    source: SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
    methodology: SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
    unrecognizedTerms: unrecognizedTerms.slice(0, topLimit),
  };
}

// ---------------------------------------------------------------------------
// Apresentação (card) — sem aritmética de negócio no React
// ---------------------------------------------------------------------------

export const GRANTED_PAYMENT_TERM_CARD_LABEL = "Prazo médio concedido";
export const GRANTED_PAYMENT_TERM_CARD_TEST_ID = "sales-order-list-average-payment-term-card";
export const GRANTED_PAYMENT_TERM_HELP_TEXT =
  "Média ponderada pelo valor líquido dos pedidos filtrados, calculada a partir da condição comercial de pagamento. " +
  "Ex.: 30/60 = 45 dias. Não representa atraso ou prazo real de recebimento.";
export const GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT =
  `${GRANTED_PAYMENT_TERM_HELP_TEXT} Condições de pagamento não reconhecidas foram excluídas da média.`;
export const GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL = "Cobertura insuficiente";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_LABEL = "Indisponível";
export const GRANTED_PAYMENT_TERM_UNAVAILABLE_SUBTITLE = "Sem condições de pagamento suficientes";
export const GRANTED_PAYMENT_TERM_LOAD_ERROR_SUBTITLE = "Não foi possível carregar o indicador.";

const oneDecimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "47,84" → "47,8 dias"; 0 → "0,0 dias"; inválido → "—". */
export function formatGrantedPaymentTermDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  return `${oneDecimalFormatter.format(days)} dias`;
}

/** 96,44 → "96,4%"; inválido → "—". */
export function formatGrantedPaymentTermCoverage(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${oneDecimalFormatter.format(percent)}%`;
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
 *   UNAVAILABLE → "Indisponível" / "Sem condições de pagamento suficientes" (neutral)
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

  switch (quality) {
    case "FULL":
      return {
        quality,
        value: formatGrantedPaymentTermDays(days),
        valueSize: "default",
        subtitle: `Cobertura: ${coverage} do valor vendido`,
        tone: "info",
        helperText: GRANTED_PAYMENT_TERM_HELP_TEXT,
      };
    case "PARTIAL":
      return {
        quality,
        value: formatGrantedPaymentTermDays(days),
        valueSize: "default",
        subtitle: `Cobertura parcial: ${coverage}`,
        tone: "warning",
        helperText: GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT,
      };
    case "LOW":
      return {
        quality,
        value: GRANTED_PAYMENT_TERM_LOW_COVERAGE_LABEL,
        valueSize: "text",
        subtitle: `Cobertura: ${coverage}`,
        tone: "warning",
        helperText: GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT,
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
