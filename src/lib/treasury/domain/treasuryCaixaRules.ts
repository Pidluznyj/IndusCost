/**
 * Regras puras — aba "Caixa" da Tesouraria.
 * Resolve o filtro Ano/(Mês)/(Dia) em um range de vencimento e soma os
 * totalizadores a partir das mesmas linhas exibidas nas tabelas (sem
 * recalcular por fora — cards e grid sempre reconciliam).
 */

import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";

export type TreasuryCaixaPeriodInput = {
  year: number;
  month?: number;
  day?: number;
};

export type TreasuryCaixaDueDateRange = {
  dueDateFrom: Date;
  dueDateTo: Date;
};

export class TreasuryCaixaFilterError extends Error {}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Ano/(Mês)/(Dia) → range de data de vencimento (inclusive nas duas pontas). */
export function resolveTreasuryCaixaDueDateRange(
  input: TreasuryCaixaPeriodInput
): TreasuryCaixaDueDateRange {
  const { year, month, day } = input;
  if (!Number.isInteger(year) || year < 1900 || year > 2999) {
    throw new TreasuryCaixaFilterError("Ano inválido.");
  }
  if (day != null && month == null) {
    throw new TreasuryCaixaFilterError("Dia informado sem mês.");
  }
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new TreasuryCaixaFilterError("Mês inválido.");
  }

  if (month != null && day != null) {
    const maxDay = daysInMonth(year, month);
    if (!Number.isInteger(day) || day < 1 || day > maxDay) {
      throw new TreasuryCaixaFilterError(
        "Dia inválido para o mês/ano informado."
      );
    }
    const date = civilDateToLocalDate(`${year}-${pad2(month)}-${pad2(day)}`);
    return { dueDateFrom: date, dueDateTo: date };
  }

  if (month != null) {
    const lastDay = daysInMonth(year, month);
    return {
      dueDateFrom: civilDateToLocalDate(`${year}-${pad2(month)}-01`),
      dueDateTo: civilDateToLocalDate(`${year}-${pad2(month)}-${pad2(lastDay)}`),
    };
  }

  return {
    dueDateFrom: civilDateToLocalDate(`${year}-01-01`),
    dueDateTo: civilDateToLocalDate(`${year}-12-31`),
  };
}

export type TreasuryCaixaTotals = {
  /** Saldo em aberto (ainda não liquidado) — o que falta receber/pagar. */
  totalReceivable: number;
  totalPayable: number;
  /** Saldo líquido em aberto (a receber - a pagar). */
  netBalance: number;
  /** Já liquidado no período — o que já foi efetivamente recebido/pago. */
  totalReceived: number;
  totalPaid: number;
  /** Saldo líquido já realizado (recebido - pago). */
  netRealized: number;
  receivableCount: number;
  payableCount: number;
};

