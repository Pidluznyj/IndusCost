/**
 * Projeção do caixa — Visão Ampliada — regressão.
 *
 * Gates da missão:
 *  1. EQUIVALÊNCIA 30/60/90: os MESMOS motores puros com janela maior
 *     produzem PREFIXO idêntico — a visão ampliada é o motor atual com
 *     horizonte maior, nunca uma segunda conta;
 *  2. horizonte prospectivo hoje → 31/12 (bissexto/bordas estáveis, datas
 *     civis por string — sem timezone);
 *  3. slicer local (presets/datas/índices) e KPIs derivados das MESMAS
 *     linhas desenhadas;
 *  4. gates estruturais: lazy, fetch só no Gerar, AbortController,
 *     endpoint canônico, mesmo componente/buildRows, card 30/60/90 intacto.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeTreasuryCaixaScenarios,
  type TreasuryScenarioComputationInput,
  type TreasuryScenarioOpenPayable,
  type TreasuryScenarioOpenReceivable,
} from "@/src/lib/treasury/domain/treasuryCaixaScenarios.js";
import { computeTreasurySalesVolumeScenarios } from "@/src/lib/treasury/domain/treasuryCaixaSalesVolumeScenarios.js";
import { TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS } from "@/src/lib/treasury/contracts/treasurySalesVolumeScenarioPolicy.js";
import { TREASURY_SCENARIO_POLICY_DEFAULTS } from "@/src/lib/treasury/contracts/treasuryScenarioPolicyContracts.js";
import type { TreasuryScenarioPolicyDto } from "@/src/lib/treasury/contracts/treasuryScenarioPolicyContracts.js";
import { buildRows } from "@/src/components/finance/treasury/TreasuryCaixaScenariosChart.tsx";
import {
  addCivilDays,
  diffCivilDays,
} from "@/src/lib/treasury/domain/treasuryCaixaScenarioDeltas.js";
import {
  civilDateToScenarioIndex,
  defaultScenarioExpandedPeriod,
  deriveScenarioExpandedKpis,
  matchScenarioExpandedPreset,
  normalizeScenarioExpandedRange,
  planScenarioExpandedPeriod,
  rangeCoveringCivilDates,
  resolveScenarioExpandedHorizon,
  resolveScenarioExpandedPresetRange,
  scenarioExpandedDraftIsStale,
  SCENARIO_EXPANDED_MAX_HORIZON_DAYS,
  TREASURY_SCENARIO_EXPANDED_PRESETS,
} from "@/src/lib/treasury/treasuryCaixaScenariosExpandedUi.js";

/* ------------------------------------------------------------------ */
/*  Horizonte prospectivo hoje → 31/12                                 */
/* ------------------------------------------------------------------ */

describe("visão ampliada — horizonte prospectivo", () => {
  it("hoje → 31/12 inclusivo (01/01 = ano inteiro; 31/12 = 1 dia)", () => {
    assert.deepEqual(resolveScenarioExpandedHorizon("2026-01-01"), {
      horizonDays: 365,
      endCivil: "2026-12-31",
    });
    assert.deepEqual(resolveScenarioExpandedHorizon("2026-12-31"), {
      horizonDays: 1,
      endCivil: "2026-12-31",
    });
    assert.deepEqual(resolveScenarioExpandedHorizon("2026-12-30"), {
      horizonDays: 2,
      endCivil: "2026-12-31",
    });
  });

  it("LEAP_YEAR: 2028 tem 366 dias a partir de 01/01 — 29/02 contado", () => {
    assert.equal(resolveScenarioExpandedHorizon("2028-01-01").horizonDays, 366);
    assert.equal(resolveScenarioExpandedHorizon("2028-03-01").horizonDays, 306);
  });

  it("entrada não-parseável cai no fallback seguro (90 dias)", () => {
    assert.equal(resolveScenarioExpandedHorizon("abc").horizonDays, 90);
  });
});

/* ------------------------------------------------------------------ */
/*  EQUIVALÊNCIA 30/60/90 — mesmos motores puros, prefixo idêntico     */
/* ------------------------------------------------------------------ */

