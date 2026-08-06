/**
 * Motor de cenários por VOLUME DE VENDAS — puro e determinístico (client-safe).
 *
 * CONCEITO (substitui o modelo de antecipação/postergação de datas):
 *   Otimista  = "e se o volume financeiro de vendas futuras crescer +20%?"
 *   Pessimista = "e se o volume financeiro de vendas futuras cair −20%?"
 *
 * O Realista É a série canônica da Linha do tempo e NÃO é recalculado aqui.
 * Este motor simula APENAS a fatia incremental (±pct sobre a base de
 * referência) de vendas NOVAS — vendas que ainda não existem no pipeline
 * oficial (Proposta/PV/Doc. Saída/NF-e/CR). Por construção não há dupla
 * contagem: títulos oficiais já vivem no Realista e nunca são multiplicados;
 * a simulação nunca replica um evento comercial existente (prioridade 6 da
 * hierarquia de cobertura — projeção estatística de novas vendas).
 *
 * A venda simulada NÃO entra no caixa no dia da venda: ela é convertida em
 * recebimentos pelo perfil real venda→recebimento (condições de pagamento /
 * histórico) e em saídas variáveis (MP, impostos, comissões, fretes) pelos
 * prazos de cada categoria. Custos fixos nunca entram — não fazem parte do
 * input do motor. Valores além do horizonte viram "fora do horizonte",
 * nunca caem no último dia.
 *
 * Tudo aqui é assinado: no Pessimista as entradas incrementais são negativas
 * (perda de recebimento) e as saídas variáveis também (economia), enquanto
 * custos fixos ficam intactos por não existirem neste motor.
 */

import {
  addCivilDays,
  type TreasuryScenarioDeltaDay,
  type TreasuryScenarioDeltaSet,
} from "./treasuryCaixaScenarioDeltas.js";
import type { TreasurySalesVolumeScenarioPolicy } from "../contracts/treasurySalesVolumeScenarioPolicy.js";

// ── Contratos de entrada (o service carrega das fontes oficiais; testes
//    usam fixtures — percentuais simplificados só em teste) ────────────────

export type TreasurySalesVolumeBaseline = {
  source: "COMMERCIAL_FORECAST" | "SALES_HISTORY" | "MANUAL";
  /** Média mensal do valor vendido de referência (medida canônica). */
  monthlyAverageAmount: number;
  /** Meses completos usados (["2026-02", ...]) — auditabilidade. */
  monthsUsed: readonly string[];
  /** Medida financeira canônica utilizada. */
  measure: "SALES_ORDER_TOTAL_NET_VALUE";
  /** Descrição da base para premissas (ex.: "média dos últimos 6 meses"). */
  description: string;
};

/** Bucket do perfil venda→recebimento; weights devem somar ~1. */
export type TreasuryReceiptLagBucket = {
  /** Dias corridos entre a venda (issueDate) e o recebimento efetivo. */
  lagDays: number;
  /** Fração do valor recebido nesse prazo (ponderada por valor). */
  weight: number;
};

export type TreasuryReceiptLagProfile = {
  buckets: readonly TreasuryReceiptLagBucket[];
  /** Fonte declarada (ex.: "CR→NF-e→PV — prazo real, ponderado por valor"). */
  source: string;
  /** true quando caiu no parâmetro configurável (sem histórico suficiente). */
  isFallback: boolean;
};

export type TreasuryVariableCostKind =
  | "RAW_MATERIAL"
  | "TAX"
  | "COMMISSION"
  | "FREIGHT";

export type TreasuryVariableCostInput = {
  kind: TreasuryVariableCostKind;
  /** Fração do valor vendido (0..1) — fonte oficial, nunca inventada. */
  ratio: number;
  ratioSource: string;
  /** Dias corridos após a venda de referência em que a saída ocorre. */
  outflowLagDays: number;
  lagSource: string;
  isFallbackLag: boolean;
};

