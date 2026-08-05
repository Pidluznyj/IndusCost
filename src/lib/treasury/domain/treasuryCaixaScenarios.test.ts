/**
 * Regressão — motor puro dos três cenários da Caixa.
 * Cobre invariantes centrais: passado idêntico, saldo encadeado, política
 * pessimista aplicada, otimista/pessimista não inventam data, cenários
 * fecham dia a dia.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryCaixaCanonicalDay } from "./treasuryCaixaCanonicalDay.js";
import type { TreasuryScenarioPolicyDto } from "../contracts/treasuryScenarioPolicyContracts.js";
import {
  computeTreasuryCaixaScenarios,
  type TreasuryScenarioOpenPayable,
  type TreasuryScenarioOpenReceivable,
} from "./treasuryCaixaScenarios.js";

function policy(
  overrides: Partial<TreasuryScenarioPolicyDto> = {}
): TreasuryScenarioPolicyDto {
  return {
    id: "GLOBAL",
    pessimisticEnabled: true,
    optimisticReceivableAdvanceLimitDays: 0,
    optimisticPayableDelayLimitDays: 0,
    pessimisticReceivableDelayDays: 15,
    pessimisticOverdueReceivableDelayDays: null,
    pessimisticTreatBrokenPromiseAsDelayed: true,
    useCustomerBehaviorHistory: false,
    useSupplierBehaviorHistory: false,
    settlementReconciliationEnabled: true,
    settlementReconciliationToleranceDays: 3,
    version: 1,
    updatedAt: "2026-08-04T00:00:00.000-03:00",
    createdAt: "2026-08-04T00:00:00.000-03:00",
    updatedByUserId: null,
    ...overrides,
  };
}

function canonicalDay(
  civilDate: string,
  patch: Partial<TreasuryCaixaCanonicalDay> = {}
): TreasuryCaixaCanonicalDay {
  return {
    civilDate,
    receivableDue: 0,
    receivableDueTitles: [],
    receivableReceived: 0,
    receivableReceivedTitles: [],
    payableDue: 0,
    payableDueTitles: [],
    payablePaid: 0,
    payablePaidTitles: [],
    otherInflows: 0,
    otherOutflows: 0,
    otherMovements: [],
    realizedInflows: 0,
    realizedOutflows: 0,
    projectedInflows: 0,
    projectedOutflows: 0,
    openingBalance: null,
    closingRealizedBalance: null,
    closingProjectedBalance: null,
    warnings: [],
    ...patch,
  };
}

function ar(
  overrides: Partial<TreasuryScenarioOpenReceivable> = {}
): TreasuryScenarioOpenReceivable {
  return {
    externalId: 1,
    personName: "Cliente",
    personCnpj: null,
    dueDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    calculatedStatus: "open",
    documentNumber: null,
    ...overrides,
  };
}

function ap(
  overrides: Partial<TreasuryScenarioOpenPayable> = {}
): TreasuryScenarioOpenPayable {
  return {
    externalId: 1,
    personName: "Fornecedor",
    personCnpj: null,
    dueDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    calculatedStatus: "open",
    documentNumber: null,
    ...overrides,
  };
}

describe("computeTreasuryCaixaScenarios — invariantes centrais", () => {
  it("passado (dia < asOf) é IGUAL nos três cenários; futuro pode divergir", () => {
    // asOf = 05, janela 04..06. Dia 04 é passado com AR baixado.
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-05",
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06"],
      canonicalDays: [
        canonicalDay("2026-08-04", {
          receivableReceived: 500,
          realizedInflows: 500,
        }),
        canonicalDay("2026-08-05"),
        canonicalDay("2026-08-06"),
      ],
      openReceivables: [
        // futuro: vencendo 06 sem evidência (só dueDate)
        ar({ externalId: 10, dueDate: "2026-08-06", balanceReceivable: 200 }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 1000,
    });
    const d04 = result.days[0]!;
    // No passado, os três cenários mostram o mesmo realized e nenhum projetado.
    assert.equal(d04.optimistic.receivableInflows, 0);
    assert.equal(d04.realistic.receivableInflows, 0);
    assert.equal(d04.pessimistic.receivableInflows, 0);
    assert.equal(d04.realizedInflows, 500);
    // Fechamento comum: 1000 + 500 = 1500.
    assert.equal(d04.optimistic.closingBalance, 1500);
    assert.equal(d04.realistic.closingBalance, 1500);
    assert.equal(d04.pessimistic.closingBalance, 1500);
    // O futuro divergiu (o AR de 200 sem evidência cai no delay pessimista):
    const d06 = result.days[2]!;
    // Realista/Otimista: usam dueDate (06). Pessimista: dueDate + 15 (21) — sai fora da janela.
    assert.ok(d06.realistic.receivableInflows > 0);
    assert.ok(d06.optimistic.receivableInflows > 0);
    assert.equal(d06.pessimistic.receivableInflows, 0);
  });

  it("todos os cenários partem do MESMO saldo inicial", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04"],
      canonicalDays: [canonicalDay("2026-08-04")],
      openReceivables: [],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 250,
    });
    const d = result.days[0]!;
    assert.equal(d.openingBalance, 250);
    assert.equal(d.optimistic.closingBalance, 250);
    assert.equal(d.realistic.closingBalance, 250);
    assert.equal(d.pessimistic.closingBalance, 250);
  });

  it("Realista (AR) = PROBABLE: promessa ativa → expected → dueDate não vencido", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      canonicalDays: [
        canonicalDay("2026-08-04"),
        canonicalDay("2026-08-05"),
        canonicalDay("2026-08-06"),
        canonicalDay("2026-08-07"),
      ],
      openReceivables: [
        // promessa 06, expected 05, due 07 → realista escolhe promessa (06)
        ar({
          externalId: 1,
          dueDate: "2026-08-07",
          expectedDate: "2026-08-05",
          activePromiseDate: "2026-08-06",
          activePromiseStatus: "ACTIVE",
          balanceReceivable: 900,
        }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const receivedByDay = new Map(
      result.days.map((d) => [d.civilDate, d.realistic.receivableInflows])
    );
    assert.equal(receivedByDay.get("2026-08-06"), 900);
    assert.equal(receivedByDay.get("2026-08-05"), 0);
    assert.equal(receivedByDay.get("2026-08-07"), 0);
  });

  it("Otimista (AR) escolhe a data FAVORÁVEL MAIS CEDO entre as evidências", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      canonicalDays: [
        canonicalDay("2026-08-04"),
        canonicalDay("2026-08-05"),
        canonicalDay("2026-08-06"),
        canonicalDay("2026-08-07"),
      ],
      openReceivables: [
        // Otimista: menor entre promessa (06), expected (05), due (07) → 05
        ar({
          externalId: 1,
          dueDate: "2026-08-07",
          expectedDate: "2026-08-05",
          activePromiseDate: "2026-08-06",
          activePromiseStatus: "ACTIVE",
          balanceReceivable: 900,
        }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.optimistic.receivableInflows])
    );
    assert.equal(byDay.get("2026-08-05"), 900);
  });

  it("Otimista NÃO antecipa sem evidência — usa dueDate quando só ele existe", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-05")],
      openReceivables: [
        ar({ externalId: 1, dueDate: "2026-08-05", balanceReceivable: 400 }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.optimistic.receivableInflows])
    );
    assert.equal(byDay.get("2026-08-04"), 0, "não antecipa para hoje");
    assert.equal(byDay.get("2026-08-05"), 400);
  });

  it("Pessimista (AR) sem evidência aplica atraso da política (15 dias)", () => {
    // Due 04 (hoje), sem promessa/expected → pessimista projeta 04+15 = 19
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: [
        "2026-08-04",
        "2026-08-19",
      ],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-19")],
      openReceivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 700 }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.pessimistic.receivableInflows])
    );
    assert.equal(byDay.get("2026-08-04"), 0);
    assert.equal(byDay.get("2026-08-19"), 700);
  });

  it("Pessimista respeita promessa ativa FIRME (não aplica delay)", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-10"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-10")],
      openReceivables: [
        ar({
          externalId: 1,
          dueDate: "2026-08-04",
          activePromiseDate: "2026-08-10",
          activePromiseStatus: "ACTIVE",
          balanceReceivable: 700,
        }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.pessimistic.receivableInflows])
    );
    assert.equal(byDay.get("2026-08-10"), 700);
    assert.equal(byDay.get("2026-08-04"), 0);
  });

  it("Pessimista com política desligada = CONTRATUAL (usa dueDate rígido)", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-19"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-19")],
      openReceivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 700 }),
      ],
      openPayables: [],
      policy: policy({ pessimisticEnabled: false }),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.pessimistic.receivableInflows])
    );
    // dueDate = hoje. Contratual + clamp para hoje = 04.
    assert.equal(byDay.get("2026-08-04"), 700);
  });

  it("Nenhum cenário projeta em data PASSADA (clamp para asOf)", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-05")],
      openReceivables: [
        // expected em 01/08 (passado) — otimista deveria escolher 01 mas
        // o clamp deve subir para asOf (04).
        ar({
          externalId: 1,
          dueDate: "2026-08-05",
          expectedDate: "2026-08-01",
          balanceReceivable: 300,
        }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    const byDay = new Map(
      result.days.map((d) => [d.civilDate, d.optimistic.receivableInflows])
    );
    assert.equal(byDay.get("2026-08-04"), 300, "clampou para hoje");
    assert.equal(byDay.get("2026-08-05"), 0);
  });

  it("saldo encadeia por cenário — closing(N-1) = opening(N) via facts", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06"],
      canonicalDays: [
        canonicalDay("2026-08-04"),
        canonicalDay("2026-08-05"),
        canonicalDay("2026-08-06"),
      ],
      openReceivables: [
        ar({ externalId: 1, dueDate: "2026-08-04", balanceReceivable: 100 }),
        ar({ externalId: 2, dueDate: "2026-08-05", balanceReceivable: 50 }),
      ],
      openPayables: [
        ap({ externalId: 3, dueDate: "2026-08-06", balancePayable: 200 }),
      ],
      policy: policy(),
      openingBalanceOfFirstDay: 1000,
    });
    // Realista: 04 → 1000+100=1100; 05 → 1100+50=1150; 06 → 1150-200=950
    const closes = result.days.map((d) => d.realistic.closingBalance);
    assert.deepEqual(closes, [1100, 1150, 950]);
  });

  it("summary: minBalance, firstNegativeDate, maxCashNeed corretos", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05", "2026-08-06"],
      canonicalDays: [
        canonicalDay("2026-08-04"),
        canonicalDay("2026-08-05"),
        canonicalDay("2026-08-06"),
      ],
      openReceivables: [],
      openPayables: [
        ap({ externalId: 1, dueDate: "2026-08-05", balancePayable: 700 }),
      ],
      policy: policy(),
      openingBalanceOfFirstDay: 500,
    });
    const s = result.summaries.realistic;
    assert.equal(s.minBalance, -200, "500 − 700 = −200 no dia 05");
    assert.equal(s.minBalanceDate, "2026-08-05");
    assert.equal(s.firstNegativeDate, "2026-08-05");
    assert.equal(s.negativeDaysCount, 2, "05 e 06 continuam negativos");
    assert.equal(s.maxCashNeed, 200);
  });

  it("título sem saldo (baixado) NÃO entra em nenhum cenário", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-05")],
      openReceivables: [
        ar({
          externalId: 1,
          dueDate: "2026-08-05",
          balanceReceivable: 0,
          amountReceivable: 1000,
          amountReceived: 1000,
        }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    for (const d of result.days) {
      assert.equal(d.optimistic.receivableInflows, 0);
      assert.equal(d.realistic.receivableInflows, 0);
      assert.equal(d.pessimistic.receivableInflows, 0);
    }
  });

  it("saldo inicial null → warning e closingBalance null nos três cenários", () => {
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04"],
      canonicalDays: [canonicalDay("2026-08-04", { realizedInflows: 100 })],
      openReceivables: [],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: null,
    });
    const d = result.days[0]!;
    assert.equal(d.openingBalance, null);
    assert.equal(d.optimistic.closingBalance, null);
    assert.equal(d.realistic.closingBalance, null);
    assert.equal(d.pessimistic.closingBalance, null);
    assert.equal(result.confidence, "LOW");
    assert.ok(d.warnings.some((w) => /Saldo inicial/i.test(w)));
  });

  it("com dailyDueEstimatesByDate presente, Realista bate no CENTAVO com a base da Linha do tempo (fecha o critério #3 da spec)", () => {
    // Simula a base "Linha do tempo — por mês": 20/08 tem uma saída grande
    // (352k) e um recebimento pequeno (151k). Isso é fato do dailyEstimates
    // canônico. O motor NÃO deve recomputar via título — deve usar direto.
    const timelineBase = new Map<
      string,
      { estimatedInflow: number; estimatedOutflow: number }
    >([
      ["2026-08-19", { estimatedInflow: 4973.76, estimatedOutflow: 27436.74 }],
      ["2026-08-20", { estimatedInflow: 151415.9, estimatedOutflow: 351151.17 }],
      ["2026-08-21", { estimatedInflow: 29018.54, estimatedOutflow: 15617.88 }],
    ]);
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-05",
      civilDatesInWindow: ["2026-08-19", "2026-08-20", "2026-08-21"],
      canonicalDays: [
        canonicalDay("2026-08-19"),
        canonicalDay("2026-08-20"),
        canonicalDay("2026-08-21"),
      ],
      // Motor puro receberia títulos, mas AGORA o Realista IGNORA e usa a base.
      openReceivables: [
        ar({ externalId: 999, dueDate: "2026-08-20", balanceReceivable: 99999 }),
      ],
      openPayables: [
        ap({ externalId: 888, dueDate: "2026-08-20", balancePayable: 888888 }),
      ],
      policy: policy(),
      openingBalanceOfFirstDay: 436075.51,
      dailyDueEstimatesByDate: timelineBase,
    });
    // Realista usa a BASE (não os títulos ar/ap acima):
    const real19 = result.days.find((d) => d.civilDate === "2026-08-19")!;
    const real20 = result.days.find((d) => d.civilDate === "2026-08-20")!;
    const real21 = result.days.find((d) => d.civilDate === "2026-08-21")!;
    assert.equal(real19.realistic.receivableInflows, 4973.76);
    assert.equal(real19.realistic.payableOutflows, 27436.74);
    assert.equal(real20.realistic.receivableInflows, 151415.9);
    assert.equal(real20.realistic.payableOutflows, 351151.17);
    assert.equal(real21.realistic.receivableInflows, 29018.54);
    assert.equal(real21.realistic.payableOutflows, 15617.88);
    // Cadeia do Realista:
    // 19: 436075.51 + 4973.76 − 27436.74 = 413612.53
    // 20: 413612.53 + 151415.90 − 351151.17 = 213877.26
    // 21: 213877.26 + 29018.54 − 15617.88 = 227277.92
    assert.equal(real19.realistic.closingBalance, 413612.53);
    assert.equal(real20.realistic.closingBalance, 213877.26);
    assert.equal(real21.realistic.closingBalance, 227277.92);
  });

  it("sem dailyDueEstimatesByDate, Realista mantém comportamento legado (projeta por título)", () => {
    // Retrocompatibilidade — não passa base, motor continua projetando com PROBABLE.
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-04",
      civilDatesInWindow: ["2026-08-04", "2026-08-05"],
      canonicalDays: [canonicalDay("2026-08-04"), canonicalDay("2026-08-05")],
      openReceivables: [
        ar({ externalId: 1, dueDate: "2026-08-05", balanceReceivable: 100 }),
      ],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
    });
    // Sem base, projeção por título PROBABLE (dueDate = 05/08 futuro).
    const d05 = result.days.find((d) => d.civilDate === "2026-08-05")!;
    assert.equal(d05.realistic.receivableInflows, 100);
  });

  it("REGRESSÃO — dia futuro NÃO soma realizado + estimativa (dupla-contagem)", () => {
    // Bug real: título com settlementDate anômalo no futuro (dado do Nomus)
    // fazia o Realista somar DUAS VEZES o mesmo dinheiro no mesmo dia —
    // uma vez como "realizado" (canon.realizedInflows) e outra como "em
    // aberto" (timelineBase.estimatedInflow). A Linha do tempo mensal
    // (`appendTreasuryCaixaDailyDueEstimates`) NUNCA soma as duas coisas no
    // mesmo dia futuro — só usa a estimativa. O Realista tem que fazer o
    // mesmo, senão diverge da Linha do tempo por acumulação (o que o
    // usuário reportou: saldo inicial do dia 20/08 batendo R$ 128k a menos
    // no gráfico do que na Linha do tempo).
    const timelineBase = new Map([
      ["2026-08-10", { estimatedInflow: 5000, estimatedOutflow: 0 }],
    ]);
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-05",
      civilDatesInWindow: ["2026-08-05", "2026-08-10"],
      canonicalDays: [
        canonicalDay("2026-08-05"),
        // Anomalia: settlementDate no futuro fez o motor único-de-dia
        // registrar realizedInflows > 0 num dia estritamente futuro.
        canonicalDay("2026-08-10", { realizedInflows: 30000 }),
      ],
      openReceivables: [],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 100000,
      dailyDueEstimatesByDate: timelineBase,
    });
    const d10 = result.days.find((d) => d.civilDate === "2026-08-10")!;
    // DEVE usar só a estimativa (5000), NUNCA 5000 + 30000.
    assert.equal(d10.realistic.receivableInflows, 5000);
    assert.equal(d10.realistic.closingBalance, 105000, "100000 + 5000, não 135000");
  });

  it("dia HOJE (civilDate === asOf) usa só o realizado, NÃO soma dailyDueEstimates em cima", () => {
    // "Hoje" é fato (kind TODAY = realizado), não projeção. "A receber hoje"
    // (em aberto) é dimensão SEPARADA de "Recebido hoje" (baixado) — aqui
    // só o baixado deve entrar na cadeia de saldo do Realista.
    const timelineBase = new Map([
      ["2026-08-05", { estimatedInflow: 11030.66, estimatedOutflow: 55138.7 }],
    ]);
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-05",
      civilDatesInWindow: ["2026-08-05"],
      canonicalDays: [
        canonicalDay("2026-08-05", {
          realizedInflows: 487.5, // "Recebido hoje" (baixado)
          realizedOutflows: 0, // "Pago hoje" (baixado)
        }),
      ],
      openReceivables: [],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 4007850.08,
      dailyDueEstimatesByDate: timelineBase,
    });
    const today = result.days[0]!;
    // Só o realizado (487.50) — NÃO soma os 11.030,66 em aberto.
    assert.equal(today.realistic.receivableInflows, 0);
    assert.equal(today.realistic.payableOutflows, 0);
    assert.equal(today.realistic.closingBalance, 4008337.58, "4007850.08 + 487.50");
  });

  it("Σ dos dias futuros do Realista == Σ dailyDueEstimates do período (fecha com a Linha do tempo)", () => {
    const timelineBase = new Map([
      ["2026-08-06", { estimatedInflow: 1000, estimatedOutflow: 2000 }],
      ["2026-08-07", { estimatedInflow: 3000, estimatedOutflow: 500 }],
      ["2026-08-08", { estimatedInflow: 0, estimatedOutflow: 1500 }],
    ]);
    const result = computeTreasuryCaixaScenarios({
      asOfCivilDate: "2026-08-05",
      civilDatesInWindow: ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"],
      canonicalDays: [
        canonicalDay("2026-08-05"),
        // Anomalias de realizado em dias futuros — não podem contaminar.
        canonicalDay("2026-08-06", { realizedInflows: 999999 }),
        canonicalDay("2026-08-07", { realizedOutflows: 999999 }),
        canonicalDay("2026-08-08"),
      ],
      openReceivables: [],
      openPayables: [],
      policy: policy(),
      openingBalanceOfFirstDay: 0,
      dailyDueEstimatesByDate: timelineBase,
    });
    const finalBalance = result.summaries.realistic.finalBalance;
    // Σ inflow − Σ outflow = (1000+3000+0) − (2000+500+1500) = 4000 − 4000 = 0
    assert.equal(finalBalance, 0);
  });
});