function sumField(
  rows: readonly Record<string, unknown>[],
  field: string
): number {
  return rows.reduce((sum, row) => {
    const value = row[field];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Soma sempre sobre as MESMAS linhas exibidas na tabela — cards nunca divergem do grid. */
export function computeTreasuryCaixaTotals(input: {
  receivables: readonly { balanceReceivable: number; amountReceived?: number }[];
  payables: readonly { balancePayable: number; amountPaid?: number }[];
}): TreasuryCaixaTotals {
  const totalReceivable = sumField(input.receivables, "balanceReceivable");
  const totalPayable = sumField(input.payables, "balancePayable");
  const totalReceived = sumField(input.receivables, "amountReceived");
  const totalPaid = sumField(input.payables, "amountPaid");
  return {
    totalReceivable: roundMoney(totalReceivable),
    totalPayable: roundMoney(totalPayable),
    netBalance: roundMoney(totalReceivable - totalPayable),
    totalReceived: roundMoney(totalReceived),
    totalPaid: roundMoney(totalPaid),
    netRealized: roundMoney(totalReceived - totalPaid),
    receivableCount: input.receivables.length,
    payableCount: input.payables.length,
  };
}

/**
 * Passo 3 — fluxo de um dia: "começou com X, entrou Y, saiu Z, terminou com W".
 *
 * Os quatro números vêm prontos do workspace canônico de fechamento diário
 * (`/today/closing`), por conta. Aqui só consolidamos somando as contas — nenhum
 * cálculo de caixa é refeito. `null` significa "não informado" (≠ zero).
 */
export type TreasuryCaixaDayFlowAccountInput = {
  openingBalance: number | null;
  realizedInflows: number;
  realizedOutflows: number;
  realizedClosingBalance: number | null;
  informedClosingBalance: number | null;
};

export type TreasuryCaixaDayFlow = {
  civilDate: string;
  /** Soma dos saldos de abertura; null se nenhuma conta tem abertura informada. */
  opening: number | null;
  inflows: number;
  outflows: number;
  /** Fechamento calculado pelo motor (abertura + entradas − saídas). */
  closingCalculated: number | null;
  /** Fechamento informado no extrato; null se ninguém informou ainda. */
  closingInformed: number | null;
  /** informado − calculado; null quando falta um dos lados. */
  divergence: number | null;
  accountCount: number;
  /** Quantas contas ainda não têm fechamento informado. */
  pendingClosingCount: number;
};

/** Soma tratando null como ausência: se ninguém informou, o total é null (não zero). */
function sumNullable(values: readonly (number | null)[]): number | null {
  let hasAny = false;
  let total = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    hasAny = true;
    total += v;
  }
  return hasAny ? roundMoney(total) : null;
}

export function buildTreasuryCaixaDayFlow(input: {
  civilDate: string;
  accounts: readonly TreasuryCaixaDayFlowAccountInput[];
}): TreasuryCaixaDayFlow {
  const opening = sumNullable(input.accounts.map((a) => a.openingBalance));
  const inflows = roundMoney(
    input.accounts.reduce(
      (s, a) => s + (Number.isFinite(a.realizedInflows) ? a.realizedInflows : 0),
      0
    )
  );
  const outflows = roundMoney(
    input.accounts.reduce(
      (s, a) => s + (Number.isFinite(a.realizedOutflows) ? a.realizedOutflows : 0),
      0
    )
  );
  const closingCalculated = sumNullable(
    input.accounts.map((a) => a.realizedClosingBalance)
  );
  const closingInformed = sumNullable(
    input.accounts.map((a) => a.informedClosingBalance)
  );

  return {
    civilDate: input.civilDate,
    opening,
    inflows,
    outflows,
    closingCalculated,
    closingInformed,
    divergence:
      closingInformed != null && closingCalculated != null
        ? roundMoney(closingInformed - closingCalculated)
        : null,
    accountCount: input.accounts.length,
    pendingClosingCount: input.accounts.filter(
      (a) => a.informedClosingBalance == null
    ).length,
  };
}

/**
 * Passo 4 — linha do tempo: um dia por linha, com o "hoje" separando o que já
 * aconteceu do que é previsão.
 *
 * Regra central (pedido do negócio): dia passado mostra o que foi REALMENTE
 * pago/recebido (`realized*`); dia futuro mostra PREVISÃO (`planned*`). O dia de
 * hoje usa realizado, para bater com o bloco "Movimento de hoje" do Passo 3.
 *
 * O saldo de fechamento vem sempre do motor (`closingBalance`) — não é recalculado
 * aqui, senão a linha do tempo divergiria da projeção oficial.
 */
export type TreasuryCaixaTimelineKind = "REALIZED" | "TODAY" | "FORECAST";

export type TreasuryCaixaTimelineDayInput = {
  civilDate: string;
  openingBalance: number;
  plannedInflows: number;
  plannedOutflows: number;
  realizedInflows: number;
  realizedOutflows: number;
  closingBalance: number | null;
};

export type TreasuryCaixaTimelineRow = {
  civilDate: string;
  kind: TreasuryCaixaTimelineKind;
  /**
   * Saldo de abertura. `null` em dia passado sem saldo informado — reconstruir
   * caminhando de trás pra frente mentiria: a conta assumiria que todo movimento
   * tem título por trás, que é justamente o que as divergências violam.
   */
  opening: number | null;
  inflows: number;
  outflows: number;
  closing: number | null;
  /** Fechou negativo neste dia. */
  negative: boolean;
};

export type TreasuryCaixaTimeline = {
  todayCivilDate: string;
  rows: TreasuryCaixaTimelineRow[];
  realizedCount: number;
  forecastCount: number;
  /** Primeiro dia com saldo negativo (prévia do passo 7); null se nunca. */
  firstNegativeDate: string | null;
};

export function classifyTreasuryCaixaTimelineDay(
  civilDate: string,
  todayCivilDate: string
): TreasuryCaixaTimelineKind {
  if (civilDate < todayCivilDate) return "REALIZED";
  if (civilDate > todayCivilDate) return "FORECAST";
  return "TODAY";
}

export function buildTreasuryCaixaTimeline(input: {
  todayCivilDate: string;
  days: readonly TreasuryCaixaTimelineDayInput[];
}): TreasuryCaixaTimeline {
  const rows: TreasuryCaixaTimelineRow[] = [...input.days]
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate))
    .map((d) => {
      const kind = classifyTreasuryCaixaTimelineDay(
        d.civilDate,
        input.todayCivilDate
      );
      // Futuro = previsão; passado e hoje = o que realmente aconteceu.
      const useForecast = kind === "FORECAST";
      const closing =
        d.closingBalance != null && Number.isFinite(d.closingBalance)
          ? roundMoney(d.closingBalance)
          : null;
      return {
        civilDate: d.civilDate,
        kind,
        opening: roundMoney(d.openingBalance),
        inflows: roundMoney(useForecast ? d.plannedInflows : d.realizedInflows),
        outflows: roundMoney(
          useForecast ? d.plannedOutflows : d.realizedOutflows
        ),
        closing,
        negative: closing != null && closing < 0,
      };
    });

  return {
    todayCivilDate: input.todayCivilDate,
    rows,
    realizedCount: rows.filter((r) => r.kind === "REALIZED").length,
    forecastCount: rows.filter((r) => r.kind === "FORECAST").length,
    firstNegativeDate: rows.find((r) => r.negative)?.civilDate ?? null,
  };
}

