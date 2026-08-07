/**
 * FIN-11 — Recuperação do Dinheiro Investido: matemática pura por Pedido de
 * Venda. Não lê banco, não decide fonte de dado, não resolve custo/CR — só
 * transforma (investedCapital, actualReceived, eventos financeiros já
 * reconciliados) em (capitalRecovered, moneyOnStreet, recoveryPercent,
 * status, datas, aging).
 *
 * Autoridade do custo: `investedCapital` é o custo COMERCIAL do Pedido
 * (mesmo motor que já alimenta marginValue/marginPercent no Detalhe do
 * Pedido — decisão de negócio confirmada, não o custo industrial). Ver
 * docs/finance/invested-capital-recovery.md.
 *
 * Autoridade do "recebido": `actualReceived` só pode conter dinheiro
 * EFETIVAMENTE recebido (CR real baixado) — nunca previsão, CR aberto, NF
 * emitida ou promessa. A precedência CR real > previsão é resolvida a
 * montante (FIN-05, `salesOrderEffectiveFinancialSchedule.ts`); este módulo
 * não reimplementa essa regra, só consome o resultado.
 */

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isValidPositiveCapital(investedCapital: number | null | undefined): investedCapital is number {
  return investedCapital != null && Number.isFinite(investedCapital) && investedCapital > 0;
}

export type InvestedCapitalRecoveryStatus =
  | "SEM_RECUPERACAO"
  | "EM_RECUPERACAO"
  | "CAPITAL_RECUPERADO"
  | "DADOS_INSUFICIENTES";

/** capitalRecovered = MIN(actualReceived, investedCapital); null quando o capital é ausente/inválido — nunca vira 0 silenciosamente. */
export function computeCapitalRecovered(
  investedCapital: number | null | undefined,
  actualReceived: number
): number | null {
  if (!isValidPositiveCapital(investedCapital)) return null;
  const received = Number.isFinite(actualReceived) ? actualReceived : 0;
  return roundMoney(Math.min(Math.max(received, 0), investedCapital));
}

/** moneyOnStreet = MAX(investedCapital - actualReceived, 0); nunca negativo, nunca == saldo a receber. */
export function computeMoneyOnStreet(
  investedCapital: number | null | undefined,
  actualReceived: number
): number | null {
  if (!isValidPositiveCapital(investedCapital)) return null;
  const received = Number.isFinite(actualReceived) ? actualReceived : 0;
  return roundMoney(Math.max(investedCapital - received, 0));
}

/** recoveryPercent = MIN(actualReceived / investedCapital, 1) * 100; nunca > 100; null quando capital ausente/inválido. */
export function computeRecoveryPercent(
  investedCapital: number | null | undefined,
  actualReceived: number
): number | null {
  if (!isValidPositiveCapital(investedCapital)) return null;
  const received = Number.isFinite(actualReceived) ? actualReceived : 0;
  return roundMoney(Math.min(Math.max(received, 0) / investedCapital, 1) * 100);
}

/**
 * Status econômico — SOMENTE analítico, nunca altera SalesOrder.status.
 *   DADOS_INSUFICIENTES: capital ausente/inválido.
 *   SEM_RECUPERACAO:     capitalRecovered == 0.
 *   EM_RECUPERACAO:      0 < capitalRecovered < investedCapital.
 *   CAPITAL_RECUPERADO:  capitalRecovered >= investedCapital.
 */
export function computeInvestedCapitalRecoveryStatus(
  investedCapital: number | null | undefined,
  capitalRecovered: number | null
): InvestedCapitalRecoveryStatus {
  if (!isValidPositiveCapital(investedCapital) || capitalRecovered == null) {
    return "DADOS_INSUFICIENTES";
  }
  if (capitalRecovered <= 0) return "SEM_RECUPERACAO";
  if (capitalRecovered >= investedCapital) return "CAPITAL_RECUPERADO";
  return "EM_RECUPERACAO";
}

/** Evento financeiro real ou previsto, já com a data resolvida pela camada canônica (FIN-05/resolveFinance*EffectiveSettlementDate). */
export type InvestedCapitalRecoveryEvent = {
  civilDate: string | null;
  amount: number;
};

/**
 * Data real em que o capital investido foi recuperado — algoritmo do
 * enunciado (seção 13): acumula eventos REAIS de recebimento em ordem
 * cronológica; a data do primeiro evento que faz o acumulado atingir o
 * capital é `capitalRecoveryDate`. `null` quando o capital não foi atingido
 * pelos eventos informados, ou quando algum evento não tem data (não se
 * fabrica precisão que os dados não sustentam — ver seção 8 do enunciado).
 */
export function resolveCapitalRecoveryDate(
  investedCapital: number | null | undefined,
  actualReceiptEvents: readonly InvestedCapitalRecoveryEvent[]
): string | null {
  if (!isValidPositiveCapital(investedCapital)) return null;

  const positive = actualReceiptEvents.filter((e) => e.amount > 0);
  // Se qualquer evento de recebimento real não tiver data, a data exata de
  // recuperação não é determinável com confiança — melhor null do que uma
  // data que ignora silenciosamente um evento sem data.
  if (positive.some((e) => e.civilDate == null)) return null;

  const sorted = [...positive].sort((a, b) => a.civilDate!.localeCompare(b.civilDate!));
  let accumulated = 0;
  for (const event of sorted) {
    accumulated = roundMoney(accumulated + event.amount);
    if (accumulated >= roundMoney(investedCapital)) {
      return event.civilDate;
    }
  }
  return null;
}

/**
 * Fonte da previsão de recuperação — nomenclatura compatível com
 * `OrderFullAuditReceivable.origin`/FIN-05 (REAL/forecast).
 */