export type TreasurySalesVolumeScenarioInput = {
  asOfCivilDate: string;
  horizonEndCivilDate: string;
  policy: TreasurySalesVolumeScenarioPolicy;
  baseline: TreasurySalesVolumeBaseline;
  receiptLagProfile: TreasuryReceiptLagProfile;
  /** Somente categorias com fonte confiável — ausência = cobertura parcial. */
  variableCosts: readonly TreasuryVariableCostInput[];
  /** Avisos de cobertura vindos do carregador (ex.: "frete sem regra"). */
  coverageWarnings: readonly string[];
};

// ── Contratos de saída ───────────────────────────────────────────────────

export type TreasurySalesVolumeMovementType =
  | "SCENARIO_SALES_INFLOW"
  | "SCENARIO_RAW_MATERIAL_OUTFLOW"
  | "SCENARIO_TAX_OUTFLOW"
  | "SCENARIO_COMMISSION_OUTFLOW"
  | "SCENARIO_FREIGHT_OUTFLOW";

export type TreasurySalesVolumeMemoryEntry = {
  scenario: "OPTIMISTIC" | "PESSIMISTIC";
  simulationType: "SALES_VOLUME_SENSITIVITY";
  movementType: TreasurySalesVolumeMovementType;
  cashDirection: "IN" | "OUT";
  /** Mês da venda de referência que originou o movimento ("2026-08"). */
  baselinePeriod: string;
  baselineSource: string;
  baselineSalesAmount: number;
  variationPct: number;
  /** Vendas incrementais do mês (assinado; negativo no Pessimista). */
  incrementalSalesAmount: number;
  /** Fonte do rateio/prazo usado (condição de pagamento, custo etc.). */
  parameterSource: string;
  /** Valor DENTRO do horizonte gerado por este mês/tipo (assinado). */
  inWindowAmount: number;
  /** Valor deslocado para DEPOIS do horizonte (assinado). */
  beyondHorizonAmount: number;
  /** Primeira/última data em que o movimento cai dentro do horizonte. */
  firstMovementDate: string | null;
  lastMovementDate: string | null;
  isSimulated: true;
  isOfficial: false;
  explanation: string;
};

export type TreasurySalesVolumeScenarioIndicators = {
  scenario: "OPTIMISTIC" | "PESSIMISTIC";
  variationPct: number;
  /** Vendas incrementais simuladas dentro do horizonte (assinado). */
  incrementalSalesInWindow: number;
  /** Recebimentos incrementais dentro/fora do horizonte (assinados). */
  inflowsInWindow: number;
  inflowsBeyondHorizon: number;
  /** Saídas variáveis dentro/fora do horizonte (assinadas). */
  outflowsInWindow: number;
  outflowsBeyondHorizon: number;
  /** inflowsInWindow − outflowsInWindow. */
  netEffectInWindow: number;
  /**
   * Pico de caixa CONSUMIDO pelo cenário antes de devolver (delta líquido
   * acumulado mais negativo). No Otimista = capital de giro necessário para
   * crescer; 0 quando o cenário nunca consome caixa.
   */
  peakCashConsumed: number;
  peakCashConsumedDate: string | null;
  /**
   * Pico de caixa LIBERADO (delta acumulado mais positivo) — no Pessimista
   * captura o alívio temporário por comprar menos antes de perder receita.
   */
  peakCashReleased: number;
  peakCashReleasedDate: string | null;
  /** Primeiro dia em que o delta acumulado fica positivo (Otimista). */
  firstNetPositiveDate: string | null;
  /** Primeiro dia em que o delta acumulado fica negativo (Pessimista). */
  firstNetNegativeDate: string | null;
};

