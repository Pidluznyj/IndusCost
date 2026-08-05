/**
 * Motor de DELTAS dos cenários Otimista/Pessimista da Caixa — puro e
 * determinístico. Client-safe (sem Prisma, sem I/O).
 *
 * PRINCÍPIO (regra inegociável): o Realista É a série canônica da Linha do
 * tempo e NÃO é recalculado aqui. Este motor apenas responde: "se cada título
 * em aberto mudar da sua data Realista individual para a data do cenário,
 * qual a DIFERENÇA diária de entradas/saídas?" A série final de cada cenário
 * é: canônica + delta. O Realista permanece intocado por construção.
 *
 * ZONAS DO TEMPO:
 *  - Passado e HOJE: só realizado; deltas nunca tocam dias <= asOf
 *    (toda data de cenário é clampada para asOf+1 no mínimo).
 *  - Futuro: cada título em aberto muda apenas de DATA — nunca de valor.
 *
 * CONSERVAÇÃO: mover um título = tirar o valor da data Realista individual
 * (quando ela cai no futuro visível) e somar o MESMO valor na data do
 * cenário. Um título aparece uma única vez por cenário. Datas além do
 * horizonte não são jogadas no último dia: viram "fora do horizonte",
 * reportadas separadamente.
 *
 * DUPLA CONTAGEM: a população deste motor são SOMENTE títulos em aberto
 * (saldo > 0). Título liquidado — mesmo com baixa futura anômala no Nomus —
 * tem saldo 0 e não entra em delta nenhum; o realizado dele já vive na
 * série canônica. Um movimento é realizado OU projetado, nunca os dois.
 */

import { compareCivilDates } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryScenarioPolicyDto } from "../contracts/treasuryScenarioPolicyContracts.js";
import {
  resolvePayableProbableDate,
  resolveReceivableProbableDate,
} from "./treasuryMovementDateRules.js";
import type {
  TreasuryScenarioOpenPayable,
  TreasuryScenarioOpenReceivable,
} from "./treasuryCaixaScenarios.js";

// ── Utilitários de data civil (YYYY-MM-DD, sem fuso) ─────────────────────