/**
 * Passo 5 — visão mensal: os mesmos dias, agrupados por mês, com drill down.
 *
 * O mês não recalcula nada: abertura é a do PRIMEIRO dia, fechamento é o do
 * ÚLTIMO dia, e entradas/saídas são a soma dos dias. Assim a soma dos dias
 * sempre bate com o mês — que é como o usuário valida a tela.
 */
export type TreasuryCaixaMonthKind = "REALIZED" | "CURRENT" | "FORECAST";

export type TreasuryCaixaTimelineMonth = {
  /** Chave "YYYY-MM" — ordenável como string. */
  monthKey: string;
  kind: TreasuryCaixaMonthKind;
  /** Abertura do primeiro dia do mês. */
  opening: number;
  inflows: number;
  outflows: number;
  /** Fechamento do último dia do mês; null se o motor não fechou o dia. */
  closing: number | null;
  negative: boolean;
  firstNegativeDate: string | null;
  days: TreasuryCaixaTimelineRow[];
};

function resolveMonthKind(
  days: readonly TreasuryCaixaTimelineRow[]
): TreasuryCaixaMonthKind {
  const hasRealized = days.some((d) => d.kind === "REALIZED");
  const hasForecast = days.some((d) => d.kind === "FORECAST");
  const hasToday = days.some((d) => d.kind === "TODAY");
  if (hasToday || (hasRealized && hasForecast)) return "CURRENT";
  if (hasForecast) return "FORECAST";
  return "REALIZED";
}

export function buildTreasuryCaixaMonthlyTimeline(
  rows: readonly TreasuryCaixaTimelineRow[]
): TreasuryCaixaTimelineMonth[] {
  const byMonth = new Map<string, TreasuryCaixaTimelineRow[]>();
  for (const row of rows) {
    const key = row.civilDate.slice(0, 7);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(row);
    else byMonth.set(key, [row]);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, unsorted]) => {
      const days = [...unsorted].sort((a, b) =>
        a.civilDate.localeCompare(b.civilDate)
      );
      const first = days[0]!;
      const last = days[days.length - 1]!;
      const negativeDay = days.find((d) => d.negative);
      return {
        monthKey,
        kind: resolveMonthKind(days),
        opening: first.opening,
        inflows: roundMoney(days.reduce((s, d) => s + d.inflows, 0)),
        outflows: roundMoney(days.reduce((s, d) => s + d.outflows, 0)),
        closing: last.closing,
        negative: negativeDay != null,
        firstNegativeDate: negativeDay?.civilDate ?? null,
        days,
      };
    });
}

