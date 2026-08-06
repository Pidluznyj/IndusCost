/**
 * Regressão — cenários por VOLUME DE VENDAS (Otimista +20% / Pessimista −20%).
 *
 * Cobre os testes obrigatórios da spec. Percentuais de custo SIMPLIFICADOS
 * vivem SOMENTE nestas fixtures — em produção as razões vêm das fontes
 * oficiais (SalesOrder.totalCost/totalTaxes/totalFreight e
 * CommissionOrderSnapshot), carregadas pelo service.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasurySalesVolumeScenarioPolicy } from "../contracts/treasurySalesVolumeScenarioPolicy.js";
import { TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS } from "../contracts/treasurySalesVolumeScenarioPolicy.js";
import {
  applyScenarioDeltasToClosings,
  type TreasuryScenarioDeltaSet,
} from "./treasuryCaixaScenarioDeltas.js";
import {
  buildTreasurySalesVolumeExecutiveLines,
  computeTreasurySalesVolumeScenarios,
  isBusinessCivilDay,
  type TreasurySalesVolumeScenarioInput,
} from "./treasuryCaixaSalesVolumeScenarios.js";

// ── Fixtures ─────────────────────────────────────────────────────────────
// asOf sexta 31/07/2026 → agosto/2026 tem EXATAMENTE 21 dias úteis (03–31).
const ASOF = "2026-07-31";
const HORIZON_1M = "2026-08-31"; // 21 dias úteis de venda
const HORIZON_3M = "2026-10-30";

function policy(
  overrides: Partial<TreasurySalesVolumeScenarioPolicy> = {}
): TreasurySalesVolumeScenarioPolicy {
  return { ...TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS, ...overrides };
}

function baseInput(
  overrides: Partial<TreasurySalesVolumeScenarioInput> = {}
): TreasurySalesVolumeScenarioInput {
  return {
    asOfCivilDate: ASOF,
    horizonEndCivilDate: HORIZON_3M,
    policy: policy(),
    baseline: {
      source: "SALES_HISTORY",
      monthlyAverageAmount: 21000, // diário exato: R$ 1.000/dia útil
      monthsUsed: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
      measure: "SALES_ORDER_TOTAL_NET_VALUE",
      description: "média dos últimos 6 meses completos de Pedidos de Venda",
    },
    receiptLagProfile: {
      // Condição parcelada 50%/50% (28 e 56 dias após a venda) — fixture.
      buckets: [
        { lagDays: 28, weight: 0.5 },
        { lagDays: 56, weight: 0.5 },
      ],
      source: "fixture de teste (50% em 28d, 50% em 56d)",
      isFallback: false,
    },
    variableCosts: [
      {
        kind: "RAW_MATERIAL",
        ratio: 0.4,
        ratioSource: "fixture (40% MP)",
        outflowLagDays: 7, // MP paga ANTES do recebimento — capital de giro
        lagSource: "fixture",
        isFallbackLag: true,
      },
      {
        kind: "TAX",
        ratio: 0.1,
        ratioSource: "fixture (10% impostos)",
        outflowLagDays: 40,
        lagSource: "fixture",
        isFallbackLag: true,
      },
      {
        kind: "COMMISSION",
        ratio: 0.05,
        ratioSource: "fixture (5% comissão)",
        outflowLagDays: 60,
        lagSource: "fixture",
        isFallbackLag: true,
      },
      {
        kind: "FREIGHT",
        ratio: 0.02,
        ratioSource: "fixture (2% frete)",
        outflowLagDays: 30,
        lagSource: "fixture",
        isFallbackLag: true,
      },
    ],
    coverageWarnings: [],
    ...overrides,
  };
}

function sumIn(set: TreasuryScenarioDeltaSet): number {
  return set.byDay.reduce((s, d) => s + d.inflowDelta, 0);
}
function sumOut(set: TreasuryScenarioDeltaSet): number {
  return set.byDay.reduce((s, d) => s + d.outflowDelta, 0);
}
function near(actual: number, expected: number, tol = 0.05) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `esperado ~${expected}, obtido ${actual}`
  );
}

describe("zonas do tempo e Realista intocado (testes 1–4, 7, 29 da spec)", () => {
  it("todo delta é estritamente futuro — passado, hoje e saldo inicial idênticos nos 3 cenários", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    for (const set of [r.optimistic, r.pessimistic]) {
      assert.ok(set.byDay.length > 0);
      for (const d of set.byDay) {
        assert.ok(
          d.civilDate > ASOF,
          `delta em ${d.civilDate} violaria passado/hoje`
        );
      }
    }
  });

  it("série canônica: delta zero (base zerada) devolve a Linha do tempo IDÊNTICA no centavo", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        baseline: {
          source: "SALES_HISTORY",
          monthlyAverageAmount: 0,
          monthsUsed: [],
          measure: "SALES_ORDER_TOTAL_NET_VALUE",
          description: "sem histórico",
        },
      })
    );
    const canonical = new Map<string, number | null>([
      ["2026-08-19", 413612.53],
      ["2026-08-20", 213877.26],
      ["2026-08-21", 227277.92],
    ]);
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: ["2026-08-19", "2026-08-20", "2026-08-21"],
      realisticClosingByDay: canonical,
      deltas: r.optimistic,
    });
    assert.equal(out.get("2026-08-19"), 413612.53);
    assert.equal(out.get("2026-08-20"), 213877.26);
    assert.equal(out.get("2026-08-21"), 227277.92);
  });

  it("aplicar deltas NÃO muta a série Realista de entrada (venda reduzida não remove realizado)", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const canonical = new Map<string, number | null>([["2026-08-10", 1000]]);
    applyScenarioDeltasToClosings({
      orderedCivilDates: ["2026-08-10"],
      realisticClosingByDay: canonical,
      deltas: r.pessimistic,
    });
    assert.equal(canonical.get("2026-08-10"), 1000, "entrada intocada");
  });
});

describe("regra do ±20% sobre a base (testes 5 e 8–10 da spec)", () => {
  it("base de R$ 100.000/mês em janela de 21 dias úteis → Otimista +20.000 e Pessimista −20.000", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        horizonEndCivilDate: HORIZON_1M,
        baseline: {
          source: "SALES_HISTORY",
          monthlyAverageAmount: 100000,
          monthsUsed: ["2026-06"],
          measure: "SALES_ORDER_TOTAL_NET_VALUE",
          description: "fixture",
        },
      })
    );
    assert.equal(r.optimisticIndicators.incrementalSalesInWindow, 20000);
    assert.equal(r.pessimisticIndicators.incrementalSalesInWindow, -20000);
  });

  it("títulos oficiais nunca são multiplicados: TODO valor do cenário deriva da base de vendas (conservação total)", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    // Entradas: dentro + fora do horizonte = exatamente as vendas incrementais.
    const totalIn =
      sumIn(r.optimistic) + r.optimistic.outOfHorizonInflow;
    near(totalIn, r.optimisticIndicators.incrementalSalesInWindow);
    // Saídas: dentro + fora = Σ razões × vendas incrementais (0,57).
    const totalOut =
      sumOut(r.optimistic) + r.optimistic.outOfHorizonOutflow;
    near(totalOut, r.optimisticIndicators.incrementalSalesInWindow * 0.57);
    // Nada além disso existe — não há títulos, CR, CP ou saldos no input.
    for (const m of r.memory) {
      assert.equal(m.isSimulated, true);
      assert.equal(m.isOfficial, false);
    }
  });

  it("percentuais vêm da política central — 30%/−10% configurados são respeitados", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        horizonEndCivilDate: HORIZON_1M,
        policy: policy({
          optimisticSalesVariationPct: 30,
          pessimisticSalesVariationPct: -10,
        }),
      })
    );
    near(r.optimisticIndicators.incrementalSalesInWindow, 21000 * 0.3);
    near(r.pessimisticIndicators.incrementalSalesInWindow, -(21000 * 0.1));
  });
});

describe("conversão em caixa pelo ciclo real (testes 6, 24, 27 da spec)", () => {
  it("venda adicional NÃO entra no caixa no dia da venda — distribui por 28/56 dias", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const firstSaleDay = "2026-08-03"; // primeiro dia útil após asOf
    const at = (day: string) =>
      r.optimistic.byDay.find((d) => d.civilDate === day);
    assert.equal(at(firstSaleDay)?.inflowDelta ?? 0, 0, "nada no dia da venda");
    // Primeira entrada só em 03/08+28 = 31/08 (bucket de 50% → R$ 100).
    for (const d of r.optimistic.byDay) {
      if (d.inflowDelta !== 0) {
        assert.equal(d.civilDate, "2026-08-31", "primeira entrada em D+28");
        break;
      }
    }
    near(at("2026-08-31")?.inflowDelta ?? 0, 100); // 200/dia × 0,5
    // 28/09 acumula DUAS parcelas: lag 56 da venda de 03/08 (100) + lag 28
    // da venda de 31/08 (100) — colisão legítima de datas.
    near(at("2026-09-28")?.inflowDelta ?? 0, 200);
  });

  it("condição parcelada: pesos 50/50 somam 100% do valor (parcela a parcela)", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({ horizonEndCivilDate: "2026-12-31" })
    );
    const totalIn = sumIn(r.optimistic) + r.optimistic.outOfHorizonInflow;
    near(totalIn, r.optimisticIndicators.incrementalSalesInWindow);
  });

  it("timezone: venda em 31/12 com prazo de 3 dias cai em 03/01 do ano seguinte — nunca desloca de dia", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        asOfCivilDate: "2026-12-30",
        horizonEndCivilDate: "2027-01-15",
        receiptLagProfile: {
          buckets: [{ lagDays: 3, weight: 1 }],
          source: "fixture",
          isFallback: false,
        },
        variableCosts: [],
      })
    );
    const jan3 = r.optimistic.byDay.find((d) => d.civilDate === "2027-01-03");
    assert.ok(jan3 && jan3.inflowDelta > 0, "recebimento cruza o ano correto");
  });

  it("datas/prazos inválidos (NaN, negativos) são descartados — nunca viram hoje/zero/epoch (teste 28)", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        receiptLagProfile: {
          buckets: [
            { lagDays: Number.NaN, weight: 0.5 },
            { lagDays: -5, weight: 0.5 },
          ],
          source: "fixture inválida",
          isFallback: false,
        },
      })
    );
    assert.equal(r.optimistic.byDay.length, 0);
    assert.equal(r.pessimistic.byDay.length, 0);
    assert.equal(sumIn(r.optimistic), 0);
  });
});

describe("saídas variáveis e custos fixos (testes 16–22, 25 da spec)", () => {
  it("MP/impostos/comissão/frete variam proporcionalmente e nas SUAS datas", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    // Datas por categoria (livres de colisão): primeira saída de cada tipo
    // no mês 2026-08 = venda de 03/08 + prazo da categoria.
    const first = (movementType: string) =>
      r.memory.find(
        (m) =>
          m.scenario === "OPTIMISTIC" &&
          m.movementType === movementType &&
          m.baselinePeriod === "2026-08"
      )?.firstMovementDate;
    assert.equal(first("SCENARIO_RAW_MATERIAL_OUTFLOW"), "2026-08-10"); // +7
    assert.equal(first("SCENARIO_FREIGHT_OUTFLOW"), "2026-09-02"); // +30
    assert.equal(first("SCENARIO_TAX_OUTFLOW"), "2026-09-12"); // +40
    assert.equal(first("SCENARIO_COMMISSION_OUTFLOW"), "2026-10-02"); // +60

    // Proporcionalidade: primeira MP isolada (nenhuma outra categoria vence
    // antes) = 200/dia × 40% = 80. Dias posteriores somam categorias que
    // colidem na mesma data — conferidos como compostos.
    const at = (day: string) =>
      r.optimistic.byDay.find((d) => d.civilDate === day);
    near(at("2026-08-10")?.outflowDelta ?? 0, 80); // só MP (03/08)
    near(at("2026-09-02")?.outflowDelta ?? 0, 84); // MP de 26/08 + frete de 03/08
    near(at("2026-09-12")?.outflowDelta ?? 0, 24); // imposto 03/08 + frete 13/08
    near(at("2026-10-02")?.outflowDelta ?? 0, 94); // comissão 03/08 + MP 25/09 + frete 02/09
  });

  it("custos fixos NUNCA variam: sem categorias variáveis, o Pessimista só reduz entradas (economia zero)", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({ variableCosts: [] })
    );
    assert.equal(r.pessimisticIndicators.outflowsInWindow, 0);
    assert.equal(r.pessimistic.outOfHorizonOutflow, 0);
    // Depreciação/folha/aluguel/rateio não existem no motor — nada a variar.
    for (const m of r.memory) {
      assert.match(m.movementType, /^SCENARIO_(SALES_INFLOW)$/);
    }
  });

  it("sem composição de custo confiável → cobertura PARCIAL declarada, custo não inventado (teste 25)", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        variableCosts: [],
        coverageWarnings: ["Custos variáveis indisponíveis no período."],
      })
    );
    assert.equal(r.coverage.isPartial, true);
    assert.deepEqual(r.coverage.includedCostKinds, []);
    assert.equal(r.coverage.excludedCostKinds.length, 4);
    assert.equal(r.coverage.variableCostRatioTotal, 0);
  });

  it("frete só participa quando há razão proporcional oficial (razão 0 fica fora)", () => {
    const input = baseInput();
    const r = computeTreasurySalesVolumeScenarios({
      ...input,
      variableCosts: input.variableCosts.filter((c) => c.kind !== "FREIGHT"),
    });
    assert.ok(r.coverage.excludedCostKinds.includes("FREIGHT"));
    assert.ok(
      r.memory.every((m) => m.movementType !== "SCENARIO_FREIGHT_OUTFLOW")
    );
  });
});

describe("cruzamento das linhas (testes 14–15 da spec) — sem correção artificial", () => {
  it("Otimista consome caixa ANTES de receber (MP em 7d, recebimento em 28d) → capital de giro > 0", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const ind = r.optimisticIndicators;
    assert.ok(ind.peakCashConsumed > 0, "crescimento exige capital de giro");
    assert.ok(ind.peakCashConsumedDate != null);
    assert.ok(
      ind.firstNetPositiveDate != null &&
        ind.firstNetPositiveDate > ind.peakCashConsumedDate!,
      "o retorno vem DEPOIS do pico de consumo"
    );
    // Aplicado sobre uma série plana: Otimista fica ABAIXO do Realista cedo.
    const flat = new Map<string, number | null>([
      ["2026-08-10", 100000],
      [ind.firstNetPositiveDate!, 100000],
    ]);
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: r.optimistic.byDay.map((d) => d.civilDate),
      realisticClosingByDay: new Map(
        r.optimistic.byDay.map((d) => [d.civilDate, 100000])
      ),
      deltas: r.optimistic,
    });
    assert.ok(
      (out.get("2026-08-10") ?? 0)! < 100000,
      "Otimista temporariamente abaixo do Realista"
    );
    void flat;
  });

  it("Pessimista ALIVIA caixa antes (compra menos MP) e só depois pressiona", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const ind = r.pessimisticIndicators;
    assert.ok(ind.peakCashReleased > 0, "alívio temporário existe");
    assert.ok(
      ind.firstNetNegativeDate != null,
      "a queda pressiona o caixa depois"
    );
    const out = applyScenarioDeltasToClosings({
      orderedCivilDates: r.pessimistic.byDay.map((d) => d.civilDate),
      realisticClosingByDay: new Map(
        r.pessimistic.byDay.map((d) => [d.civilDate, 100000])
      ),
      deltas: r.pessimistic,
    });
    assert.ok(
      (out.get("2026-08-10") ?? 0)! > 100000,
      "Pessimista temporariamente ACIMA do Realista"
    );
  });
});

describe("fora do horizonte (teste 23 da spec)", () => {
  it("recebimentos após o horizonte NÃO caem no último dia — viram fora-do-horizonte", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        horizonEndCivilDate: "2026-08-14", // 10 dias úteis; lag mínimo 28
      })
    );
    assert.equal(sumIn(r.optimistic), 0, "nenhuma entrada dentro da janela");
    assert.ok(r.optimistic.outOfHorizonInflow > 0);
    const lastDay = r.optimistic.byDay.find(
      (d) => d.civilDate === "2026-08-14"
    );
    assert.equal(
      lastDay?.inflowDelta ?? 0,
      0,
      "último dia não recebe o valor artificialmente"
    );
    near(
      r.optimistic.outOfHorizonInflow,
      r.optimisticIndicators.incrementalSalesInWindow
    );
  });
});

describe("conservação e memória (testes 26 e §16 da spec)", () => {
  it("toda diferença de caixa é explicada pela memória (Σ memória = Σ deltas, dentro e fora)", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    for (const [set, scenario] of [
      [r.optimistic, "OPTIMISTIC"],
      [r.pessimistic, "PESSIMISTIC"],
    ] as const) {
      const memIn = r.memory
        .filter((m) => m.scenario === scenario && m.cashDirection === "IN")
        .reduce((s, m) => s + m.inWindowAmount, 0);
      const memInBeyond = r.memory
        .filter((m) => m.scenario === scenario && m.cashDirection === "IN")
        .reduce((s, m) => s + m.beyondHorizonAmount, 0);
      const memOut = r.memory
        .filter((m) => m.scenario === scenario && m.cashDirection === "OUT")
        .reduce((s, m) => s + m.inWindowAmount, 0);
      near(memIn, sumIn(set), 0.1);
      near(memInBeyond, set.outOfHorizonInflow, 0.1);
      near(memOut, sumOut(set), 0.1);
    }
  });

  it("memória carrega base, variação, fontes e explicação determinística pt-BR", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const inflow = r.memory.find(
      (m) =>
        m.scenario === "OPTIMISTIC" &&
        m.movementType === "SCENARIO_SALES_INFLOW" &&
        m.baselinePeriod === "2026-08"
    )!;
    assert.equal(inflow.variationPct, 20);
    assert.equal(inflow.baselineSalesAmount, 21000);
    assert.ok(inflow.incrementalSalesAmount > 0);
    assert.match(inflow.explanation, /vendas simuladas/i);
    assert.match(inflow.explanation, /venda→recebimento/);
    const mp = r.memory.find(
      (m) =>
        m.scenario === "PESSIMISTIC" &&
        m.movementType === "SCENARIO_RAW_MATERIAL_OUTFLOW"
    )!;
    assert.match(mp.explanation, /Custos fixos não são alterados/);
  });
});

describe("exemplo completo da spec (§20) — R$ 1.000.000/mês", () => {
  it("Otimista consome caixa no início, Pessimista alivia; efeito final depende dos prazos; nada oficial é tocado", () => {
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        baseline: {
          source: "SALES_HISTORY",
          monthlyAverageAmount: 1000000,
          monthsUsed: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
          measure: "SALES_ORDER_TOTAL_NET_VALUE",
          description: "média dos últimos 6 meses completos de Pedidos de Venda",
        },
        horizonEndCivilDate: HORIZON_1M,
      })
    );
    // Vendas adicionais ~±200.000 no mês de 21 dias úteis.
    near(r.optimisticIndicators.incrementalSalesInWindow, 200000, 1);
    near(r.pessimisticIndicators.incrementalSalesInWindow, -200000, 1);
    // Janela curta: MP sai (lag 7) antes de qualquer recebimento (lag 28+).
    assert.ok(r.optimisticIndicators.peakCashConsumed > 0);
    assert.ok(r.pessimisticIndicators.peakCashReleased > 0);
    // Nenhum movimento oficial: tudo simulado, nada persistido.
    assert.ok(r.memory.length > 0);
    assert.ok(r.memory.every((m) => m.isSimulated && !m.isOfficial));
    // Premissas declaradas para a UI.
    assert.ok(r.assumptions.some((a) => a.includes("Custos fixos")));
  });
});

describe("resumo executivo determinístico (§15)", () => {
  it("gera as frases fixas a partir dos indicadores — sem IA", () => {
    const r = computeTreasurySalesVolumeScenarios(baseInput());
    const lines = buildTreasurySalesVolumeExecutiveLines({
      optimistic: r.optimisticIndicators,
      pessimistic: r.pessimisticIndicators,
    });
    assert.ok(lines.length >= 4);
    assert.match(lines[0]!, /Otimista considera vendas \+20%/);
    assert.ok(lines.some((l) => /desembolsaria até/.test(l)));
    assert.ok(lines.some((l) => /Pessimista.*a menos em vendas/.test(l)));
    assert.ok(
      lines.some((l) => /custos fixos permaneceriam inalterados/.test(l))
    );
  });
});

describe("dias úteis (distribuição da base)", () => {
  it("vendas simuladas caem apenas em dias úteis (seg–sex)", () => {
    assert.equal(isBusinessCivilDay("2026-08-01"), false); // sábado
    assert.equal(isBusinessCivilDay("2026-08-02"), false); // domingo
    assert.equal(isBusinessCivilDay("2026-08-03"), true); // segunda
    const r = computeTreasurySalesVolumeScenarios(
      baseInput({
        receiptLagProfile: {
          buckets: [{ lagDays: 0, weight: 1 }],
          source: "fixture à vista",
          isFallback: false,
        },
        variableCosts: [],
      })
    );
    // Com recebimento à vista, os dias de entrada são os próprios dias de
    // venda — nenhum deles pode ser fim de semana.
    for (const d of r.optimistic.byDay) {
      assert.ok(
        isBusinessCivilDay(d.civilDate),
        `${d.civilDate} não é dia útil`
      );
    }
  });
});