function isCivil(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function civil(value: string | null | undefined): string | null {
  return isCivil(value) ? value.slice(0, 10) : null;
}

/** Soma dias corridos a uma data civil — UTC puro, imune a fuso/DST. */
export function addCivilDays(civilDate: string, days: number): string {
  const [y, m, d] = civilDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Diferença em dias corridos (b − a). */
export function diffCivilDays(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  const MS = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / MS
  );
}

function maxCivil(a: string, b: string): string {
  return compareCivilDates(a, b) >= 0 ? a : b;
}

function minOfCivil(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((best, cur) =>
    compareCivilDates(cur, best) < 0 ? cur : best
  );
}

function maxOfCivil(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((best, cur) =>
    compareCivilDates(cur, best) > 0 ? cur : best
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBr(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  return `${d}/${m}/${y}`;
}

// ── Contratos ────────────────────────────────────────────────────────────

export type TreasuryScenarioDeltaScenario = "OPTIMISTIC" | "PESSIMISTIC";

export type TreasuryScenarioDeltaAppliedRule =
  | "OPT_EARLIEST_DEFENSIBLE" // recebível: primeira data futura defensável
  | "OPT_LATEST_DEFENSIBLE" // pagamento: última data futura defensável
  | "PES_DELAY_GLOBAL" // recebível: atraso da política global
  | "PES_DELAY_CUSTOMER_P90" // recebível: atraso histórico do cliente
  | "PES_EARLIEST_DEMANDABLE" // pagamento: primeira data exigível
  | "CLAMPED_NEXT_DAY" // sem projeção Realista futura → entra em D+1
  | "UNPROJECTABLE" // nenhuma data válida — fora dos cenários
  | "UNCHANGED"; // data do cenário == data Realista (delta zero)

export type TreasuryScenarioDeltaMemoryEntry = {
  scenario: TreasuryScenarioDeltaScenario;
  sourceType: "RECEIVABLE" | "PAYABLE";
  sourceId: number;
  documentNumber: string | null;
  counterpartyName: string | null;
  amount: number;
  originalDueDate: string | null;
  activePromiseDate: string | null;
  scheduledDate: string | null;
  expectedDate: string | null;
  /** Data Realista individual (regra atual), quando cai no futuro visível. */
  realisticIndividualDate: string | null;
  /** Data projetada pelo cenário (sempre > asOf); null = não projetável. */
  scenarioDate: string | null;
  /** scenarioDate − realisticIndividualDate, em dias; null sem base Realista. */
  deltaFromRealisticDays: number | null;
  appliedRule: TreasuryScenarioDeltaAppliedRule;
  parameterSource: string | null;
  isBeyondHorizon: boolean;
  explanation: string;
};

export type TreasuryScenarioDeltaDay = {
  civilDate: string;
  inflowDelta: number;
  outflowDelta: number;
};

export type TreasuryScenarioDeltaSet = {
  /** Só dias com delta ≠ 0, ordenados. Todos com civilDate > asOf. */
  byDay: TreasuryScenarioDeltaDay[];
  /** Valores deslocados para depois do horizonte — nunca no último dia. */
  outOfHorizonInflow: number;
  outOfHorizonOutflow: number;
  changedTitleCount: number;
};

export type TreasuryScenarioDeltasResult = {
  asOfCivilDate: string;
  horizonEndCivilDate: string;
  optimistic: TreasuryScenarioDeltaSet;
  pessimistic: TreasuryScenarioDeltaSet;
  memory: TreasuryScenarioDeltaMemoryEntry[];
  /** Parâmetro global em uso (memória de cálculo do padrão). */
  pessimisticDelayDaysGlobal: number;
};

export type TreasuryScenarioDeltasInput = {
  asOfCivilDate: TreasuryCivilDate;
  /** Último dia visível da projeção. */
  horizonEndCivilDate: string;
  /** População: SOMENTE títulos em aberto (saldo > 0, não suspensos). */
  openReceivables: readonly TreasuryScenarioOpenReceivable[];
  openPayables: readonly TreasuryScenarioOpenPayable[];
  policy: TreasuryScenarioPolicyDto;
  /**
   * Atraso pessimista por cliente (percentil 90 do histórico), chaveado por
   * CNPJ/CPF normalizado. Prioridade sobre a política global. Vazio enquanto
   * não houver fonte de histórico confiável — o motor cai no parâmetro
   * global configurável (nunca número mágico espalhado).
   */
  customerPessimisticDelayDays?: ReadonlyMap<string, number>;
};

// ── Motor ────────────────────────────────────────────────────────────────

type MutableDeltaSet = {
  byDay: Map<string, { inflowDelta: number; outflowDelta: number }>;
  outOfHorizonInflow: number;
  outOfHorizonOutflow: number;
  changedTitleCount: number;
};

function emptySet(): MutableDeltaSet {
  return {
    byDay: new Map(),
    outOfHorizonInflow: 0,
    outOfHorizonOutflow: 0,
    changedTitleCount: 0,
  };
}

function bump(
  set: MutableDeltaSet,
  civilDate: string,
  side: "in" | "out",
  amount: number
) {
  const cur = set.byDay.get(civilDate) ?? { inflowDelta: 0, outflowDelta: 0 };
  if (side === "in") cur.inflowDelta += amount;
  else cur.outflowDelta += amount;
  set.byDay.set(civilDate, cur);
}

/**
 * Aplica o deslocamento de UM título em UM cenário:
 *  +valor na data do cenário (ou fora do horizonte);
 *  −valor na data Realista individual (quando ela existe no futuro visível).
 * Conservação por construção — o mesmo valor sai de um dia e entra no outro.
 */
function applyShift(params: {
  set: MutableDeltaSet;
  side: "in" | "out";
  amount: number;
  realisticFutureDate: string | null;
  scenarioDate: string;
  horizonEnd: string;
}): { isBeyondHorizon: boolean } {
  const { set, side, amount, realisticFutureDate, scenarioDate, horizonEnd } =
    params;
  const beyond = compareCivilDates(scenarioDate, horizonEnd) > 0;
  if (beyond) {
    if (side === "in") set.outOfHorizonInflow += amount;
    else set.outOfHorizonOutflow += amount;
  } else {
    bump(set, scenarioDate, side, amount);
  }
  if (
    realisticFutureDate != null &&
    compareCivilDates(realisticFutureDate, horizonEnd) <= 0
  ) {
    bump(set, realisticFutureDate, side, -amount);
  }
  set.changedTitleCount += 1;
  return { isBeyondHorizon: beyond };
}

function finalizeSet(set: MutableDeltaSet): TreasuryScenarioDeltaSet {
  const byDay = [...set.byDay.entries()]
    .map(([civilDate, v]) => ({
      civilDate,
      inflowDelta: roundMoney(v.inflowDelta),
      outflowDelta: roundMoney(v.outflowDelta),
    }))
    .filter((d) => d.inflowDelta !== 0 || d.outflowDelta !== 0)
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  return {
    byDay,
    outOfHorizonInflow: roundMoney(set.outOfHorizonInflow),
    outOfHorizonOutflow: roundMoney(set.outOfHorizonOutflow),
    changedTitleCount: set.changedTitleCount,
  };
}

export function computeTreasuryCaixaScenarioDeltas(
  input: TreasuryScenarioDeltasInput
): TreasuryScenarioDeltasResult {
  const asOf = input.asOfCivilDate.slice(0, 10);
  const horizonEnd = input.horizonEndCivilDate.slice(0, 10);
  const dPlus1 = addCivilDays(asOf, 1);
  const policy = input.policy;
  const customerDelay = input.customerPessimisticDelayDays;

  const opt = emptySet();
  const pes = emptySet();
  const memory: TreasuryScenarioDeltaMemoryEntry[] = [];

  // ── Contas a Receber ──────────────────────────────────────────────────
  for (const r of input.openReceivables) {
    const amount = roundMoney(Number(r.balanceReceivable));
    // Só títulos em aberto: liquidado (saldo 0) nunca entra — é a barreira
    // formal contra dupla contagem com o realizado da série canônica.
    if (!(amount > 0)) continue;

    const due = civil(r.dueDate);
    const promise = civil(r.activePromiseDate);
    const promiseActive =
      promise != null &&
      (r.activePromiseStatus == null ||
        r.activePromiseStatus === "ACTIVE" ||
        r.activePromiseStatus === "PARTIALLY_FULFILLED");
    const expected = civil(r.expectedDate);

    // Data Realista individual — mesma regra atual do domínio (PROBABLE:
    // promessa ativa → prevista → vencimento não vencido; vencido sem
    // evidência → sem data). Usada SÓ para posicionar o lado negativo do
    // delta; nunca para reconstruir a série canônica.
    const probable = resolveReceivableProbableDate(
      {
        dueDate: r.dueDate,
        expectedDate: r.expectedDate ?? null,
        confirmedDate: r.confirmedDate ?? null,
        activePromiseDate: r.activePromiseDate ?? null,
        activePromiseStatus: r.activePromiseStatus ?? null,
      },
      asOf
    );
    const realisticRaw = civil(probable.resolvedDate);
    const realisticFuture =
      realisticRaw != null && compareCivilDates(realisticRaw, asOf) > 0
        ? realisticRaw
        : null;

    const base = {
      sourceType: "RECEIVABLE" as const,
      sourceId: r.externalId,
      documentNumber: r.documentNumber ?? null,
      counterpartyName: r.personName,
      amount,
      originalDueDate: due,
      activePromiseDate: promiseActive ? promise : null,
      scheduledDate: null,
      expectedDate: expected,
      realisticIndividualDate: realisticFuture,
    };

    // OTIMISTA: primeira data futura defensável entre as datas existentes.
    const optCandidates: Array<{ date: string; label: string }> = [];
    if (promiseActive && promise) optCandidates.push({ date: promise, label: "promessa ativa" });
    if (expected) optCandidates.push({ date: expected, label: "data prevista" });
    if (due) optCandidates.push({ date: due, label: "vencimento oficial" });
    if (realisticRaw) optCandidates.push({ date: realisticRaw, label: "data Realista individual" });

    if (optCandidates.length === 0) {
      // Sem NENHUMA data válida: o título não pode ser projetado em cenário
      // algum — nunca vira "hoje"/zero/epoch. Fica fora com memória nos dois
      // cenários e segue para o próximo título.
      for (const scenario of ["OPTIMISTIC", "PESSIMISTIC"] as const) {
        memory.push({
          scenario,
          ...base,
          scenarioDate: null,
          deltaFromRealisticDays: null,
          appliedRule: "UNPROJECTABLE",
          parameterSource: null,
          isBeyondHorizon: false,
          explanation:
            "Recebível sem nenhuma data válida (vencimento, promessa ou previsão) — fora dos cenários.",
        });
      }
      continue;
    } else {
      const earliest = minOfCivil(optCandidates.map((c) => c.date))!;
      const winner = optCandidates.find((c) => c.date === earliest)!;
      const optDate = maxCivil(dPlus1, earliest);
      const clamped = compareCivilDates(earliest, dPlus1) < 0;

      if (optDate === realisticFuture) {
        // Delta zero — nada muda; sem entrada de memória (ruído).
      } else {
        const { isBeyondHorizon } = applyShift({
          set: opt,
          side: "in",
          amount,
          realisticFutureDate: realisticFuture,
          scenarioDate: optDate,
          horizonEnd,
        });
        memory.push({
          scenario: "OPTIMISTIC",
          ...base,
          scenarioDate: optDate,
          deltaFromRealisticDays:
            realisticFuture != null ? diffCivilDays(realisticFuture, optDate) : null,
          appliedRule: clamped
            ? "CLAMPED_NEXT_DAY"
            : realisticFuture == null
              ? "CLAMPED_NEXT_DAY"
              : "OPT_EARLIEST_DEFENSIBLE",
          parameterSource: null,
          isBeyondHorizon,
          explanation:
            realisticFuture == null
              ? `Título em aberto sem projeção Realista futura (datas anteriores à data-base). Otimista projeta a entrada em ${formatBr(optDate)} (próximo dia disponível).`
              : clamped
                ? `Recebimento antecipado de ${formatBr(realisticFuture)} para ${formatBr(optDate)} — ${winner.label} anterior à data-base, clampado para o próximo dia futuro.`
                : `Recebimento antecipado de ${formatBr(realisticFuture)} para ${formatBr(optDate)} porque ${winner.label} é a primeira data futura defensável.`,
        });
      }
    }

    // PESSIMISTA: base = max(D+1, data Realista individual ?? vencimento),
    // depois soma o atraso pessimista (cliente P90 → política global).
    const pesBaseSource = realisticRaw ?? due;
    const pesBase =
      pesBaseSource != null ? maxCivil(dPlus1, pesBaseSource) : dPlus1;
    const customerKey = (r.personCnpj ?? "").replace(/\D/g, "");
    const customerP90 =
      customerKey && customerDelay ? customerDelay.get(customerKey) : undefined;
    const overdue = due != null && compareCivilDates(due, asOf) < 0;
    const globalDelay = overdue
      ? policy.pessimisticOverdueReceivableDelayDays ??
        policy.pessimisticReceivableDelayDays
      : policy.pessimisticReceivableDelayDays;
    const delayDays = !policy.pessimisticEnabled
      ? 0
      : customerP90 != null
        ? customerP90
        : globalDelay;
    const parameterSource = !policy.pessimisticEnabled
      ? "POLITICA_DESATIVADA"
      : customerP90 != null
        ? "HISTORICO_CLIENTE_P90"
        : "POLITICA_GLOBAL";
    const pesDate = addCivilDays(pesBase, delayDays);

    if (pesDate !== realisticFuture) {
      const { isBeyondHorizon } = applyShift({
        set: pes,
        side: "in",
        amount,
        realisticFutureDate: realisticFuture,
        scenarioDate: pesDate,
        horizonEnd,
      });
      memory.push({
        scenario: "PESSIMISTIC",
        ...base,
        scenarioDate: pesDate,
        deltaFromRealisticDays:
          realisticFuture != null ? diffCivilDays(realisticFuture, pesDate) : null,
        appliedRule:
          customerP90 != null ? "PES_DELAY_CUSTOMER_P90" : "PES_DELAY_GLOBAL",
        parameterSource,
        isBeyondHorizon,
        explanation:
          realisticFuture == null
            ? `Título em aberto com datas anteriores à data-base. Projeção pessimista iniciada em ${formatBr(pesBase)} + ${delayDays} dias de atraso → ${formatBr(pesDate)} (${parameterSource === "HISTORICO_CLIENTE_P90" ? "histórico do cliente" : "parâmetro global"}).`
            : `Recebimento postergado de ${formatBr(realisticFuture)} para ${formatBr(pesDate)} pela aplicação de ${delayDays} dias de atraso pessimista (${parameterSource === "HISTORICO_CLIENTE_P90" ? "percentil 90 do cliente" : "parâmetro global configurável"}).`,
      });
    }
  }

  // ── Contas a Pagar ────────────────────────────────────────────────────
  for (const p of input.openPayables) {
    const amount = roundMoney(Number(p.balancePayable));
    if (!(amount > 0)) continue;

    const due = civil(p.dueDate);
    const scheduled = civil(p.scheduledDate);
    const expected = civil(p.expectedDate);

    const probable = resolvePayableProbableDate({
      dueDate: p.dueDate,
      expectedDate: p.expectedDate ?? null,
      confirmedDate: p.confirmedDate ?? null,
      scheduledDate: p.scheduledDate ?? null,
      programmingStatus: p.programmingStatus ?? null,
    });
    const realisticRaw = civil(probable.resolvedDate);
    const realisticFuture =
      realisticRaw != null && compareCivilDates(realisticRaw, asOf) > 0
        ? realisticRaw
        : null;

    const base = {
      sourceType: "PAYABLE" as const,
      sourceId: p.externalId,
      documentNumber: p.documentNumber ?? null,
      counterpartyName: p.personName,
      amount,
      originalDueDate: due,
      activePromiseDate: null,
      scheduledDate: scheduled,
      expectedDate: expected,
      realisticIndividualDate: realisticFuture,
    };

    const candidates: Array<{ date: string; label: string }> = [];
    if (scheduled) candidates.push({ date: scheduled, label: "data agendada" });
    if (expected) candidates.push({ date: expected, label: "data prevista" });
    if (due) candidates.push({ date: due, label: "vencimento oficial" });
    if (realisticRaw)
      candidates.push({ date: realisticRaw, label: "data Realista individual" });

    if (candidates.length === 0) {
      for (const scenario of ["OPTIMISTIC", "PESSIMISTIC"] as const) {
        memory.push({
          scenario,
          ...base,
          scenarioDate: null,
          deltaFromRealisticDays: null,
          appliedRule: "UNPROJECTABLE",
          parameterSource: null,
          isBeyondHorizon: false,
          explanation:
            "Pagamento sem nenhuma data válida (vencimento, agenda ou previsão) — fora dos cenários.",
        });
      }
      continue;
    }

    // OTIMISTA: última data futura defensável (só datas já existentes —
    // nenhuma prorrogação é inventada).
    const latest = maxOfCivil(candidates.map((c) => c.date))!;
    const optWinner = candidates.find((c) => c.date === latest)!;
    const optDate = maxCivil(dPlus1, latest);
    if (optDate !== realisticFuture) {
      const { isBeyondHorizon } = applyShift({
        set: opt,
        side: "out",
        amount,
        realisticFutureDate: realisticFuture,
        scenarioDate: optDate,
        horizonEnd,
      });
      memory.push({
        scenario: "OPTIMISTIC",
        ...base,
        scenarioDate: optDate,
        deltaFromRealisticDays:
          realisticFuture != null ? diffCivilDays(realisticFuture, optDate) : null,
        appliedRule: "OPT_LATEST_DEFENSIBLE",
        parameterSource: null,
        isBeyondHorizon,
        explanation:
          realisticFuture == null
            ? `Pagamento em aberto sem projeção Realista futura. Otimista projeta a saída em ${formatBr(optDate)} (${optWinner.label}).`
            : `Pagamento postergado de ${formatBr(realisticFuture)} para ${formatBr(optDate)} porque ${optWinner.label} é a última data defensável disponível.`,
      });
    }

    // PESSIMISTA: primeira data futura exigível.
    const earliest = minOfCivil(candidates.map((c) => c.date))!;
    const pesWinner = candidates.find((c) => c.date === earliest)!;
    const pesDate = maxCivil(dPlus1, earliest);
    if (pesDate !== realisticFuture) {
      const { isBeyondHorizon } = applyShift({
        set: pes,
        side: "out",
        amount,
        realisticFutureDate: realisticFuture,
        scenarioDate: pesDate,
        horizonEnd,
      });
      memory.push({
        scenario: "PESSIMISTIC",
        ...base,
        scenarioDate: pesDate,
        deltaFromRealisticDays:
          realisticFuture != null ? diffCivilDays(realisticFuture, pesDate) : null,
        appliedRule: "PES_EARLIEST_DEMANDABLE",
        parameterSource: null,
        isBeyondHorizon,
        explanation:
          realisticFuture == null
            ? `Pagamento em aberto com datas anteriores à data-base. Pessimista projeta a saída em ${formatBr(pesDate)} (próximo dia disponível).`
            : `Pagamento antecipado de ${formatBr(realisticFuture)} para ${formatBr(pesDate)} porque ${pesWinner.label} é a primeira data em que pode pressionar o caixa.`,
      });
    }
  }

  return {
    asOfCivilDate: asOf,
    horizonEndCivilDate: horizonEnd,
    optimistic: finalizeSet(opt),
    pessimistic: finalizeSet(pes),
    memory,
    pessimisticDelayDaysGlobal: policy.pessimisticReceivableDelayDays,
  };
}

// ── Aplicação do delta sobre a série canônica ────────────────────────────

/**
 * Aplica o delta acumulado sobre os fechamentos da série canônica Realista.
 *
 * Matemática: fechamento = abertura + Σ fluxos; somar deltas aos fluxos de
 * cada dia desloca o fechamento pelo delta LÍQUIDO ACUMULADO até aquele dia.
 * Dias <= asOf nunca têm delta → passado e hoje idênticos nos três cenários.
 * A série Realista de entrada não é modificada — apenas somada.
 */
export function applyScenarioDeltasToClosings(input: {
  /** Dias do gráfico, em ordem cronológica. */
  orderedCivilDates: readonly string[];
  /** Fechamento canônico Realista por dia (null = indisponível). */
  realisticClosingByDay: ReadonlyMap<string, number | null>;
  deltas: TreasuryScenarioDeltaSet;
}): Map<string, number | null> {
  const deltaByDay = new Map(input.deltas.byDay.map((d) => [d.civilDate, d]));
  const out = new Map<string, number | null>();
  let cumulative = 0;
  for (const civilDate of input.orderedCivilDates) {
    const d = deltaByDay.get(civilDate);
    if (d) cumulative = roundMoney(cumulative + d.inflowDelta - d.outflowDelta);
    const base = input.realisticClosingByDay.get(civilDate);
    out.set(
      civilDate,
      base == null ? null : roundMoney(base + cumulative)
    );
  }
  return out;
}

// ── Resumo executivo determinístico (sem IA — templates fixos) ───────────

export type TreasuryScenarioExecutiveInput = {
  minBalance: number | null;
  minBalanceDate: string | null;
  firstNegativeDate: string | null;
  maxCashNeed: number;
  finalBalance: number | null;
};

function moneyBr(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Frases fixas montadas por regra determinística a partir dos números já
 * calculados. Nenhum texto é gerado por modelo — apenas templates.
 */
export function buildTreasuryScenarioExecutiveLines(input: {
  realistic: TreasuryScenarioExecutiveInput;
  optimistic: TreasuryScenarioExecutiveInput;
  pessimistic: TreasuryScenarioExecutiveInput;
  optimisticTopMovers: readonly string[];
}): string[] {
  const lines: string[] = [];
  const r = input.realistic;
  const o = input.optimistic;
  const p = input.pessimistic;

  if (r.minBalance != null && r.minBalanceDate != null) {
    lines.push(
      `Na projeção Realista, o menor saldo é ${moneyBr(r.minBalance)} em ${formatBr(r.minBalanceDate)}.`
    );
  }
  if (p.firstNegativeDate != null && p.maxCashNeed > 0) {
    lines.push(
      `No cenário Pessimista, o caixa fica negativo em ${formatBr(p.firstNegativeDate)} e exige ${moneyBr(p.maxCashNeed)} de capital de giro.`
    );
  } else if (p.minBalance != null && p.minBalanceDate != null) {
    lines.push(
      `No cenário Pessimista, o menor saldo cai para ${moneyBr(p.minBalance)} em ${formatBr(p.minBalanceDate)}, sem ficar negativo.`
    );
  }
  if (o.minBalance != null && r.minBalance != null) {
    const movers =
      input.optimisticTopMovers.length > 0
        ? ` devido principalmente a ${input.optimisticTopMovers.slice(0, 3).join(", ")}`
        : "";
    lines.push(
      `No cenário Otimista, o menor saldo ${o.minBalance >= r.minBalance ? "melhora" : "muda"} para ${moneyBr(o.minBalance)}${movers}.`
    );
  }
  return lines;
}