/**
 * Passo 4a — dias PASSADOS: o que entrou e saiu de fato.
 *
 * Agrega por data de LIQUIDAÇÃO (baixa do CR / pagamento do CP), não por
 * vencimento — um título vencido em maio e pago em julho é caixa de julho.
 * É agregação do que o motor canônico já produziu; nenhum cálculo de caixa novo.
 *
 * Só entram títulos com data de liquidação preenchida e valor liquidado > 0.
 */
export type TreasuryCaixaRealizedDay = {
  civilDate: string;
  inflows: number;
  outflows: number;
  receivableCount: number;
  payableCount: number;
};

/**
 * Passo 4a — funde as três zonas numa linha do tempo só.
 *
 * Cada zona vem de quem sabe respondê-la:
 *   passado → liquidação de CR/CP (fato, sempre fresco)
 *   hoje    → fechamento do dia (fato)
 *   futuro  → projeção materializada (estimativa, pode não existir)
 *
 * Dias passados sem movimento não viram linha — só ruído. Onde o dado não
 * existe o campo fica `null`, e a tela mostra "—" em vez de inventar zero.
 */
/**
 * Dia futuro vindo da agenda.
 *
 * `inflows`/`outflows` são os do CENÁRIO PEDIDO (campos `inflows`/`outflows` do
 * DTO), não os buckets `planned*`. Motivo: `plannedOutflows` só é preenchido a
 * partir do cenário contratual — pedindo PROBABLE ele vem zerado enquanto o
 * saldo cai, e a linha não fecha. Os campos do cenário são exatamente os que
 * movem o `closingBalance`.
 */
export type TreasuryCaixaForecastDayInput = {
  civilDate: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number | null;
};

export function buildTreasuryCaixaUnifiedTimeline(input: {
  todayCivilDate: string;
  realizedDays: readonly TreasuryCaixaRealizedDay[];
  todayFlow: TreasuryCaixaDayFlow | null;
  forecastDays: readonly TreasuryCaixaForecastDayInput[];
}): TreasuryCaixaTimeline {
  const rows: TreasuryCaixaTimelineRow[] = [];

  for (const d of input.realizedDays) {
    if (d.civilDate >= input.todayCivilDate) continue;
    rows.push({
      civilDate: d.civilDate,
      kind: "REALIZED",
      // Saldo de dia passado só existiria se tivesse sido informado.
      opening: null,
      inflows: d.inflows,
      outflows: d.outflows,
      closing: null,
      negative: false,
    });
  }

  // Hoje: o FATO manda. O saldo informado manualmente é a realidade e sempre
  // tem prioridade sobre qualquer número calculado/projetado — a linha de hoje
  // mostra exatamente os 4 números do bloco "Movimento de hoje" (começou
  // informado, entrou/saiu realizados, terminou informado ?? calculado).
  // A projeção NÃO substitui hoje: ela é um retrato congelado que assume que
  // todo título previsto andou — e é justamente isso que a realidade corrige.
  // A agenda só preenche hoje como fallback quando o fluxo do dia não carregou.
  const agendaToday = input.forecastDays.find(
    (d) => d.civilDate === input.todayCivilDate
  );
  /** Fechamento real de hoje — âncora da cadeia futura. */
  let anchorClosing: number | null = null;
  if (input.todayFlow) {
    const closing =
      input.todayFlow.closingInformed ?? input.todayFlow.closingCalculated;
    rows.push({
      civilDate: input.todayFlow.civilDate,
      kind: "TODAY",
      opening: input.todayFlow.opening,
      inflows: input.todayFlow.inflows,
      outflows: input.todayFlow.outflows,
      closing,
      negative: closing != null && closing < 0,
    });
    anchorClosing = closing;
  } else if (agendaToday) {
    const closing =
      agendaToday.closingBalance != null &&
      Number.isFinite(agendaToday.closingBalance)
        ? roundMoney(agendaToday.closingBalance)
        : null;
    rows.push({
      civilDate: agendaToday.civilDate,
      kind: "TODAY",
      opening: roundMoney(agendaToday.openingBalance),
      inflows: roundMoney(agendaToday.inflows),
      outflows: roundMoney(agendaToday.outflows),
      closing,
      negative: closing != null && closing < 0,
    });
  }

  // Futuro re-ancorado: os MOVIMENTOS diários vêm da projeção, mas os SALDOS
  // são deslocados pela diferença entre o fechamento real de hoje e o que a
  // projeção achou que hoje fecharia. Assim amanhã abre exatamente onde hoje
  // terminou de verdade (sem degrau) e a estimativa herda a realidade em vez
  // de contradizê-la. Só re-ancora quando a projeção cobre hoje — sem esse
  // elo (ex.: filtro de um mês futuro), deslocar seria inventar os dias no meio.
  const forecastShift =
    anchorClosing != null &&
    agendaToday?.closingBalance != null &&
    Number.isFinite(agendaToday.closingBalance)
      ? roundMoney(anchorClosing - agendaToday.closingBalance)
      : 0;

  for (const d of input.forecastDays) {
    if (d.civilDate <= input.todayCivilDate) continue;
    const closing =
      d.closingBalance != null && Number.isFinite(d.closingBalance)
        ? roundMoney(d.closingBalance + forecastShift)
        : null;
    rows.push({
      civilDate: d.civilDate,
      kind: "FORECAST",
      opening: roundMoney(d.openingBalance + forecastShift),
      inflows: roundMoney(d.inflows),
      outflows: roundMoney(d.outflows),
      closing,
      negative: closing != null && closing < 0,
    });
  }

  rows.sort((a, b) => a.civilDate.localeCompare(b.civilDate));

  return {
    todayCivilDate: input.todayCivilDate,
    rows,
    realizedCount: rows.filter((r) => r.kind === "REALIZED").length,
    forecastCount: rows.filter((r) => r.kind === "FORECAST").length,
    firstNegativeDate: rows.find((r) => r.negative)?.civilDate ?? null,
  };
}