function civilWindow(asOf: string, days: number): string[] {
  const [y, m, d] = asOf.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

const POLICY: TreasuryScenarioPolicyDto = {
  ...TREASURY_SCENARIO_POLICY_DEFAULTS,
  id: "GLOBAL",
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedByUserId: null,
} as TreasuryScenarioPolicyDto;

function receivable(externalId: number, dueDate: string, amount: number) {
  return {
    externalId,
    personName: "Cliente",
    personCnpj: null,
    dueDate,
    settlementDate: null,
    amountReceivable: amount,
    amountReceived: 0,
    balanceReceivable: amount,
    calculatedStatus: "ABERTO",
    documentNumber: null,
    expectedDate: null,
    confirmedDate: null,
    activePromiseDate: null,
    activePromiseStatus: null,
  } as unknown as TreasuryScenarioOpenReceivable;
}

function payable(externalId: number, dueDate: string, amount: number) {
  return {
    externalId,
    personName: "Fornecedor",
    personCnpj: null,
    dueDate,
    paymentDate: null,
    amountPayable: amount,
    amountPaid: 0,
    balancePayable: amount,
    calculatedStatus: "ABERTO",
    documentNumber: null,
    scheduledDate: null,
    expectedDate: null,
    confirmedDate: null,
    programmingStatus: null,
  } as unknown as TreasuryScenarioOpenPayable;
}

function scenarioInput(days: number): TreasuryScenarioComputationInput {
  const asOf = "2026-08-24";
  const due = new Map<string, { estimatedInflow: number; estimatedOutflow: number }>([
    ["2026-08-26", { estimatedInflow: 500, estimatedOutflow: 100 }],
    ["2026-09-05", { estimatedInflow: 0, estimatedOutflow: 800 }],
    ["2026-10-10", { estimatedInflow: 1200, estimatedOutflow: 0 }],
  ]);
  return {
    asOfCivilDate: asOf,
    civilDatesInWindow: civilWindow(asOf, days),
    canonicalDays: [],
    openReceivables: [
      receivable(1, "2026-08-29", 500),
      receivable(2, "2026-10-10", 1200),
    ],
    openPayables: [payable(9, "2026-09-05", 800)],
    policy: POLICY,
    openingBalanceOfFirstDay: 1000,
    dailyDueEstimatesByDate: due,
  };
}

describe("visão ampliada — EQUIVALÊNCIA 30/60/90 (motor de cenários)", () => {
  const wide = computeTreasuryCaixaScenarios(scenarioInput(365));

  for (const n of [7, 15, 30, 60, 90] as const) {
    it(`${n} dias: prefixo da janela ampliada ≡ janela de ${n} dias (deepEqual dia a dia)`, () => {
      const narrow = computeTreasuryCaixaScenarios(scenarioInput(n));
      assert.equal(narrow.days.length, n);
      assert.deepEqual(
        JSON.parse(JSON.stringify(wide.days.slice(0, n))),
        JSON.parse(JSON.stringify(narrow.days)),
        `divergência no prefixo de ${n} dias`
      );
    });
  }
});

describe("visão ampliada — EQUIVALÊNCIA (motor de sensibilidade de vendas)", () => {
  function salesInput(horizonEndCivilDate: string) {
    return {
      asOfCivilDate: "2026-08-24",
      horizonEndCivilDate,
      policy: TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS,
      baseline: {
        source: "SALES_HISTORY",
        monthlyAverageAmount: 210000,
        monthsUsed: ["2026-05", "2026-06", "2026-07"],
        measure: "SALES_ORDER_TOTAL_NET_VALUE",
        description: "fixture",
      } as never,
      receiptLagProfile: {
        buckets: [
          { lagDays: 7, weight: 0.5 },
          { lagDays: 30, weight: 0.5 },
        ],
        source: "fixture",
        isFallback: false,
      },
      variableCosts: [
        {
          kind: "RAW_MATERIAL" as const,
          ratio: 0.4,
          ratioSource: "fixture",
          outflowLagDays: 14,
          lagSource: "fixture",
          isFallbackLag: false,
        },
      ],
      coverageWarnings: [],
    };
  }

  it("deltas diários dos primeiros 30 dias são IDÊNTICOS entre horizonte 30d e 365d", () => {
    const cut = "2026-09-23"; // asOf + 30
    const short = computeTreasurySalesVolumeScenarios(salesInput(cut));
    const long = computeTreasurySalesVolumeScenarios(salesInput("2027-08-24"));
    const prefix = (byDay: readonly { civilDate: string }[]) =>
      byDay.filter((d) => d.civilDate <= cut);
    assert.ok(short.optimistic.byDay.length > 0, "fixture gera deltas");
    assert.deepEqual(
      JSON.parse(JSON.stringify(prefix(long.optimistic.byDay))),
      JSON.parse(JSON.stringify(short.optimistic.byDay)),
      "otimista divergiu no prefixo"
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(prefix(long.pessimistic.byDay))),
      JSON.parse(JSON.stringify(short.pessimistic.byDay)),
      "pessimista divergiu no prefixo"
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Slicer local — presets, datas, KPIs                                */
/* ------------------------------------------------------------------ */

describe("visão ampliada — slicer local", () => {
  const dates = civilWindow("2026-08-24", 130); // até 31/12/2026

  it("presets: full cobre tudo; 30/60/90/180 clampados à janela", () => {
    const count = dates.length;
    const byKey = Object.fromEntries(
      TREASURY_SCENARIO_EXPANDED_PRESETS.map((p) => [
        p.key,
        resolveScenarioExpandedPresetRange(count, p),
      ])
    );
    assert.deepEqual(byKey.full, { startIndex: 0, endIndex: count - 1 });
    assert.deepEqual(byKey.d30, { startIndex: 0, endIndex: 29 });
    assert.deepEqual(byKey.d90, { startIndex: 0, endIndex: 89 });
    assert.deepEqual(
      byKey.d180,
      { startIndex: 0, endIndex: count - 1 },
      "180d numa janela de 130 clampa no fim"
    );
    assert.equal(
      matchScenarioExpandedPreset(count, byKey.d60!),
      "d60",
      "highlight do preset ativo"
    );
  });

  it("datas civis → índice diário com clamp (fora da janela) e null (inválida)", () => {
    assert.equal(civilDateToScenarioIndex(dates, "2026-08-24"), 0);
    assert.equal(civilDateToScenarioIndex(dates, "2026-08-30"), 6);
    assert.equal(civilDateToScenarioIndex(dates, "2026-01-01"), 0, "clamp início");
    assert.equal(
      civilDateToScenarioIndex(dates, "2027-05-05"),
      dates.length - 1,
      "clamp fim"
    );
    assert.equal(civilDateToScenarioIndex(dates, "x"), null);
  });

  it("START>END corrigido por troca; NaN clampado — nunca estado vazio", () => {
    assert.deepEqual(
      normalizeScenarioExpandedRange(130, { startIndex: 90, endIndex: 10 }),
      { startIndex: 10, endIndex: 90 }
    );
    assert.deepEqual(
      normalizeScenarioExpandedRange(130, { startIndex: Number.NaN, endIndex: 400 }),
      { startIndex: 0, endIndex: 129 }
    );
  });

  it("KPIs derivam SÓ do recorte: menor saldo fora da janela não vaza", () => {
    const rows = dates.map((civilDate, i) => ({
      civilDate,
      real: i === 40 ? -500 : 1000 + i,
      opt: 1200 + i,
      pes: 800 + i,
      openingShown: i === 0 ? 950 : null,
    }));
    const full = deriveScenarioExpandedKpis(rows);
    assert.equal(full.initialBalance, 950);
    assert.equal(full.minRealistic, -500);
    assert.equal(full.minRealisticDate, dates[40]);
    assert.equal(full.finalRealistic, 1000 + 129);
    assert.equal(full.finalOptimistic, 1200 + 129);
    assert.equal(full.finalPessimistic, 800 + 129);

    const first30 = deriveScenarioExpandedKpis(rows.slice(0, 30));
    assert.equal(first30.minRealistic, 1000, "dia -500 (i=40) fora do recorte");
    assert.equal(first30.finalRealistic, 1000 + 29);
  });

  it("EMPTY e SINGLE POINT não explodem", () => {
    const empty = deriveScenarioExpandedKpis([]);
    assert.equal(empty.initialBalance, null);
    assert.equal(empty.minRealistic, null);
    assert.equal(empty.finalPessimistic, null);
    const single = deriveScenarioExpandedKpis([
      { civilDate: "2026-08-24", real: -10, opt: 5, pes: -20, openingShown: 0 },
    ]);
    assert.equal(single.initialBalance, 0);
    assert.equal(single.minRealistic, -10);
    assert.equal(single.finalPessimistic, -20);
  });
});

/* ------------------------------------------------------------------ */
/*  Prefixo do passado + presets da janela completa                    */
/* ------------------------------------------------------------------ */

import {
  buildScenarioPastPrefix,
  matchScenarioFullPreset,
  resolveScenarioFullPresetRange,
  TREASURY_SCENARIO_FULL_PRESETS,
} from "@/src/lib/treasury/treasuryCaixaScenariosExpandedUi.js";

describe("visão ampliada — prefixo do passado realizado", () => {
  const timelineRows = [
    { civilDate: "2026-08-20", opening: 100, closing: 150, inflows: 60, outflows: 10 },
    { civilDate: "2026-08-22", opening: 150, closing: -40, inflows: 0, outflows: 190 },
    { civilDate: "2026-08-24", opening: -40, closing: 300, inflows: 400, outflows: 60 },
    { civilDate: "2026-08-25", opening: 300, closing: 500, inflows: 200, outflows: 0 },
  ];

  it("corta estritamente < asOf; três cenários coincidem com o realizado; isPast", () => {
    const { rows, days } = buildScenarioPastPrefix({
      timelineRows,
      asOfCivilDate: "2026-08-24",
    });
    assert.deepEqual(
      rows.map((r) => r.civilDate),
      ["2026-08-20", "2026-08-22"],
      "hoje e futuro NÃO entram no prefixo"
    );
    for (const r of rows) {
      assert.equal(r.isPast, true);
      assert.equal(r.opt, r.real, "otimista = realizado no passado");
      assert.equal(r.pes, r.real, "pessimista = realizado no passado");
      assert.equal(r.bandRange, null, "sem banda no passado");
      assert.equal(r.sim, null);
    }
    assert.equal(rows[1]!.real, -40);
    assert.equal(rows[1]!.realNeg, -40, "zona vermelha no passado negativo");
    assert.equal(rows[0]!.realNeg, null);
    // Dia sintético para o tooltip carrega o realizado da timeline:
    assert.equal(days[0]!.realizedInflows, 60);
    assert.equal(days[1]!.realizedOutflows, 190);
    assert.equal(days[1]!.realistic.closingBalance, -40);
  });

  it("timeline vazia ou toda futura → prefixo vazio (não explode)", () => {
    assert.deepEqual(
      buildScenarioPastPrefix({ timelineRows: [], asOfCivilDate: "2026-08-24" })
        .rows,
      []
    );
    assert.deepEqual(
      buildScenarioPastPrefix({
        timelineRows,
        asOfCivilDate: "2026-08-19",
      }).rows,
      []
    );
  });

  it("A/B. displayClosing = canonical + running; row.closing canônico não é mutado", () => {
    const rows = [
      { civilDate: "2026-01-15", opening: 1000, closing: 1000, inflows: 0, outflows: 0 },
      { civilDate: "2026-02-05", opening: 1000, closing: 1100, inflows: 100, outflows: 0 },
      { civilDate: "2026-02-20", opening: 1100, closing: 1100, inflows: 0, outflows: 0 },
    ];
    const frozen = rows.map((r) => ({ ...r }));
    const { rows: prefixRows, days } = buildScenarioPastPrefix({
      timelineRows: rows,
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 0,
        adjustmentByCivilDate: { "2026-01-31": 100, "2026-02-05": -100 },
      },
    });
    assert.deepEqual(rows, frozen, "timeline canônica permanece intacta");
    const byDate = Object.fromEntries(prefixRows.map((r) => [r.civilDate, r]));
    assert.equal(byDate["2026-01-15"]!.real, 1000);
    assert.equal(byDate["2026-01-31"]!.real, 1100, "fechamento gerencial de janeiro");
    assert.equal(byDate["2026-02-05"]!.real, 1100);
    assert.equal(byDate["2026-02-20"]!.real, 1100);
    const jan31 = days.find((d) => d.civilDate === "2026-01-31");
    assert.equal(jan31?.realizedInflows, 0);
    assert.equal(jan31?.realizedOutflows, 0);
    assert.equal(jan31?.presentationAdjustment, 100);
    const feb5 = days.find((d) => d.civilDate === "2026-02-05");
    assert.equal(feb5?.realizedInflows, 100, "inflow factual preservado");
    assert.equal(feb5?.presentationAdjustment, -100);
  });

  it("C/D. opt/real/pes iguais no passado; sim permanece null", () => {
    const { rows: prefixRows } = buildScenarioPastPrefix({
      timelineRows,
      asOfCivilDate: "2026-08-24",
      presentationBridge: {
        openingAdjustment: 12,
        adjustmentByCivilDate: { "2026-08-20": -12 },
      },
    });
    for (const r of prefixRows) {
      assert.equal(r.opt, r.real);
      assert.equal(r.pes, r.real);
      assert.equal(r.sim, null);
    }
  });

  it("5. sem reancoragem: +amount permanece até a origem e a reversão zera o running", () => {
    const { rows: prefixRows } = buildScenarioPastPrefix({
      timelineRows: [
        { civilDate: "2026-01-10", opening: 200, closing: 200, inflows: 0, outflows: 0 },
        { civilDate: "2026-02-05", opening: 200, closing: 280, inflows: 80, outflows: 0 },
        { civilDate: "2026-03-01", opening: 280, closing: 280, inflows: 0, outflows: 0 },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 80,
        adjustmentByCivilDate: { "2026-02-05": -80 },
      },
    });
    const byDate = Object.fromEntries(prefixRows.map((r) => [r.civilDate, r]));
    assert.equal(byDate["2026-01-10"]!.real, 280);
    assert.equal(byDate["2026-02-05"]!.real, 280);
    assert.equal(byDate["2026-03-01"]!.real, 280);
  });

  it("1. closing informado é âncora absoluta — NÃO somar overlay (caso que bloqueou a feature)", () => {
    const timelineRows = [
      { civilDate: "2026-01-15", opening: 1000, closing: 1000, inflows: 0, outflows: 0 },
      {
        civilDate: "2026-02-03",
        opening: 1000,
        closing: 5000,
        inflows: 0,
        outflows: 0,
        closingInformed: 5000,
      },
      { civilDate: "2026-02-05", opening: 5000, closing: 5100, inflows: 100, outflows: 0 },
      { civilDate: "2026-02-20", opening: 5100, closing: 5100, inflows: 0, outflows: 0 },
    ];
    const frozen = timelineRows.map((r) => ({ ...r }));
    const { rows: prefixRows, days } = buildScenarioPastPrefix({
      timelineRows,
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 0,
        adjustmentByCivilDate: { "2026-01-31": 100, "2026-02-05": -100 },
      },
    });
    assert.deepEqual(timelineRows, frozen, "canonical closing da timeline não muda");
    const byDate = Object.fromEntries(prefixRows.map((r) => [r.civilDate, r]));

    assert.equal(byDate["2026-01-31"]!.real, 1100);
    assert.equal(byDate["2026-02-03"]!.real, 5000, "informed closing EXATO, não 5100");
    assert.equal(byDate["2026-02-05"]!.real, 5000, "reversão posterior continua: 5100-100");
    assert.equal(byDate["2026-02-20"]!.real, 5000);

    const feb3 = days.find((d) => d.civilDate === "2026-02-03");
    assert.equal(feb3?.presentationAdjustment, 0);
    assert.equal(feb3?.realizedInflows, 0);
    const feb5 = days.find((d) => d.civilDate === "2026-02-05");
    assert.equal(feb5?.presentationAdjustment, -100);
    assert.equal(feb5?.realizedInflows, 100, "inflow factual preservado");
    assert.equal(byDate["2026-09-01"], undefined);
  });

  it("2. segunda âncora informada zera o offset da reversão", () => {
    const { rows: prefixRows } = buildScenarioPastPrefix({
      timelineRows: [
        { civilDate: "2026-01-15", opening: 1000, closing: 1000, inflows: 0, outflows: 0 },
        {
          civilDate: "2026-02-03",
          opening: 1000,
          closing: 5000,
          inflows: 0,
          outflows: 0,
          closingInformed: 5000,
        },
        { civilDate: "2026-02-05", opening: 5000, closing: 5100, inflows: 100, outflows: 0 },
        {
          civilDate: "2026-02-07",
          opening: 5100,
          closing: 5000,
          inflows: 0,
          outflows: 0,
          closingInformed: 5000,
        },
        { civilDate: "2026-02-08", opening: 5000, closing: 5000, inflows: 0, outflows: 0 },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 0,
        adjustmentByCivilDate: { "2026-01-31": 100, "2026-02-05": -100 },
      },
    });
    const byDate = Object.fromEntries(prefixRows.map((r) => [r.civilDate, r]));
    assert.equal(byDate["2026-02-05"]!.real, 5000);
    assert.equal(byDate["2026-02-07"]!.real, 5000);
    assert.equal(byDate["2026-02-08"]!.real, 5000, "após âncora, display == canonical");
  });

  it("3. cross-year: openingAdjustment zera no primeiro informed; reversão segue; 2ª âncora reseta", () => {
    const { rows: prefixRows } = buildScenarioPastPrefix({
      timelineRows: [
        { civilDate: "2026-01-05", opening: 3900, closing: 3900, inflows: 0, outflows: 0 },
        {
          civilDate: "2026-01-10",
          opening: 3900,
          closing: 4000,
          inflows: 0,
          outflows: 0,
          closingInformed: 4000,
        },
        { civilDate: "2026-01-11", opening: 4000, closing: 4000, inflows: 0, outflows: 0 },
        { civilDate: "2026-02-05", opening: 4000, closing: 4100, inflows: 100, outflows: 0 },
        { civilDate: "2026-02-19", opening: 4100, closing: 4100, inflows: 0, outflows: 0 },
        {
          civilDate: "2026-02-20",
          opening: 4100,
          closing: 4000,
          inflows: 0,
          outflows: 0,
          closingInformed: 4000,
        },
        { civilDate: "2026-02-21", opening: 4000, closing: 4000, inflows: 0, outflows: 0 },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 100,
        adjustmentByCivilDate: { "2026-02-05": -100 },
      },
    });
    const byDate = Object.fromEntries(prefixRows.map((r) => [r.civilDate, r]));
    assert.equal(byDate["2026-01-05"]!.real, 4000, "canonical + openingAdjustment");
    assert.equal(byDate["2026-01-10"]!.real, 4000, "primeiro informed zera running");
    assert.equal(byDate["2026-01-11"]!.real, 4000);
    assert.equal(byDate["2026-02-05"]!.real, 4000, "reversão após âncora: 4100-100");
    assert.equal(byDate["2026-02-19"]!.real, 4000);
    assert.equal(byDate["2026-02-20"]!.real, 4000, "segunda âncora zera o offset");
    assert.equal(byDate["2026-02-21"]!.real, 4000);
  });

  it("4. mesmo dia: informed closing domina o adjustment da ponte", () => {
    const competenceSameDay = buildScenarioPastPrefix({
      timelineRows: [
        {
          civilDate: "2026-01-31",
          opening: 1000,
          closing: 2000,
          inflows: 0,
          outflows: 0,
          closingInformed: 2000,
        },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 0,
        adjustmentByCivilDate: { "2026-01-31": 100 },
      },
    });
    assert.equal(competenceSameDay.rows[0]!.real, 2000);
    assert.equal(competenceSameDay.days[0]!.presentationAdjustment, 100);

    const reversalSameDay = buildScenarioPastPrefix({
      timelineRows: [
        {
          civilDate: "2026-02-05",
          opening: 5000,
          closing: 5000,
          inflows: 100,
          outflows: 0,
          closingInformed: 5000,
        },
        { civilDate: "2026-02-06", opening: 5000, closing: 5000, inflows: 0, outflows: 0 },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 0,
        adjustmentByCivilDate: { "2026-02-05": -100 },
      },
    });
    assert.equal(reversalSameDay.rows[0]!.real, 5000);
    assert.equal(reversalSameDay.rows[1]!.real, 5000, "running termina o dia informado em 0");
  });

  it("H. prefixo nunca inclui asOf nem futuro — forecast permanece fora da ponte", () => {
    const { rows: prefixRows } = buildScenarioPastPrefix({
      timelineRows: [
        { civilDate: "2026-09-01", opening: 10, closing: 10, inflows: 0, outflows: 0 },
        { civilDate: "2026-09-02", opening: 10, closing: 20, inflows: 10, outflows: 0 },
      ],
      asOfCivilDate: "2026-09-01",
      presentationBridge: {
        openingAdjustment: 5,
        adjustmentByCivilDate: { "2026-09-01": -5, "2026-09-02": 99 },
      },
    });
    assert.deepEqual(prefixRows.map((r) => r.civilDate), []);
  });
});

describe("visão ampliada — presets da janela completa (passado+futuro)", () => {
  // 236 dias de passado + 130 projetados = ano civil de 2026 (366? não: 365).
  const pastCount = 235;
  const total = 365;

  function preset(key: string) {
    const p = TREASURY_SCENARIO_FULL_PRESETS.find((x) => x.key === key);
    assert.ok(p, `preset ${key} existe`);
    return p!;
  }

  it("Ano completo / Hoje→31/12 / próximos 90 e 180 dias", () => {
    assert.deepEqual(resolveScenarioFullPresetRange(total, pastCount, preset("year")), {
      startIndex: 0,
      endIndex: total - 1,
    });
    assert.deepEqual(
      resolveScenarioFullPresetRange(total, pastCount, preset("future")),
      { startIndex: pastCount, endIndex: total - 1 }
    );
    assert.deepEqual(
      resolveScenarioFullPresetRange(total, pastCount, preset("f90")),
      { startIndex: pastCount, endIndex: pastCount + 89 }
    );
    assert.deepEqual(
      resolveScenarioFullPresetRange(total, pastCount, preset("f180")),
      { startIndex: pastCount, endIndex: total - 1 },
      "180 dias futuros clampam em 31/12 quando só restam 130"
    );
    assert.equal(
      matchScenarioFullPreset(total, pastCount, {
        startIndex: pastCount,
        endIndex: pastCount + 89,
      }),
      "f90"
    );
    assert.equal(
      matchScenarioFullPreset(total, pastCount, { startIndex: 3, endIndex: 77 }),
      null,
      "recorte custom não vira preset"
    );
  });

  it("bordas: sem passado (aberto em 01/01) e janela vazia", () => {
    assert.deepEqual(resolveScenarioFullPresetRange(366, 0, preset("year")), {
      startIndex: 0,
      endIndex: 365,
    });
    assert.deepEqual(resolveScenarioFullPresetRange(366, 0, preset("future")), {
      startIndex: 0,
      endIndex: 365,
    });
    assert.deepEqual(resolveScenarioFullPresetRange(0, 0, preset("year")), {
      startIndex: 0,
      endIndex: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Período personalizado                                              */
/* ------------------------------------------------------------------ */

const TODAY = "2026-10-15";

describe("visão ampliada — período personalizado", () => {
  it("1. padrão continua 01/01 → 31/12 do ano corrente e pede o mesmo horizonte de hoje", () => {
    assert.deepEqual(defaultScenarioExpandedPeriod(TODAY), {
      startCivil: "2026-01-01",
      endCivil: "2026-12-31",
    });
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-01-01",
      endCivil: "2026-12-31",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.historyYears, [2026]);
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, false);
    assert.deepEqual(plan.estimateYears, []);
    assert.equal(
      plan.horizonDays,
      resolveScenarioExpandedHorizon(TODAY).horizonDays
    );
  });

  it("2. 01/07/2026 → 31/12/2026 recorta o passado e mantém a projeção até 31/12", () => {
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-07-01",
      endCivil: "2026-12-31",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(
      plan.horizonDays,
      resolveScenarioExpandedHorizon(TODAY).horizonDays
    );
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, false);
    const dates = ["2026-01-01", "2026-07-01", "2026-10-15", "2026-12-31"];
    assert.deepEqual(
      rangeCoveringCivilDates(dates, plan.startCivil, plan.endCivil),
      { startIndex: 1, endIndex: 3 }
    );
  });

  it("3. 01/07/2026 → 30/06/2027 cruza o ano dentro do teto e pede estimativas de 2027", () => {
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-07-01",
      endCivil: "2027-06-30",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, true);
    assert.deepEqual(plan.estimateYears, [2027]);
    assert.ok(
      plan.horizonDays != null &&
        plan.horizonDays <= SCENARIO_EXPANDED_MAX_HORIZON_DAYS
    );
    assert.equal(plan.horizonDays, 259);
  });

  it("4. 01/01/2025 → 31/12/2025 é só realizado: não pede projeção", () => {
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2025-01-01",
      endCivil: "2025-12-31",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.horizonDays, null);
    assert.deepEqual(plan.historyYears, [2025]);
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, false);
    assert.deepEqual(plan.estimateYears, []);
  });

  it("5. intervalo exclusivamente futuro não carrega passado e continua projetado", () => {
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2027-01-01",
      endCivil: "2027-03-31",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.historyYears, []);
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, true);
    assert.ok(plan.horizonDays != null && plan.horizonDays > 1);
    const dates = ["2026-10-15", "2026-12-31", "2027-01-01", "2027-03-31"];
    assert.deepEqual(
      rangeCoveringCivilDates(dates, "2027-01-01", "2027-03-31"),
      { startIndex: 2, endIndex: 3 }
    );
  });

  it("6. intervalo inválido é recusado e não produz plano de carga", () => {
    const missing = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "",
      endCivil: "2026-12-31",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "MISSING_START");

    const inverted = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-12-31",
      endCivil: "2026-01-01",
    });
    assert.equal(inverted.ok, false);
    if (!inverted.ok) {
      assert.equal(inverted.code, "END_BEFORE_START");
      assert.equal(inverted.proposal, null);
    }

    const leap = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-02-29",
      endCivil: "2026-03-01",
    });
    assert.equal(leap.ok, false);
    if (!leap.ok) assert.equal(leap.code, "INVALID_START");
  });

  it("7. virada de ano e de mês: 15/12 → 15/01 e 31/01 → 01/03", () => {
    const turn = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-12-15",
      endCivil: "2027-01-15",
    });
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.equal(turn.extendDueEstimatesBeyondAnchorYear, true);
    assert.deepEqual(turn.estimateYears, [2027]);
    assert.equal(turn.horizonDays, 93);

    const monthTurn = planScenarioExpandedPeriod({
      todayCivil: "2026-01-15",
      startCivil: "2026-01-31",
      endCivil: "2026-03-01",
    });
    assert.equal(monthTurn.ok, true);
    if (!monthTurn.ok) return;
    assert.equal(monthTurn.horizonDays, 46);

    const leapYear = planScenarioExpandedPeriod({
      todayCivil: "2028-02-29",
      startCivil: "2028-02-29",
      endCivil: "2028-03-01",
    });
    assert.equal(leapYear.ok, true);
    if (!leapYear.ok) return;
    assert.equal(leapYear.horizonDays, 2);
  });

  it("8. alterar o período depois de gerar não é o período carregado", () => {
    const loaded = { startCivil: "2026-01-01", endCivil: "2026-12-31" };
    assert.equal(
      scenarioExpandedDraftIsStale(
        { startCivil: "2026-01-01", endCivil: "2026-12-31" },
        loaded
      ),
      false
    );
    assert.equal(
      scenarioExpandedDraftIsStale(
        { startCivil: "2026-07-01", endCivil: "2026-12-31" },
        loaded
      ),
      true
    );
    const next = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-07-01",
      endCivil: "2026-12-31",
    });
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.notEqual(next.startCivil, loaded.startCivil);
  });

  it("01/07/2026 → 31/07/2027 atravessa o ano e permanece dentro do teto", () => {
    const endCivil = "2027-07-31";
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-07-01",
      endCivil,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.horizonDays, diffCivilDays(TODAY, endCivil) + 1);
    assert.ok((plan.horizonDays ?? 0) > 90);
    assert.ok((plan.horizonDays ?? 0) <= SCENARIO_EXPANDED_MAX_HORIZON_DAYS);
    assert.equal(plan.extendDueEstimatesBeyondAnchorYear, true);
    assert.deepEqual(plan.estimateYears, [2027]);
    assert.deepEqual(plan.historyYears, [2026]);
  });

  it("01/12/2026 → 28/02/2027 e o ano seguinte inteiro também são aceitos", () => {
    const turn = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2026-12-01",
      endCivil: "2027-02-28",
    });
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.equal(turn.horizonDays, diffCivilDays(TODAY, "2027-02-28") + 1);
    assert.deepEqual(turn.estimateYears, [2027]);

    const nextYear = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2027-01-01",
      endCivil: "2027-12-31",
    });
    assert.equal(nextYear.ok, true);
    if (!nextYear.ok) return;
    const horizon = nextYear.horizonDays ?? 0;
    assert.equal(horizon, diffCivilDays(TODAY, "2027-12-31") + 1);
    assert.ok(horizon > 366, "o ano seguinte inteiro passa de um ano civil a partir de outubro");
    assert.ok(horizon <= SCENARIO_EXPANDED_MAX_HORIZON_DAYS);
    assert.deepEqual(nextYear.historyYears, []);
    assert.deepEqual(nextYear.estimateYears, [2027]);
  });

  it("horizonte acima de dois anos civis é recusado com proposta, sem truncar", () => {
    const maxEnd = addCivilDays(TODAY, SCENARIO_EXPANDED_MAX_HORIZON_DAYS - 1);
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: TODAY,
      endCivil: addCivilDays(maxEnd, 1),
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.code, "HORIZON_EXCEEDED");
    assert.match(plan.message, /não foi truncada/);
    assert.match(plan.message, new RegExp(maxEnd));
    assert.ok(plan.proposal);
  });

  it("mais de 3 anos civis é recusado com proposta, sem truncar", () => {
    const plan = planScenarioExpandedPeriod({
      todayCivil: TODAY,
      startCivil: "2023-01-01",
      endCivil: "2026-12-31",
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.code, "TOO_MANY_YEARS");
    assert.match(plan.message, /não foi truncada/);
    assert.ok(plan.proposal);
  });

  it("o card não envia a extensão de estimativas além do ano da âncora", () => {
    const page = readFileSync(
      fileURLToPath(
        new URL(
          "../../components/finance/treasury/TreasuryCaixaPage.tsx",
          import.meta.url
        )
      ),
      "utf8"
    );
    assert.equal(page.includes("extendDueEstimatesBeyondAnchorYear"), false);
  });
});