export type InvestedCapitalRecoveryForecastSource =
  | "REAL_RECEIVABLES"
  | "REAL_AND_FORECAST"
  | "FORECAST_ONLY"
  | "NONE";

/**
 * Previsão de quando o capital restante deve ser recuperado — algoritmo do
 * enunciado (seção 14): parte de `actualReceived`, acumula a agenda futura
 * (CR real em aberto > previsão do PV ainda não substituída — hierarquia já
 * resolvida a montante pelo FIN-05, aqui só se consome a lista ordenada) em
 * ordem cronológica; a primeira data em que o acumulado atinge o capital é
 * `forecastCapitalRecoveryDate`. `null` sem cobertura suficiente. Não roda
 * quando o capital já foi recuperado (retorna null — nada a prever).
 */
export function resolveForecastCapitalRecoveryDate(
  investedCapital: number | null | undefined,
  actualReceived: number,
  futureAgendaEvents: readonly InvestedCapitalRecoveryEvent[]
): string | null {
  if (!isValidPositiveCapital(investedCapital)) return null;
  const received = Number.isFinite(actualReceived) ? actualReceived : 0;
  if (received >= investedCapital) return null;

  const positive = futureAgendaEvents.filter((e) => e.amount > 0 && e.civilDate != null);
  const sorted = [...positive].sort((a, b) => a.civilDate!.localeCompare(b.civilDate!));
  let accumulated = received;
  for (const event of sorted) {
    accumulated = roundMoney(accumulated + event.amount);
    if (accumulated >= roundMoney(investedCapital)) {
      return event.civilDate;
    }
  }
  return null;
}

/** Deriva a fonte da agenda usada (para exibição — "REAL_AND_FORECAST" etc). */
export function resolveInvestedCapitalRecoveryForecastSource(input: {
  hasOpenRealReceivables: boolean;
  hasResidualForecast: boolean;
}): InvestedCapitalRecoveryForecastSource {
  if (input.hasOpenRealReceivables && input.hasResidualForecast) return "REAL_AND_FORECAST";
  if (input.hasOpenRealReceivables) return "REAL_RECEIVABLES";
  if (input.hasResidualForecast) return "FORECAST_ONLY";
  return "NONE";
}

export type InvestedCapitalAgingBucketKey =
  | "overdue"
  | "d0to30"
  | "d31to60"
  | "d61to90"
  | "d90plus"
  | "noForecast";

export const INVESTED_CAPITAL_AGING_BUCKET_LABELS: Record<InvestedCapitalAgingBucketKey, string> = {
  overdue: "Em atraso",
  d0to30: "0–30 dias",
  d31to60: "31–60 dias",
  d61to90: "61–90 dias",
  d90plus: "Acima de 90 dias",
  noForecast: "Sem previsão",
};

/** Diferença em dias corridos (civilDate - todayCivilDate), civil dates "YYYY-MM-DD", sem fuso. */
function civilDateDiffInDays(civilDate: string, todayCivilDate: string): number {
  const [y1, m1, d1] = civilDate.split("-").map(Number);
  const [y2, m2, d2] = todayCivilDate.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function classifyInvestedCapitalAgingBucket(
  civilDate: string,
  todayCivilDate: string
): InvestedCapitalAgingBucketKey {
  const diffDays = civilDateDiffInDays(civilDate, todayCivilDate);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 30) return "d0to30";
  if (diffDays <= 60) return "d31to60";
  if (diffDays <= 90) return "d61to90";
  return "d90plus";
}

/**
 * Distribui `moneyOnStreet` sobre a agenda financeira remanescente
 * (cronológica), até consumi-lo — seção 19 do enunciado. NUNCA atribui o
 * capital na rua inteiro a uma única faixa quando o pedido tem várias
 * exposições; o que sobrar de saldo a receber ALÉM do capital não entra em
 * nenhuma faixa (não é dinheiro na rua). Se a agenda não cobrir todo o
 * `moneyOnStreet`, o restante cai em "Sem previsão" — nunca descartado.
 * Invariante: SUM(retorno) === moneyOnStreet (a menos de arredondamento).
 */
export function distributeMoneyOnStreetAcrossAging(input: {
  moneyOnStreet: number;
  scheduleEvents: readonly InvestedCapitalRecoveryEvent[];
  todayCivilDate: string;
}): Record<InvestedCapitalAgingBucketKey, number> {
  const buckets: Record<InvestedCapitalAgingBucketKey, number> = {
    overdue: 0,
    d0to30: 0,
    d31to60: 0,
    d61to90: 0,
    d90plus: 0,
    noForecast: 0,
  };

  let remaining = roundMoney(Math.max(input.moneyOnStreet, 0));
  if (remaining <= 0) return buckets;

  const sorted = [...input.scheduleEvents]
    .filter((e) => e.amount > 0)
    .sort((a, b) => {
      if (a.civilDate == null && b.civilDate == null) return 0;
      if (a.civilDate == null) return 1;
      if (b.civilDate == null) return -1;
      return a.civilDate.localeCompare(b.civilDate);
    });

  for (const event of sorted) {
    if (remaining <= 0) break;
    const slice = roundMoney(Math.min(event.amount, remaining));
    const bucket =
      event.civilDate == null
        ? "noForecast"
        : classifyInvestedCapitalAgingBucket(event.civilDate, input.todayCivilDate);
    buckets[bucket] = roundMoney(buckets[bucket] + slice);
    remaining = roundMoney(remaining - slice);
  }

  if (remaining > 0) {
    buckets.noForecast = roundMoney(buckets.noForecast + remaining);
  }

  return buckets;
}