export function buildTreasuryCaixaRealizedDays(input: {
  /** CR: agrupa pela data da BAIXA (settlementDate) — regra do motor oficial. */
  receivables: readonly {
    settlementDate: string | null;
    amountReceived: number;
  }[];
  /**
   * CP: o dinheiro conta no dia em que ANDOU — `paymentDate` quando o Nomus
   * informa. Fallback: vencimento (regra canônica do financeiro,
   * `effectivePaymentDate = dueDate` quando pago), porque o Nomus quase nunca
   * preenche a data de baixa do CP; sem o fallback a coluna zeraria.
   */
  payables: readonly {
    dueDate: string | null;
    paymentDate?: string | null;
    amountPaid: number;
  }[];
}): TreasuryCaixaRealizedDay[] {
  const byDate = new Map<string, TreasuryCaixaRealizedDay>();

  function bucket(civilDate: string): TreasuryCaixaRealizedDay {
    const existing = byDate.get(civilDate);
    if (existing) return existing;
    const created: TreasuryCaixaRealizedDay = {
      civilDate,
      inflows: 0,
      outflows: 0,
      receivableCount: 0,
      payableCount: 0,
    };
    byDate.set(civilDate, created);
    return created;
  }

  for (const r of input.receivables) {
    const key = r.settlementDate?.slice(0, 10);
    const amount = Number(r.amountReceived);
    if (!key || !Number.isFinite(amount) || amount <= 0) continue;
    const day = bucket(key);
    day.inflows += amount;
    day.receivableCount += 1;
  }

  for (const p of input.payables) {
    // Realidade primeiro: data de pagamento informada > vencimento.
    const key = (p.paymentDate ?? p.dueDate)?.slice(0, 10);
    const amount = Number(p.amountPaid);
    if (!key || !Number.isFinite(amount) || amount <= 0) continue;
    const day = bucket(key);
    day.outflows += amount;
    day.payableCount += 1;
  }

  return [...byDate.values()]
    .map((d) => ({
      ...d,
      inflows: roundMoney(d.inflows),
      outflows: roundMoney(d.outflows),
    }))
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));
}

