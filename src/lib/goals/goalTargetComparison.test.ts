/**
 * Alvo por comparação com período anterior — domínio puro.
 *
 * O deslocamento de janela é onde mora o erro silencioso: um mês a mais ou a
 * menos muda o alvo da empresa inteira sem ninguém perceber. Cada caso aqui
 * é uma data que já quebrou alguma implementação ingênua.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GoalContractError,
  computeGoalTargetFromComparison,
  parseGoalKeyResultCreateInput,
  parseGoalKeyResultUpdateInput,
  resolveGoalTargetComparisonWindow,
} from "./goalContracts.js";

const OWNER = "3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("resolveGoalTargetComparisonWindow — mesmo período do ano passado", () => {
  it("desloca exatamente 12 meses mantendo dia e mês", () => {
    assert.deepEqual(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2026-07-01",
        measuredEndDate: "2026-09-30",
        mode: "SAME_PERIOD_LAST_YEAR",
      }),
      { startCivilDate: "2025-07-01", endCivilDate: "2025-09-30" }
    );
  });

  it("ano inteiro vira o ano anterior inteiro", () => {
    assert.deepEqual(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2026-01-01",
        measuredEndDate: "2026-12-31",
        mode: "SAME_PERIOD_LAST_YEAR",
      }),
      { startCivilDate: "2025-01-01", endCivilDate: "2025-12-31" }
    );
  });

  it("29/02 cai em 28/02 no ano não bissexto (não estoura para março)", () => {
    assert.deepEqual(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2028-02-01",
        measuredEndDate: "2028-02-29",
        mode: "SAME_PERIOD_LAST_YEAR",
      }),
      { startCivilDate: "2027-02-01", endCivilDate: "2027-02-28" }
    );
  });
});

describe("resolveGoalTargetComparisonWindow — período imediatamente anterior", () => {
  it("trimestre compara com o trimestre anterior, sem sobrepor um dia", () => {
    const window = resolveGoalTargetComparisonWindow({
      measuredStartDate: "2026-07-01",
      measuredEndDate: "2026-09-30",
      mode: "PREVIOUS_PERIOD",
    })!;
    assert.equal(window.endCivilDate, "2026-06-30", "termina no dia anterior ao início");
    assert.equal(window.startCivilDate, "2026-04-01");
  });

  it("mantém a MESMA duração da janela medida", () => {
    const measured = { start: "2026-03-10", end: "2026-03-19" }; // 10 dias
    const window = resolveGoalTargetComparisonWindow({
      measuredStartDate: measured.start,
      measuredEndDate: measured.end,
      mode: "PREVIOUS_PERIOD",
    })!;
    const days = (a: string, b: string) =>
      (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
    assert.equal(
      days(window.startCivilDate, window.endCivilDate),
      days(measured.start, measured.end)
    );
    assert.equal(window.endCivilDate, "2026-03-09");
  });

  it("ano inteiro compara com o ano anterior inteiro", () => {
    const window = resolveGoalTargetComparisonWindow({
      measuredStartDate: "2026-01-01",
      measuredEndDate: "2026-12-31",
      mode: "PREVIOUS_PERIOD",
    })!;
    assert.equal(window.endCivilDate, "2025-12-31");
    assert.equal(window.startCivilDate, "2025-01-01");
  });
});

describe("resolveGoalTargetComparisonWindow — personalizado", () => {
  it("devolve as datas informadas e rejeita intervalo invertido ou vazio", () => {
    assert.deepEqual(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2026-07-01",
        measuredEndDate: "2026-09-30",
        mode: "CUSTOM",
        customStartDate: "2024-01-01",
        customEndDate: "2024-06-30",
      }),
      { startCivilDate: "2024-01-01", endCivilDate: "2024-06-30" }
    );
    assert.equal(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2026-07-01",
        measuredEndDate: "2026-09-30",
        mode: "CUSTOM",
        customStartDate: "2024-06-30",
        customEndDate: "2024-01-01",
      }),
      null
    );
    assert.equal(
      resolveGoalTargetComparisonWindow({
        measuredStartDate: "2026-07-01",
        measuredEndDate: "2026-09-30",
        mode: "CUSTOM",
      }),
      null
    );
  });
});

describe("computeGoalTargetFromComparison", () => {
  it("INCREASE soma o percentual; DECREASE subtrai (sem número negativo)", () => {
    assert.equal(
      computeGoalTargetFromComparison({
        comparisonValue: "20000000",
        percent: "30",
        trackingType: "INCREASE",
      }),
      (26000000).toFixed(6)
    );
    assert.equal(
      computeGoalTargetFromComparison({
        comparisonValue: "1000",
        percent: "10",
        trackingType: "DECREASE",
      }),
      (900).toFixed(6)
    );
  });

  it("percentual zero mantém o valor do período anterior", () => {
    assert.equal(
      computeGoalTargetFromComparison({
        comparisonValue: "1234.5",
        percent: "0",
        trackingType: "INCREASE",
      }),
      (1234.5).toFixed(6)
    );
  });

  it("valor de comparação inválido é rejeitado", () => {
    assert.throws(
      () =>
        computeGoalTargetFromComparison({
          comparisonValue: "abc",
          percent: "10",
          trackingType: "INCREASE",
        }),
      GoalContractError
    );
  });
});

describe("parse — o número digitado continua sendo o padrão", () => {
  const base = {
    title: "Faturamento",
    domain: "COMERCIAL",
    trackingType: "INCREASE",
    baseline: "0",
    ownerAppUserId: OWNER,
  };

  it("sem targetBasis: MANUAL e alvo obrigatório (comportamento de sempre)", () => {
    const input = parseGoalKeyResultCreateInput({ ...base, target: "100000" });
    assert.equal(input.targetBasis, "MANUAL");
    assert.equal(input.target, "100000");
    assert.equal(input.comparison, null);
    assert.throws(() => parseGoalKeyResultCreateInput(base), GoalContractError);
  });

  it("COMPARISON dispensa o alvo digitado e exige a configuração", () => {
    const input = parseGoalKeyResultCreateInput({
      ...base,
      targetBasis: "COMPARISON",
      comparison: { mode: "SAME_PERIOD_LAST_YEAR", percent: "30" },
    });
    assert.equal(input.target, null, "o alvo é apurado no servidor");
    assert.deepEqual(input.comparison, {
      mode: "SAME_PERIOD_LAST_YEAR",
      percent: "30",
      startDate: null,
      endDate: null,
    });
    assert.throws(
      () => parseGoalKeyResultCreateInput({ ...base, targetBasis: "COMPARISON" }),
      GoalContractError
    );
  });

  it("CUSTOM sem datas é rejeitado", () => {
    assert.throws(
      () =>
        parseGoalKeyResultCreateInput({
          ...base,
          targetBasis: "COMPARISON",
          comparison: { mode: "CUSTOM", percent: "10" },
        }),
      GoalContractError
    );
  });

  it("voltar para MANUAL exige o número digitado", () => {
    assert.throws(
      () => parseGoalKeyResultUpdateInput({ targetBasis: "MANUAL" }),
      GoalContractError
    );
    const out = parseGoalKeyResultUpdateInput({
      targetBasis: "MANUAL",
      target: "500",
    });
    assert.equal(out.comparison, null);
    assert.equal(out.target, "500");
  });

  it("reenviar a comparação recalcula sem trocar de modo", () => {
    const out = parseGoalKeyResultUpdateInput({
      comparison: { mode: "PREVIOUS_PERIOD", percent: "15" },
    });
    assert.equal(out.targetBasis, "COMPARISON");
    assert.equal(out.target, null);
    assert.equal(out.comparison?.percent, "15");
  });
});
