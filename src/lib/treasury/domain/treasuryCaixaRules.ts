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
   * Saldo de abertura. Em dia passado é o acumulado desde
   * {@link TREASURY_CAIXA_GENESIS_CIVIL_DATE} (zero na gênese) — não um saldo
   * informado. `null` só antes da gênese, onde não há premissa de saldo inicial.
   */
  opening: number | null;
  inflows: number;
  outflows: number;
  /** Fechamento EFETIVO: informado quando existe, senão calculado. */
  closing: number | null;
  /** Fechamento automático (abertura + entradas − saídas). */
  closingCalculated: number | null;
  /** Saldo informado/observado; null quando ninguém informou. */
  closingInformed: number | null;
  /**
   * `informado − calculado`; null quando não há informado. É o dinheiro que
   * andou sem título por trás — o número que a coluna Divergência mostra.
   */
  divergence: number | null;
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
        // Esta variante recebe o saldo já resolvido pelo motor; não distingue
        // informado de calculado nem apura divergência.
        closingCalculated: closing,
        closingInformed: null,
        divergence: null,
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
  /**
   * Soma das divergências diárias do mês — o total que andou sem título por
   * trás. `null` quando nenhum dia do mês tem saldo informado.
   */
  divergence: number | null;
  /** Quantos dias do mês têm saldo informado divergindo do calculado. */
  divergentDayCount: number;
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
      const divergentDays = days.filter(
        (d) => d.divergence != null && d.divergence !== 0
      );
      const hasAnyInformed = days.some((d) => d.divergence != null);
      return {
        monthKey,
        kind: resolveMonthKind(days),
        opening: first.opening,
        inflows: roundMoney(days.reduce((s, d) => s + d.inflows, 0)),
        outflows: roundMoney(days.reduce((s, d) => s + d.outflows, 0)),
        closing: last.closing,
        divergence: hasAnyInformed
          ? roundMoney(days.reduce((s, d) => s + (d.divergence ?? 0), 0))
          : null,
        divergentDayCount: divergentDays.length,
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
  /**
   * Saldo calculado por acumulação a partir de {@link TREASURY_CAIXA_GENESIS_CIVIL_DATE}.
   * `null` antes da gênese (histórico fora do que o sistema cobre) ou quando
   * {@link applyTreasuryCaixaRunningBalance} ainda não rodou sobre o dia.
   */
  opening: number | null;
  /** Fechamento EFETIVO do dia: informado quando existe, senão calculado. */
  closing: number | null;
  /** Fechamento automático: abertura + entradas − saídas. */
  closingCalculated: number | null;
  /** Saldo informado (extrato/fechamento oficial); null se ninguém informou. */
  closingInformed: number | null;
  /**
   * `informado − calculado`. Positivo = entrou dinheiro sem título por trás;
   * negativo = saiu dinheiro sem título. `null` quando não há informado —
   * nada a comparar não é o mesmo que divergência zero.
   */
  divergence: number | null;
};

/**
 * Data em que a Caixa passa a assumir saldo conhecido (zero) e acumular dia a
 * dia. Antes dela não há como saber quanto tinha em caixa — não é calculado.
 */
export const TREASURY_CAIXA_GENESIS_CIVIL_DATE = "2026-01-01";

/**
 * Passo 4a-bis — acumula saldo dia a dia a partir da gênese (zero), na ORDEM
 * cronológica completa, ANTES de qualquer corte por período de filtro.
 *
 * Pedido do negócio: nos meses em que ninguém lançou saldo manual, a tela não
 * deve ficar em branco — deve partir de 0 em 01/01/2026 e caminhar com o fluxo
 * diário de CR/CP (mesma fonte do resto da linha do tempo). É diferente de
 * "reconstruir por inferência": aqui a âncora (zero na gênese) é uma premissa
 * de negócio explícita, não uma suposição sobre títulos por trás do movimento.
 *
 * Precisa rodar sobre a lista INTEIRA (sem cortar por mês/dia do filtro),
 * senão um filtro de março, por exemplo, recomeçaria do zero em março e
 * perderia o efeito de janeiro/fevereiro. Quem chama corta para o período
 * exibido DEPOIS de acumular.
 */
export type TreasuryCaixaRunningBalanceOptions = {
  /** Dia em que a acumulação começa do zero. */
  genesisCivilDate?: string;
  /**
   * Saldo informado (manual/extrato) por dia civil.
   *
   * REGRA CENTRAL: o saldo manual SOBREPÕE o automático. O dia fecha no valor
   * informado e o dia seguinte abre nele — a série inteira re-ancora na
   * realidade, em vez de seguir acumulando um cálculo que o extrato já
   * desmentiu. A diferença entre os dois não é descartada: vira
   * {@link TreasuryCaixaRealizedDay.divergence}, que é o dinheiro que andou
   * sem título por trás.
   */
  informedClosingByCivilDate?: ReadonlyMap<string, number>;
};