/**
 * Passo 6 — atrasados: ESTOQUE, não fluxo.
 *
 * Título vencido e não liquidado não pertence a nenhum dia da linha do tempo.
 * O motor canônico deliberadamente NÃO joga CR vencido sem promessa para "hoje"
 * (ver docs/treasury/15-PROJECTION-AND-DOUBLE-COUNTING.md) — se jogasse, o saldo
 * projetado subiria com dinheiro que não entrou e a data em que o caixa vira
 * negativo viria tarde demais.
 *
 * Por isso o atrasado aparece numa faixa própria, ancorada no presente, e não
 * espalhado nos dias. As faixas de aging são as canônicas do financeiro.
 */
export type TreasuryCaixaOverdueBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

export type TreasuryCaixaOverdueSide = {
  total: number;
  count: number;
  buckets: TreasuryCaixaOverdueBucket[];
};

export type TreasuryCaixaOverdue = {
  receivable: TreasuryCaixaOverdueSide;
  payable: TreasuryCaixaOverdueSide;
};

/** Faixas de atraso — mesmas chaves/labels do dashboard financeiro. */
export const TREASURY_CAIXA_OVERDUE_BUCKETS = [
  { key: "overdue1to7", label: "1 a 7 dias", minDays: 1, maxDays: 7 },
  { key: "overdue8to15", label: "8 a 15 dias", minDays: 8, maxDays: 15 },
  { key: "overdue16to30", label: "16 a 30 dias", minDays: 16, maxDays: 30 },
  { key: "overdue31to60", label: "31 a 60 dias", minDays: 31, maxDays: 60 },
  { key: "overdue61to90", label: "61 a 90 dias", minDays: 61, maxDays: 90 },
  { key: "overdue90plus", label: "Acima de 90 dias", minDays: 91, maxDays: null },
] as const;

function buildOverdueSide(
  rows: readonly { daysOverdue: number; amount: number }[]
): TreasuryCaixaOverdueSide {
  const buckets: TreasuryCaixaOverdueBucket[] = TREASURY_CAIXA_OVERDUE_BUCKETS.map(
    (b) => ({ key: b.key, label: b.label, amount: 0, count: 0 })
  );
  let total = 0;
  let count = 0;

  for (const row of rows) {
    const days = Number(row.daysOverdue);
    const amount = Number(row.amount);
    // Só conta o que está vencido (>0 dia) e ainda tem saldo aberto.
    if (!Number.isFinite(days) || days < 1) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const index = TREASURY_CAIXA_OVERDUE_BUCKETS.findIndex(
      (b) => days >= b.minDays && (b.maxDays == null || days <= b.maxDays)
    );
    if (index < 0) continue;
    buckets[index]!.amount += amount;
    buckets[index]!.count += 1;
    total += amount;
    count += 1;
  }

  return {
    total: roundMoney(total),
    count,
    // Faixa sem título não vira selo vazio na tela.
    buckets: buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ ...b, amount: roundMoney(b.amount) })),
  };
}

export function buildTreasuryCaixaOverdue(input: {
  receivables: readonly { daysOverdue: number; balanceReceivable: number }[];
  payables: readonly { daysOverdue: number; balancePayable: number }[];
}): TreasuryCaixaOverdue {
  return {
    receivable: buildOverdueSide(
      input.receivables.map((r) => ({
        daysOverdue: r.daysOverdue,
        amount: r.balanceReceivable,
      }))
    ),
    payable: buildOverdueSide(
      input.payables.map((p) => ({
        daysOverdue: p.daysOverdue,
        amount: p.balancePayable,
      }))
    ),
  };
}

export type TreasuryCaixaBoardDto = {
  period: TreasuryCaixaPeriodInput;
  dueDateFrom: string;
  dueDateTo: string;
  totals: TreasuryCaixaTotals;
  /** Passado do período: entrou/saiu por data de liquidação (só dias com movimento). */
  realizedDays: TreasuryCaixaRealizedDay[];
  /** Estoque de atrasados HOJE — independe do período filtrado. */
  overdue: TreasuryCaixaOverdue;
  receivables: FinanceAccountsReceivableGridRow[];
  payables: FinanceAccountsPayableGridRow[];
};