export type TreasurySalesVolumeCoverage = {
  /** Soma das frações de custo variável com fonte confiável (0..1). */
  variableCostRatioTotal: number;
  includedCostKinds: readonly TreasuryVariableCostKind[];
  /** Categorias SEM fonte confiável — declaradas, nunca inventadas. */
  excludedCostKinds: readonly TreasuryVariableCostKind[];
  receiptProfileIsFallback: boolean;
  warnings: readonly string[];
  /** true quando alguma categoria ficou de fora — a tela deve avisar. */
  isPartial: boolean;
};

export type TreasurySalesVolumeScenariosResult = {
  conceptVersion: "SALES_VOLUME_V1";
  asOfCivilDate: string;
  horizonEndCivilDate: string;
  optimistic: TreasuryScenarioDeltaSet;
  pessimistic: TreasuryScenarioDeltaSet;
  optimisticIndicators: TreasurySalesVolumeScenarioIndicators;
  pessimisticIndicators: TreasurySalesVolumeScenarioIndicators;
  memory: TreasurySalesVolumeMemoryEntry[];
  /** Premissas realmente aplicadas (texto pronto para a UI). */
  assumptions: string[];
  coverage: TreasurySalesVolumeCoverage;
  baseline: TreasurySalesVolumeBaseline;
};

// ── Utilitários ──────────────────────────────────────────────────────────

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBr(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  return `${d}/${m}/${y}`;
}