/* ------------------------------------------------------------------ */
/*  Semântica de horizonDays no SERVIÇO REAL (prova executável)        */
/* ------------------------------------------------------------------ */

import {
  createTreasuryCaixaScenariosService,
  TREASURY_CAIXA_SCENARIOS_EXTENDED_MAX_HORIZON_DAYS,
  TREASURY_CAIXA_SCENARIOS_MAX_HORIZON_DAYS,
} from "@/src/lib/treasury/services/treasuryCaixaScenariosService.server.js";

function fakeBoard(year: number, asOf: string) {
  return {
    period: { year },
    dueDateFrom: `${year}-01-01`,
    dueDateTo: `${year}-12-31`,
    totals: {},
    realizedDays: [],
    overdue: null,
    receivables: [],
    payables: [],
    monthlyDueEstimates: [],
    dailyDueEstimates: [],
    canonicalDays: [],
    officialTodayBalance: {
      amount: 1000,
      source: "DAILY_CLOSING",
      civilDate: asOf,
      informedAt: null,
      accountsCovered: 1,
      accountsWithoutBalance: 0,
      sourceLabel: "fixture",
    },
  } as never;
}

/** Prisma fake: qualquer tabela responde vazio (nenhuma consulta importa aqui). */
function fakePrisma() {
  const nullBag = new Proxy({}, { get: () => null });
  const zeroBag = new Proxy({}, { get: () => 0 });
  const table = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    aggregate: async () => ({
      _sum: nullBag,
      _max: nullBag,
      _min: nullBag,
      _avg: nullBag,
      _count: zeroBag,
    }),
    groupBy: async () => [],
    count: async () => 0,
  };
  return new Proxy(
    {},
    { get: () => table }
  ) as never;
}