export function applyTreasuryCaixaRunningBalance(
  days: readonly TreasuryCaixaRealizedDay[],
  options: TreasuryCaixaRunningBalanceOptions = {}
): TreasuryCaixaRealizedDay[] {
  const genesisCivilDate =
    options.genesisCivilDate ?? TREASURY_CAIXA_GENESIS_CIVIL_DATE;
  const informed = options.informedClosingByCivilDate;

  // Um saldo informado num dia SEM título movimentado ainda re-ancora a série.
  // Sem criar a linha, esse saldo real sumiria da tela e a cadeia seguiria
  // errada a partir dali.
  const byDate = new Map<string, TreasuryCaixaRealizedDay>();
  for (const d of days) byDate.set(d.civilDate, d);
  if (informed) {
    for (const civilDate of informed.keys()) {
      if (byDate.has(civilDate)) continue;
      byDate.set(civilDate, {
        civilDate,
        inflows: 0,
        outflows: 0,
        receivableCount: 0,
        payableCount: 0,
        opening: null,
        closing: null,
        closingCalculated: null,
        closingInformed: null,
        divergence: null,
      });
    }
  }

  const sorted = [...byDate.values()].sort((a, b) =>
    a.civilDate.localeCompare(b.civilDate)
  );

  let running: number | null = null;
  return sorted.map((d) => {
    if (d.civilDate < genesisCivilDate) {
      return {
        ...d,
        opening: null,
        closing: null,
        closingCalculated: null,
        closingInformed: null,
        divergence: null,
      };
    }
    if (running == null) running = 0;
    const opening = roundMoney(running);
    const closingCalculated = roundMoney(opening + d.inflows - d.outflows);
    const rawInformed = informed?.get(d.civilDate);
    const closingInformed =
      rawInformed != null && Number.isFinite(rawInformed)
        ? roundMoney(rawInformed)
        : null;
    const closing = closingInformed ?? closingCalculated;
    running = closing;
    return {
      ...d,
      opening,
      closing,
      closingCalculated,
      closingInformed,
      divergence:
        closingInformed != null
          ? roundMoney(closingInformed - closingCalculated)
          : null,
    };
  });
}

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
    // Saldo já vem acumulado desde a gênese (applyTreasuryCaixaRunningBalance,
    // rodado pelo chamador sobre a lista inteira antes de filtrar o período) —
    // aqui só repassamos. `null` continua significando "antes da gênese".
    const num = (v: number | null | undefined): number | null =>
      v != null && Number.isFinite(v) ? roundMoney(v) : null;
    const closing = num(d.closing);
    rows.push({
      civilDate: d.civilDate,
      kind: "REALIZED",
      opening: num(d.opening),
      inflows: d.inflows,
      outflows: d.outflows,
      closing,
      closingCalculated: num(d.closingCalculated),
      closingInformed: num(d.closingInformed),
      divergence: num(d.divergence),
      negative: closing != null && closing < 0,
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
      closingCalculated: input.todayFlow.closingCalculated,
      closingInformed: input.todayFlow.closingInformed,
      divergence: input.todayFlow.divergence,
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
      // Fallback pela agenda: é projeção, não fechamento — não há saldo
      // informado nem divergência a declarar.
      closingCalculated: closing,
      closingInformed: null,
      divergence: null,
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
      // Futuro é estimativa: não existe saldo informado nem divergência.
      closingCalculated: closing,
      closingInformed: null,
      divergence: null,
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
      opening: null,
      closing: null,
      closingCalculated: null,
      closingInformed: null,
      divergence: null,
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

/**
 * Passo 8 — números que se destacam (para cima ou para baixo).
 *
 * Marca os dias cujo movimento foge do padrão do período, para revisão manual.
 * Usa escore z MODIFICADO (Iglewicz & Hoaglin): mediana e MAD (desvio absoluto
 * mediano) no lugar de média e desvio padrão.
 *
 * Por que não média/desvio padrão: os dois são arrastados justamente pelos
 * valores extremos que queremos detectar — um único dia gigante infla o desvio
 * e passa a esconder a si mesmo. Mediana e MAD têm ponto de ruptura de 50%:
 * metade da série pode ser anômala sem contaminar a referência.
 *
 *     z = 0,6745 × (x − mediana) / MAD
 *
 * O fator 0,6745 é Φ⁻¹(0,75) — faz o MAD estimar a mesma escala do desvio
 * padrão quando os dados SÃO normais, mantendo o corte 3,5 comparável à regra
 * dos 3 sigmas.
 *
 * Dias sem movimento (valor zero) ficam fora da referência E da marcação: numa
 * série com muitos dias parados a mediana viraria zero e qualquer movimento
 * normal seria acusado de anômalo.
 */
export type TreasuryCaixaOutlierField = "inflows" | "outflows";
export type TreasuryCaixaOutlierDirection = "HIGH" | "LOW";

export type TreasuryCaixaOutlier = {
  civilDate: string;
  field: TreasuryCaixaOutlierField;
  value: number;
  /** Valor típico do período — referência contra a qual o dia se destacou. */
  median: number;
  modifiedZ: number;
  direction: TreasuryCaixaOutlierDirection;
  kind: TreasuryCaixaTimelineKind;
};

/** Corte clássico do escore z modificado. */
export const TREASURY_CAIXA_OUTLIER_Z_THRESHOLD = 3.5;

/** Φ⁻¹(0,75) — consistência do MAD para a normal. */
const MAD_NORMAL_CONSISTENCY = 0.6745;
/** Equivalente quando o MAD é zero e caímos no desvio médio absoluto. */
const MEAN_AD_NORMAL_CONSISTENCY = 0.7979;

/**
 * Com menos que isto qualquer valor parece extremo — não vale marcar nada.
 * Quatro é o mínimo para a mediana ter algum sentido nas duas metades.
 */
const TREASURY_CAIXA_OUTLIER_MIN_SAMPLE = 4;

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function detectTreasuryCaixaOutliers(
  rows: readonly TreasuryCaixaTimelineRow[],
  threshold: number = TREASURY_CAIXA_OUTLIER_Z_THRESHOLD
): TreasuryCaixaOutlier[] {
  const found: TreasuryCaixaOutlier[] = [];

  for (const field of ["inflows", "outflows"] as const) {
    const moving = rows.filter((r) => Number.isFinite(r[field]) && r[field] > 0);
    if (moving.length < TREASURY_CAIXA_OUTLIER_MIN_SAMPLE) continue;

    const values = moving.map((r) => r[field]);
    const median = medianOf(values);
    const mad = medianOf(values.map((v) => Math.abs(v - median)));

    let scale: number;
    let factor: number;
    if (mad > 0) {
      scale = mad;
      factor = MAD_NORMAL_CONSISTENCY;
    } else {
      // MAD zero = mais da metade dos dias tem o mesmo valor. Cai no desvio
      // médio, que ainda enxerga dispersão nas caudas.
      const meanAd =
        values.reduce((s, v) => s + Math.abs(v - median), 0) / values.length;
      if (!(meanAd > 0)) continue; // série constante: não há o que destacar
      scale = meanAd;
      factor = MEAN_AD_NORMAL_CONSISTENCY;
    }

    for (const r of moving) {
      const z = (factor * (r[field] - median)) / scale;
      if (!Number.isFinite(z) || Math.abs(z) < threshold) continue;
      found.push({
        civilDate: r.civilDate,
        field,
        value: r[field],
        median: roundMoney(median),
        modifiedZ: Math.round(z * 100) / 100,
        direction: z > 0 ? "HIGH" : "LOW",
        kind: r.kind,
      });
    }
  }

  return found.sort(
    (a, b) =>
      a.civilDate.localeCompare(b.civilDate) || a.field.localeCompare(b.field)
  );
}

/**
 * Passo 9 — série do gráfico: saldo final acumulado, mês a mês.
 *
 * O fechamento do mês JÁ é o saldo acumulado (a cadeia vem encadeada desde a
 * gênese), então o ponto é o próprio `closing` — nada é somado de novo aqui.
 * Mês sem fechamento não vira ponto: interpolar inventaria saldo.
 */
export type TreasuryCaixaBalanceChartPoint = {
  monthKey: string;
  label: string;
  closingBalance: number;
  kind: TreasuryCaixaMonthKind;
  isForecast: boolean;
};

const MONTH_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
] as const;

export function buildTreasuryCaixaMonthlyBalanceChart(
  months: readonly TreasuryCaixaTimelineMonth[]
): TreasuryCaixaBalanceChartPoint[] {
  const points: TreasuryCaixaBalanceChartPoint[] = [];
  for (const m of months) {
    if (m.closing == null || !Number.isFinite(m.closing)) continue;
    const [year, month] = m.monthKey.split("-");
    const index = Number(month) - 1;
    const label =
      year && index >= 0 && index < 12
        ? `${MONTH_ABBR[index]}/${year.slice(2)}`
        : m.monthKey;
    points.push({
      monthKey: m.monthKey,
      label,
      closingBalance: roundMoney(m.closing),
      kind: m.kind,
      isForecast: m.kind === "FORECAST",
    });
  }
  return points;
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