function moneyBr(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Dia útil civil (seg–sex) — UTC puro, imune a fuso. */
export function isBusinessCivilDay(civilDate: string): boolean {
  const [y, m, d] = civilDate.slice(0, 10).split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

const MOVEMENT_LABEL: Record<TreasurySalesVolumeMovementType, string> = {
  SCENARIO_SALES_INFLOW: "Recebimentos das vendas simuladas",
  SCENARIO_RAW_MATERIAL_OUTFLOW: "Matéria-prima e insumos variáveis",
  SCENARIO_TAX_OUTFLOW: "Impostos variáveis sobre vendas",
  SCENARIO_COMMISSION_OUTFLOW: "Comissões variáveis",
  SCENARIO_FREIGHT_OUTFLOW: "Fretes variáveis",
};

const COST_KIND_TO_MOVEMENT: Record<
  TreasuryVariableCostKind,
  TreasurySalesVolumeMovementType
> = {
  RAW_MATERIAL: "SCENARIO_RAW_MATERIAL_OUTFLOW",
  TAX: "SCENARIO_TAX_OUTFLOW",
  COMMISSION: "SCENARIO_COMMISSION_OUTFLOW",
  FREIGHT: "SCENARIO_FREIGHT_OUTFLOW",
};

const ALL_COST_KINDS: readonly TreasuryVariableCostKind[] = [
  "RAW_MATERIAL",
  "TAX",
  "COMMISSION",
  "FREIGHT",
];

// ── Motor ────────────────────────────────────────────────────────────────

type MutableSet = {
  byDay: Map<string, { inflowDelta: number; outflowDelta: number }>;
  outOfHorizonInflow: number;
  outOfHorizonOutflow: number;
};

type MemoryAccumulator = Map<
  string, // `${scenario}|${month}|${movementType}`
  {
    inWindow: number;
    beyond: number;
    first: string | null;
    last: string | null;
    incrementalSales: number;
    parameterSource: string;
  }
>;

function bump(
  set: MutableSet,
  civilDate: string,
  side: "in" | "out",
  amount: number
) {
  const cur = set.byDay.get(civilDate) ?? { inflowDelta: 0, outflowDelta: 0 };
  if (side === "in") cur.inflowDelta += amount;
  else cur.outflowDelta += amount;
  set.byDay.set(civilDate, cur);
}

function finalizeSet(set: MutableSet): TreasuryScenarioDeltaSet {
  const byDay: TreasuryScenarioDeltaDay[] = [...set.byDay.entries()]
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
    changedTitleCount: byDay.length,
  };
}

export function computeTreasurySalesVolumeScenarios(
  input: TreasurySalesVolumeScenarioInput
): TreasurySalesVolumeScenariosResult {
  const asOf = input.asOfCivilDate.slice(0, 10);
  const horizonEnd = input.horizonEndCivilDate.slice(0, 10);
  const policy = input.policy;

  // Perfil de recebimento saneado: buckets inválidos são descartados (datas
  // nulas/NaN jamais viram hoje/zero/epoch) e o peso é renormalizado.
  const buckets = input.receiptLagProfile.buckets.filter(
    (b) =>
      Number.isFinite(b.lagDays) &&
      b.lagDays >= 0 &&
      Number.isFinite(b.weight) &&
      b.weight > 0
  );
  const weightSum = buckets.reduce((s, b) => s + b.weight, 0);
  const normBuckets =
    weightSum > 0
      ? buckets.map((b) => ({ lagDays: Math.round(b.lagDays), weight: b.weight / weightSum }))
      : [];

  const costs = input.variableCosts.filter(
    (c) =>
      Number.isFinite(c.ratio) &&
      c.ratio > 0 &&
      Number.isFinite(c.outflowLagDays) &&
      c.outflowLagDays >= 0
  );

  // Dias úteis simuláveis: estritamente após asOf, até o horizonte.
  const saleDays: string[] = [];
  for (
    let d = addCivilDays(asOf, 1);
    d <= horizonEnd;
    d = addCivilDays(d, 1)
  ) {
    if (isBusinessCivilDay(d)) saleDays.push(d);
  }
  const businessDaysByMonth = new Map<string, number>();
  for (const d of saleDays) {
    const m = d.slice(0, 7);
    businessDaysByMonth.set(m, (businessDaysByMonth.get(m) ?? 0) + 1);
  }
  // Base diária: média mensal distribuída pelos dias úteis de um mês típico
  // (~21). Usar os dias úteis do próprio mês manteria o total mensal exato,
  // mas distorceria meses parciais na borda do horizonte; o run rate diário
  // constante é a leitura correta de "volume de referência" sem sazonalidade.
  const TYPICAL_BUSINESS_DAYS_PER_MONTH = 21;
  const dailyBaselineSales =
    input.baseline.monthlyAverageAmount > 0
      ? input.baseline.monthlyAverageAmount / TYPICAL_BUSINESS_DAYS_PER_MONTH
      : 0;

  const memoryAcc: MemoryAccumulator = new Map();

  function accumulate(
    scenario: "OPTIMISTIC" | "PESSIMISTIC",
    month: string,
    movementType: TreasurySalesVolumeMovementType,
    parameterSource: string,
    incrementalSales: number,
    amount: number,
    date: string | null, // null = além do horizonte
    beyondAmount: number
  ) {
    const key = `${scenario}|${month}|${movementType}`;
    const cur =
      memoryAcc.get(key) ??
      {
        inWindow: 0,
        beyond: 0,
        first: null as string | null,
        last: null as string | null,
        incrementalSales: 0,
        parameterSource,
      };
    cur.inWindow += amount;
    cur.beyond += beyondAmount;
    if (date != null) {
      if (cur.first == null || date < cur.first) cur.first = date;
      if (cur.last == null || date > cur.last) cur.last = date;
    }
    cur.incrementalSales += incrementalSales;
    memoryAcc.set(key, cur);
  }

  function runScenario(
    scenario: "OPTIMISTIC" | "PESSIMISTIC",
    variationPct: number
  ): { set: TreasuryScenarioDeltaSet } {
    const set: MutableSet = {
      byDay: new Map(),
      outOfHorizonInflow: 0,
      outOfHorizonOutflow: 0,
    };
    const factor = variationPct / 100;
    if (dailyBaselineSales <= 0 || factor === 0 || normBuckets.length === 0) {
      // Sem base ou sem perfil de recebimento não há simulação defensável;
      // cobertura/premissas explicam o porquê.
      return { set: finalizeSet(set) };
    }

    for (const saleDay of saleDays) {
      const month = saleDay.slice(0, 7);
      const incremental = dailyBaselineSales * factor; // assinado
      // Entradas: perfil venda→recebimento.
      for (const b of normBuckets) {
        const amount = incremental * b.weight;
        const date = addCivilDays(saleDay, b.lagDays);
        if (date > horizonEnd) {
          set.outOfHorizonInflow += amount;
          accumulate(
            scenario,
            month,
            "SCENARIO_SALES_INFLOW",
            input.receiptLagProfile.source,
            0,
            0,
            null,
            amount
          );
        } else {
          bump(set, date, "in", amount);
          accumulate(
            scenario,
            month,
            "SCENARIO_SALES_INFLOW",
            input.receiptLagProfile.source,
            0,
            amount,
            date,
            0
          );
        }
      }
      // Registra as vendas incrementais do mês uma única vez por dia de venda
      // (na linha de INFLOW, campo incrementalSalesAmount).
      accumulate(
        scenario,
        month,
        "SCENARIO_SALES_INFLOW",
        input.receiptLagProfile.source,
        incremental,
        0,
        null,
        0
      );

      // Saídas variáveis — somente categorias com fonte confiável.
      if (policy.includeVariableCosts) {
        for (const c of costs) {
          const amount = incremental * c.ratio;
          const date = addCivilDays(saleDay, Math.round(c.outflowLagDays));
          const movementType = COST_KIND_TO_MOVEMENT[c.kind];
          if (date > horizonEnd) {
            set.outOfHorizonOutflow += amount;
            accumulate(
              scenario,
              month,
              movementType,
              c.ratioSource,
              0,
              0,
              null,
              amount
            );
          } else {
            bump(set, date, "out", amount);
            accumulate(
              scenario,
              month,
              movementType,
              c.ratioSource,
              0,
              amount,
              date,
              0
            );
          }
        }
      }
    }
    return { set: finalizeSet(set) };
  }

  const opt = runScenario("OPTIMISTIC", policy.optimisticSalesVariationPct);
  const pes = runScenario("PESSIMISTIC", policy.pessimisticSalesVariationPct);

  // ── Memória final ──────────────────────────────────────────────────────
  const memory: TreasurySalesVolumeMemoryEntry[] = [];
  for (const [key, acc] of memoryAcc) {
    const [scenario, month, movementType] = key.split("|") as [
      "OPTIMISTIC" | "PESSIMISTIC",
      string,
      TreasurySalesVolumeMovementType,
    ];
    const variationPct =
      scenario === "OPTIMISTIC"
        ? policy.optimisticSalesVariationPct
        : policy.pessimisticSalesVariationPct;
    const isInflow = movementType === "SCENARIO_SALES_INFLOW";
    const inWindow = roundMoney(acc.inWindow);
    const beyond = roundMoney(acc.beyond);
    const incremental = roundMoney(acc.incrementalSales);
    memory.push({
      scenario,
      simulationType: "SALES_VOLUME_SENSITIVITY",
      movementType,
      cashDirection: isInflow ? "IN" : "OUT",
      baselinePeriod: month,
      baselineSource: input.baseline.description,
      baselineSalesAmount: roundMoney(input.baseline.monthlyAverageAmount),
      variationPct,
      incrementalSalesAmount: incremental,
      parameterSource: acc.parameterSource,
      inWindowAmount: inWindow,
      beyondHorizonAmount: beyond,
      firstMovementDate: acc.first,
      lastMovementDate: acc.last,
      isSimulated: true,
      isOfficial: false,
      explanation: isInflow
        ? `${MOVEMENT_LABEL[movementType]} de ${month}: vendas simuladas de ${moneyBr(incremental)} (${variationPct > 0 ? "+" : ""}${variationPct}% sobre a base) geram ${moneyBr(inWindow)} de recebimentos no horizonte${beyond !== 0 ? ` e ${moneyBr(beyond)} após o horizonte` : ""}, distribuídos pelo perfil real venda→recebimento (${acc.parameterSource}).`
        : `${MOVEMENT_LABEL[movementType]} de ${month}: ${moneyBr(inWindow)} no horizonte${beyond !== 0 ? ` e ${moneyBr(beyond)} após o horizonte` : ""}, proporcional às vendas simuladas (fonte: ${acc.parameterSource}). Custos fixos não são alterados.`,
    });
  }
  memory.sort(
    (a, b) =>
      a.scenario.localeCompare(b.scenario) ||
      a.baselinePeriod.localeCompare(b.baselinePeriod) ||
      a.movementType.localeCompare(b.movementType)
  );

  // ── Indicadores ────────────────────────────────────────────────────────
  function indicators(
    scenario: "OPTIMISTIC" | "PESSIMISTIC",
    set: TreasuryScenarioDeltaSet,
    variationPct: number
  ): TreasurySalesVolumeScenarioIndicators {
    const factor = variationPct / 100;
    const incrementalSalesInWindow = roundMoney(
      dailyBaselineSales * factor * saleDays.length
    );
    let inflows = 0;
    let outflows = 0;
    let cumulative = 0;
    let minCum = 0;
    let minCumDate: string | null = null;
    let maxCum = 0;
    let maxCumDate: string | null = null;
    let firstPositive: string | null = null;
    let firstNegative: string | null = null;
    for (const d of set.byDay) {
      inflows += d.inflowDelta;
      outflows += d.outflowDelta;
      cumulative = roundMoney(cumulative + d.inflowDelta - d.outflowDelta);
      if (cumulative < minCum) {
        minCum = cumulative;
        minCumDate = d.civilDate;
      }
      if (cumulative > maxCum) {
        maxCum = cumulative;
        maxCumDate = d.civilDate;
      }
      if (firstPositive == null && cumulative > 0) firstPositive = d.civilDate;
      if (firstNegative == null && cumulative < 0) firstNegative = d.civilDate;
    }
    return {
      scenario,
      variationPct,
      incrementalSalesInWindow,
      inflowsInWindow: roundMoney(inflows),
      inflowsBeyondHorizon: set.outOfHorizonInflow,
      outflowsInWindow: roundMoney(outflows),
      outflowsBeyondHorizon: set.outOfHorizonOutflow,
      netEffectInWindow: roundMoney(inflows - outflows),
      peakCashConsumed: roundMoney(Math.max(0, -minCum)),
      peakCashConsumedDate: minCum < 0 ? minCumDate : null,
      peakCashReleased: roundMoney(Math.max(0, maxCum)),
      peakCashReleasedDate: maxCum > 0 ? maxCumDate : null,
      firstNetPositiveDate: firstPositive,
      firstNetNegativeDate: firstNegative,
    };
  }

  // ── Cobertura ──────────────────────────────────────────────────────────
  const includedCostKinds = costs.map((c) => c.kind);
  const excludedCostKinds = ALL_COST_KINDS.filter(
    (k) => !includedCostKinds.includes(k)
  );
  const coverage: TreasurySalesVolumeCoverage = {
    variableCostRatioTotal: roundMoney(
      costs.reduce((s, c) => s + c.ratio, 0)
    ),
    includedCostKinds,
    excludedCostKinds,
    receiptProfileIsFallback: input.receiptLagProfile.isFallback,
    warnings: [...input.coverageWarnings],
    isPartial:
      excludedCostKinds.length > 0 ||
      input.receiptLagProfile.isFallback ||
      input.coverageWarnings.length > 0,
  };

  // ── Premissas realmente aplicadas ──────────────────────────────────────
  const assumptions: string[] = [
    `Otimista: vendas ${policy.optimisticSalesVariationPct > 0 ? "+" : ""}${policy.optimisticSalesVariationPct}% · Pessimista: vendas ${policy.pessimisticSalesVariationPct}%.`,
    `Base de vendas: ${input.baseline.description} — ${moneyBr(input.baseline.monthlyAverageAmount)}/mês (valor vendido em Pedidos emitidos, excluindo cancelados).`,
    normBuckets.length > 0
      ? `Recebimentos: ${input.receiptLagProfile.source}.`
      : "Recebimentos: sem perfil disponível — cenários não simulados.",
    policy.includeVariableCosts && costs.length > 0
      ? `Custos variáveis (${roundMoney(costs.reduce((s, c) => s + c.ratio, 0) * 100)}% do valor vendido): ${costs
          .map((c) => `${MOVEMENT_LABEL[COST_KIND_TO_MOVEMENT[c.kind]]} (${roundMoney(c.ratio * 100)}%)`)
          .join(" · ")}.`
      : "Custos variáveis: não simulados (sem fonte confiável).",
    "Custos fixos: não alterados em nenhum cenário.",
    `Período projetado: ${formatBr(addCivilDays(asOf, 1))} a ${formatBr(horizonEnd)}; passado e hoje idênticos nos três cenários.`,
  ];
  if (policy.useSeasonality) {
    assumptions.push("Sazonalidade mensal: aplicada.");
  }

  return {
    conceptVersion: "SALES_VOLUME_V1",
    asOfCivilDate: asOf,
    horizonEndCivilDate: horizonEnd,
    optimistic: opt.set,
    pessimistic: pes.set,
    optimisticIndicators: indicators(
      "OPTIMISTIC",
      opt.set,
      policy.optimisticSalesVariationPct
    ),
    pessimisticIndicators: indicators(
      "PESSIMISTIC",
      pes.set,
      policy.pessimisticSalesVariationPct
    ),
    memory,
    assumptions,
    coverage,
    baseline: input.baseline,
  };
}

// ── Resumo executivo determinístico (templates fixos — sem IA) ───────────

export function buildTreasurySalesVolumeExecutiveLines(input: {
  optimistic: TreasurySalesVolumeScenarioIndicators;
  pessimistic: TreasurySalesVolumeScenarioIndicators;
}): string[] {
  const o = input.optimistic;
  const p = input.pessimistic;
  const lines: string[] = [];

  lines.push(
    `O cenário Otimista considera vendas ${o.variationPct > 0 ? "+" : ""}${o.variationPct}%, equivalentes a ${moneyBr(o.incrementalSalesInWindow)} no período.`
  );
  if (o.peakCashConsumed > 0 && o.peakCashConsumedDate != null) {
    lines.push(
      `Para atender ao crescimento, a empresa desembolsaria até ${moneyBr(o.peakCashConsumed)} antes de receber dos clientes (pico em ${formatBr(o.peakCashConsumedDate)}).`
    );
  }
  if (o.firstNetPositiveDate != null) {
    lines.push(
      `O crescimento começa a gerar caixa líquido positivo em ${formatBr(o.firstNetPositiveDate)}.`
    );
  } else if (o.incrementalSalesInWindow > 0) {
    lines.push(
      "Dentro do horizonte exibido, o crescimento ainda não devolve caixa líquido positivo — parte dos recebimentos cai após o período."
    );
  }
  lines.push(
    `No cenário Pessimista, a redução de ${Math.abs(p.variationPct)}% representa ${moneyBr(Math.abs(p.incrementalSalesInWindow))} a menos em vendas e ${moneyBr(Math.abs(p.inflowsInWindow))} a menos em recebimentos dentro do horizonte.`
  );
  if (p.outflowsInWindow !== 0) {
    lines.push(
      `A economia estimada em custos variáveis seria de ${moneyBr(Math.abs(p.outflowsInWindow))}, mas os custos fixos permaneceriam inalterados.`
    );
  }
  if (p.firstNetNegativeDate != null) {
    lines.push(
      `A queda começa a pressionar o caixa em ${formatBr(p.firstNetNegativeDate)}.`
    );
  }
  return lines;
}