async function runServiceWindow(asOf: string, horizonDays: number) {
  const year = Number(asOf.slice(0, 4));
  const service = createTreasuryCaixaScenariosService({
    prisma: fakePrisma(),
    caixaService: { getBoard: async () => fakeBoard(year, asOf) } as never,
    policyService: { getForEngine: async () => POLICY } as never,
  });
  const result = await service.getBoard({
    asOfCivilDate: asOf,
    horizonDays,
    year: null,
    month: null,
    day: null,
  });
  const days = result.days;
  return {
    first: days[0]?.civilDate ?? null,
    last: days[days.length - 1]?.civilDate ?? null,
    count: days.length,
  };
}

describe("visão ampliada — horizonDays no serviço real (janela inclusiva)", () => {
  it("horizonDays é o TOTAL de pontos: 30 gera 30 pontos, asOf incluído", async () => {
    const w = await runServiceWindow("2026-08-24", 30);
    assert.equal(w.count, 30);
    assert.equal(w.first, "2026-08-24");
    assert.equal(w.last, "2026-09-22");
  });

  it("ANO NORMAL: 2026-01-01 + 365 → termina em 31/12/2026 com 365 pontos", async () => {
    const w = await runServiceWindow("2026-01-01", 365);
    assert.equal(w.first, "2026-01-01");
    assert.equal(w.last, "2026-12-31");
    assert.equal(w.count, 365);
  });

  it("BISSEXTO com 365: 2028-01-01 + 365 termina em 30/12 (por isso o teto é 366)", async () => {
    const w = await runServiceWindow("2028-01-01", 365);
    assert.equal(w.first, "2028-01-01");
    assert.equal(w.last, "2028-12-30", "365 pontos NÃO alcançam 31/12 em bissexto");
    assert.equal(w.count, 365);
  });

  it("REGRESSÃO OFF-BY-ONE: 2028-01-01 + 366 → 31/12/2028 incluído, 366 pontos", async () => {
    const w = await runServiceWindow("2028-01-01", 366);
    assert.equal(w.first, "2028-01-01");
    assert.equal(w.last, "2028-12-31");
    assert.equal(w.count, 366);
  });

  it("teto do serviço: pedido acima de 366 é clampado (nunca range ilimitado)", async () => {
    const w = await runServiceWindow("2028-01-01", 999);
    assert.equal(w.count, 366, "clamp em MAX_HORIZON_DAYS=366");
    assert.equal(w.last, "2028-12-31");
  });

  it("o teto da visão ampliada é o teto estendido do serviço; o card permanece em 366", () => {
    assert.equal(TREASURY_CAIXA_SCENARIOS_MAX_HORIZON_DAYS, 366);
    assert.equal(
      SCENARIO_EXPANDED_MAX_HORIZON_DAYS,
      TREASURY_CAIXA_SCENARIOS_EXTENDED_MAX_HORIZON_DAYS
    );
    assert.equal(TREASURY_CAIXA_SCENARIOS_EXTENDED_MAX_HORIZON_DAYS, 732);
  });

  it("a visão ampliada nunca pede acima do teto: hoje→31/12 ≤ 366 em qualquer data", () => {
    for (const today of [
      "2026-01-01",
      "2026-08-24",
      "2026-12-31",
      "2028-01-01",
      "2028-02-29",
      "2028-12-31",
    ]) {
      const h = resolveScenarioExpandedHorizon(today).horizonDays;
      assert.ok(h >= 1 && h <= 366, `${today} → ${h} fora do teto`);
    }
  });
});

describe("visão ampliada — estimativas além do ano da âncora (opt-in)", () => {
  async function runCrossing(extend: boolean) {
    const calls: number[] = [];
    const service = createTreasuryCaixaScenariosService({
      prisma: fakePrisma(),
      caixaService: {
        getBoard: async (period: { year: number }) => {
          calls.push(period.year);
          const board = fakeBoard(period.year, "2026-12-20") as {
            dailyDueEstimates: {
              civilDate: string;
              estimatedInflow: number;
              estimatedOutflow: number;
            }[];
          };
          if (period.year === 2026) {
            board.dailyDueEstimates = [
              {
                civilDate: "2026-12-20",
                estimatedInflow: 10,
                estimatedOutflow: 0,
              },
            ];
          }
          if (period.year === 2027) {
            board.dailyDueEstimates = [
              {
                civilDate: "2027-01-05",
                estimatedInflow: 250,
                estimatedOutflow: 40,
              },
            ];
          }
          return board as never;
        },
      } as never,
      policyService: { getForEngine: async () => POLICY } as never,
    });
    const result = await service.getBoard({
      asOfCivilDate: "2026-12-20",
      horizonDays: 20,
      extendDueEstimatesBeyondAnchorYear: extend,
    });
    return { result, calls };
  }

  it("sem o sinal, janeiro seguinte fica sem estimativa e o ano da âncora não lê outro board", async () => {
    const off = await runCrossing(false);
    assert.deepEqual(off.calls, [2026]);
    const january = off.result.days.find((d) => d.civilDate === "2027-01-05");
    assert.ok(january);
    assert.equal(january.realistic.receivableInflows, 0);
    assert.equal(january.realistic.payableOutflows, 0);
  });

  it("com o sinal, a estimativa de 2027 entra e os dias de 2026 permanecem iguais", async () => {
    const off = await runCrossing(false);
    const on = await runCrossing(true);
    assert.deepEqual(on.calls, [2026, 2027]);

    const before = off.result.days.filter((d) => d.civilDate <= "2026-12-31");
    const after = on.result.days.filter((d) => d.civilDate <= "2026-12-31");
    assert.deepEqual(after, before);

    const januaryOff = off.result.days.find((d) => d.civilDate === "2027-01-05");
    const januaryOn = on.result.days.find((d) => d.civilDate === "2027-01-05");
    assert.ok(januaryOff && januaryOn);
    assert.deepEqual(januaryOn.optimistic, januaryOff.optimistic);
    assert.deepEqual(januaryOn.pessimistic, januaryOff.pessimistic);
    assert.equal(januaryOn.realistic.receivableInflows, 250);
    assert.equal(januaryOn.realistic.payableOutflows, 40);
    assert.notEqual(
      januaryOn.realistic.closingBalance,
      januaryOff.realistic.closingBalance
    );
  });
});

describe("visão ampliada — intervalo contínuo entre anos", () => {
  const asOf = "2026-10-15";
  const end = "2027-07-31";
  const horizon = diffCivilDays(asOf, end) + 1;

  it("01/07/2026 → 31/07/2027 transporta o saldo e separa realizado de estimativa", () => {
    const estimates = new Map<
      string,
      { estimatedInflow: number; estimatedOutflow: number }
    >([
      ["2026-12-10", { estimatedInflow: 500, estimatedOutflow: 100 }],
      ["2027-01-05", { estimatedInflow: 2500, estimatedOutflow: 400 }],
      ["2027-07-15", { estimatedInflow: 800, estimatedOutflow: 200 }],
    ]);
    const started = performance.now();
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: asOf,
      civilDatesInWindow: civilWindow(asOf, horizon),
      canonicalDays: [],
      openReceivables: [receivable(1, "2026-12-20", 800)],
      openPayables: [payable(9, "2026-12-31", 300)],
      policy: POLICY,
      openingBalanceOfFirstDay: 10000,
      dailyDueEstimatesByDate: estimates,
    });
    const engineMs = performance.now() - started;
    console.log(
      `computeTreasuryCaixaScenarios ${horizon} dias (01/07/2026→31/07/2027): ${engineMs.toFixed(1)} ms`
    );
    assert.ok(engineMs < 1500);
    assert.equal(result.days.length, horizon);
    assert.equal(result.days.at(-1)?.civilDate, end);

    const at = (date: string) => {
      const day = result.days.find((d) => d.civilDate === date);
      assert.ok(day, date);
      return day;
    };
    const dec31 = at("2026-12-31");
    const jan1 = at("2027-01-01");
    const jan4 = at("2027-01-04");
    const jan5 = at("2027-01-05");
    const jul15 = at("2027-07-15");

    assert.equal(dec31.realistic.closingBalance, 10400);
    assert.equal(jan1.realistic.closingBalance, dec31.realistic.closingBalance);
    assert.equal(jan1.realistic.receivableInflows, 0);
    assert.equal(jan1.realistic.payableOutflows, 0);
    assert.notEqual(jan1.realistic.closingBalance, 10000);

    assert.equal(jan5.realistic.receivableInflows, 2500);
    assert.equal(jan5.realistic.payableOutflows, 400);
    assert.equal(jan5.realistic.closingBalance, 12500);
    assert.equal(jan4.realistic.closingBalance, 10400);
    assert.notEqual(jan5.optimistic.receivableInflows, 2500);
    assert.notEqual(jan5.pessimistic.payableOutflows, 400);
    assert.equal(jan5.optimistic.closingBalance, jan4.optimistic.closingBalance);
    assert.equal(jan5.pessimistic.closingBalance, jan4.pessimistic.closingBalance);

    assert.equal(jul15.realistic.receivableInflows, 800);
    assert.equal(jul15.realistic.payableOutflows, 200);
    assert.equal(jul15.realistic.closingBalance, 13100);
    assert.equal(at(end).realistic.closingBalance, 13100);

    const salesStarted = performance.now();
    const sales = computeTreasurySalesVolumeScenarios({
      asOfCivilDate: asOf,
      horizonEndCivilDate: end,
      policy: TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS,
      baseline: {
        source: "SALES_HISTORY",
        monthlyAverageAmount: 21000,
        monthsUsed: ["2026-07", "2026-08", "2026-09"],
        measure: "SALES_ORDER_TOTAL_NET_VALUE",
        description: "fixture",
      } as never,
      receiptLagProfile: {
        buckets: [{ lagDays: 5, weight: 1 }],
        source: "fixture",
        isFallback: false,
      },
      variableCosts: [
        {
          kind: "RAW_MATERIAL" as const,
          ratio: 0.4,
          ratioSource: "fixture",
          outflowLagDays: 2,
          lagSource: "fixture",
          isFallbackLag: false,
        },
      ],
      coverageWarnings: [],
    });
    const salesMs = performance.now() - salesStarted;
    console.log(
      `computeTreasurySalesVolumeScenarios até ${end}: ${salesMs.toFixed(1)} ms`
    );
    assert.ok(salesMs < 1500);

    const timeline = new Map<
      string,
      { opening: number | null; closing: number | null }
    >();
    for (const day of result.days) {
      if (day.civilDate === asOf || estimates.has(day.civilDate)) {
        timeline.set(day.civilDate, {
          opening: null,
          closing: day.realistic.closingBalance,
        });
      }
    }
    const rows = buildRows(result.days, asOf, timeline, sales);
    const row = (date: string) => {
      const found = rows.find((r) => r.civilDate === date);
      assert.ok(found, date);
      return found;
    };
    assert.equal(row(asOf).real, 10000);
    assert.equal(row("2026-12-31").real, 10400);
    assert.equal(row("2027-01-01").real, 10400);
    assert.equal(row("2027-01-05").real, 12500);
    assert.equal(row("2027-07-15").real, 13100);
    assert.equal(row(end).real, 13100);
    const before = row("2027-01-04");
    const after = row("2027-01-05");
    assert.equal((after.real ?? 0) - (before.real ?? 0), 2100);
    assert.equal(
      (after.opt ?? 0) - (before.opt ?? 0),
      2100 +
        ((after.opt ?? 0) - (after.real ?? 0)) -
        ((before.opt ?? 0) - (before.real ?? 0))
    );
    assert.equal(
      (after.pes ?? 0) - (before.pes ?? 0),
      2100 +
        ((after.pes ?? 0) - (after.real ?? 0)) -
        ((before.pes ?? 0) - (before.real ?? 0))
    );
    console.log(
      `gráfico 05/01/2027 realista ${after.real} otimista ${after.opt} pessimista ${after.pes}`
    );
  });

  it("o serviço honra o ano seguinte inteiro e recusa acima de 732 sem truncar", async () => {
    const calls: number[] = [];
    const service = createTreasuryCaixaScenariosService({
      prisma: fakePrisma(),
      caixaService: {
        getBoard: async (period: { year: number }) => {
          calls.push(period.year);
          const board = fakeBoard(period.year, asOf) as {
            dailyDueEstimates: {
              civilDate: string;
              estimatedInflow: number;
              estimatedOutflow: number;
            }[];
          };
          if (period.year === 2027) {
            board.dailyDueEstimates = [
              {
                civilDate: "2027-07-15",
                estimatedInflow: 800,
                estimatedOutflow: 200,
              },
            ];
          }
          return board as never;
        },
      } as never,
      policyService: { getForEngine: async () => POLICY } as never,
    });
    const fullNextYear = diffCivilDays(asOf, "2027-12-31") + 1;
    const started = performance.now();
    const result = await service.getBoard({
      asOfCivilDate: asOf,
      horizonDays: fullNextYear,
      extendDueEstimatesBeyondAnchorYear: true,
    });
    const serviceMs = performance.now() - started;
    console.log(
      `getBoard fake ${fullNextYear} dias até 31/12/2027: ${serviceMs.toFixed(1)} ms`
    );
    assert.ok(serviceMs < 1500);
    assert.equal(result.days.length, fullNextYear);
    assert.equal(result.days.at(-1)?.civilDate, "2027-12-31");
    assert.deepEqual(calls, [2026, 2027]);
    const dec31 = result.days.find((d) => d.civilDate === "2026-12-31");
    const jan1 = result.days.find((d) => d.civilDate === "2027-01-01");
    const jul15 = result.days.find((d) => d.civilDate === "2027-07-15");
    assert.equal(jan1?.realistic.closingBalance, dec31?.realistic.closingBalance);
    assert.equal(jul15?.realistic.receivableInflows, 800);
    assert.equal(jul15?.realistic.payableOutflows, 200);

    await assert.rejects(
      () =>
        service.getBoard({
          asOfCivilDate: asOf,
          horizonDays: TREASURY_CAIXA_SCENARIOS_EXTENDED_MAX_HORIZON_DAYS + 1,
          extendDueEstimatesBeyondAnchorYear: true,
        }),
      /não foi truncada/
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Gates estruturais                                                  */
/* ------------------------------------------------------------------ */

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("visão ampliada — gates estruturais", () => {
  const page = readSource(
    "../../components/finance/treasury/TreasuryCaixaPage.tsx"
  );
  const modal = readSource(
    "../../components/finance/treasury/TreasuryCaixaScenariosExpandedModal.tsx"
  );
  const chart = readSource(
    "../../components/finance/treasury/TreasuryCaixaScenariosChart.tsx"
  );

  it("página carrega o modal por React.lazy — sem import estático", () => {
    assert.ok(
      page.includes("TreasuryCaixaScenariosExpandedModal") &&
        /React\.lazy\(\(\)\s*=>\s*\n?\s*import\(\s*\n?\s*"@\/src\/components\/finance\/treasury\/TreasuryCaixaScenariosExpandedModal"/.test(
          page
        ),
      "modal deveria entrar via React.lazy(() => import(...))"
    );
    assert.ok(
      !/^import[^\n]*TreasuryCaixaScenariosExpandedModal[^\n]*from/m.test(page),
      "import ESTÁTICO do modal derrota o code-splitting"
    );
  });

  it("botão 'Visão ampliada' está no card da Projeção do caixa (headerAction)", () => {
    assert.ok(
      page.includes('data-testid="caixa-scenarios-expanded-open"'),
      "botão de abertura ausente"
    );
    assert.ok(chart.includes("headerAction"), "prop headerAction no chart");
  });

  it("modal: fetch mora SÓ no handler de Gerar — nunca em useEffect", () => {
    assert.ok(
      !/useEffect\([\s\S]{0,900}?fetchTreasury/.test(modal),
      "fetch em useEffect = request sem clicar em Gerar"
    );
    // Um carregamento por Gerar: cenários + board anual + agenda — todos
    // endpoints canônicos já existentes (card, página e Visão Anual).
    const calls = modal.match(/fetchTreasury\w+\(\{/g) ?? [];
    assert.equal(
      calls.length,
      3,
      `exatamente TRÊS chamadas fetch no modal (cenários+board+agenda), achou ${calls.length}`
    );
    assert.ok(
      /onClick=\{\(\)\s*=>\s*void handleGenerate\(\)\}/.test(modal),
      "o fetch é disparado pelo clique em Gerar projeção"
    );
    assert.ok(!modal.includes('"/api/'), "nenhum endpoint novo hardcoded");
  });

  it("passado realizado: prefixo vem da composição canônica — motor de cenários intacto", () => {
    assert.ok(
      modal.includes("buildTreasuryCaixaAnnualSeries") &&
        modal.includes("buildScenarioPastPrefix"),
      "o passado deve vir da timeline anual canônica, não de conta própria"
    );
    assert.ok(
      chart.includes("prefix?:"),
      "prefix deve ser OPCIONAL no chart — card atual não passa a prop"
    );
    assert.ok(
      modal.includes("presentationBridge: slice.presentationBridge"),
      "a visão ampliada aplica a ponte só no prefixo histórico"
    );
    assert.ok(
      modal.includes("caixa-scenarios-expanded-historical-note"),
      "indicação discreta do ajuste histórico no modal"
    );
    assert.equal(
      page.includes("historicalArGraphPresentationBridge"),
      false,
      "o card pequeno / tabela da página não consomem a ponte do gráfico"
    );
  });

  it("E/F/G. ponte exclusiva do gráfico: tabela diária, mensal e fluxo não consomem", () => {
    const timeline = readSource("./domain/treasuryCaixaRules.ts");
    const annual = readSource("./treasuryCaixaAnnualViewUi.ts");
    const timelineUi = readSource(
      "../../components/finance/treasury/TreasuryCaixaTimeline.tsx"
    );
    const pageSrc = readSource(
      "../../components/finance/treasury/TreasuryCaixaPage.tsx"
    );
    const cashFlow = readSource("../financeCashFlowExecutiveSummary.ts");
    assert.ok(
      timeline.includes("historicalArMonthlyInflowDeltaByMonth"),
      "overlay mensal permanece no read model mensal"
    );
    assert.equal(annual.includes("historicalArGraphPresentationBridge"), false);
    assert.equal(timelineUi.includes("historicalArGraphPresentationBridge"), false);
    assert.equal(pageSrc.includes("historicalArGraphPresentationBridge"), false);
    assert.equal(cashFlow.includes("historicalArGraphPresentationBridge"), false);
    assert.equal(
      modal.includes("historicalArMonthlyInflowDeltaByMonth"),
      false,
      "o gráfico não pode somar o overlay mensal por cima da ponte"
    );
  });

  it("I. officialTodayBalance e forecast opening não são reescritos pelo prefixo", () => {
    const prefixSrc = readSource("./treasuryCaixaScenariosExpandedUi.ts");
    const fnStart = prefixSrc.indexOf("export function buildScenarioPastPrefix");
    const fnEnd = prefixSrc.indexOf("export type TreasuryScenarioFullPreset");
    const fn = prefixSrc.slice(fnStart, fnEnd);
    assert.equal(fn.includes("officialTodayBalance"), false);
    assert.equal(fn.includes("computeTreasuryCaixaScenarios"), false);
    assert.ok(fn.includes("displayClosing"));
    assert.ok(fn.includes("closingInformed"), "reancoragem usa closingInformed explícito");
    assert.equal(fn.includes("divergence"), false, "não inferir âncora por divergência");
  });

  it("slicer não dispara fetch: interações apenas recortam índices", () => {
    assert.ok(
      !/setRange[\s\S]{0,200}?fetchTreasury/.test(modal) &&
        !/onChange[^\n]*fetchTreasury/.test(modal),
      "interação do slicer não pode disparar fetch"
    );
  });

  it("corrida: AbortController + sequência presentes", () => {
    assert.ok(modal.includes("AbortController"));
    assert.ok(modal.includes("seqRef"));
  });

  it("mesmo gráfico e mesmos números: componente + buildRows compartilhados", () => {
    assert.ok(
      modal.includes("TreasuryCaixaScenariosChart"),
      "o modal deve renderizar o MESMO componente do card"
    );
    assert.ok(
      modal.includes("buildRows(") ,
      "KPIs derivam do MESMO buildRows que desenha as linhas"
    );
    assert.ok(
      chart.includes("export function buildRows"),
      "buildRows exportado do componente canônico"
    );
  });

  it("data inicial e data final não disparam Gerar projeção", () => {
    assert.match(
      modal,
      /setStartCivil\(e\.target\.value\)[\s\S]{0,160}caixa-scenarios-expanded-period-start/
    );
    assert.match(
      modal,
      /setEndCivil\(e\.target\.value\)[\s\S]{0,160}caixa-scenarios-expanded-period-end/
    );
    assert.equal(
      /setStartCivil\([^)]*handleGenerate/.test(modal),
      false
    );
    assert.ok(
      modal.includes("plan.horizonDays != null"),
      "período só no passado não chama o motor de cenários"
    );
  });

  it("card 30/60/90 intacto: HORIZON_OPTIONS e default preservados", () => {
    for (const v of [7, 15, 30, 60, 90]) {
      assert.ok(
        chart.includes(`{ value: ${v}, label: "${v} dias" }`),
        `opção de ${v} dias sumiu do card`
      );
    }
    assert.ok(
      page.includes("useState<number>(30)"),
      "default de 30 dias do card mudou"
    );
    assert.ok(
      chart.includes("brush?:"),
      "brush deve ser OPCIONAL — card atual não passa a prop"
    );
  });
});
