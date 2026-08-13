import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GoalContractError,
  parseGoalAchievedValueInput,
  parseGoalCreateInput,
  parseGoalKeyResultCreateInput,
  parseGoalKeyResultUpdateInput,
  parseGoalUpdateInput,
  resolveGoalMeasurementWindow,
} from "./goalContracts.js";

const OWNER = "3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("parseGoalCreateInput", () => {
  it("payload válido normaliza título e aplica DRAFT default", () => {
    const input = parseGoalCreateInput({
      title: "  Crescer receita 2026  ",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      ownerAppUserId: OWNER,
    });
    assert.equal(input.title, "Crescer receita 2026");
    assert.equal(input.status, "DRAFT");
    assert.equal(input.description, null);
  });

  it("data fim antes do início é rejeitada", () => {
    assert.throws(
      () =>
        parseGoalCreateInput({
          title: "X",
          startDate: "2026-06-01",
          endDate: "2026-01-01",
          ownerAppUserId: OWNER,
        }),
      (e: unknown) => e instanceof GoalContractError && e.field === "endDate"
    );
  });

  it("objetivo não pode nascer arquivado; owner precisa ser uuid", () => {
    assert.throws(() =>
      parseGoalCreateInput({
        title: "X",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        status: "ARCHIVED",
        ownerAppUserId: OWNER,
      })
    );
    assert.throws(() =>
      parseGoalCreateInput({
        title: "X",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        ownerAppUserId: "nao-e-uuid",
      })
    );
  });
});

describe("parseGoalKeyResultCreateInput", () => {
  const base = {
    title: "Faturamento",
    domain: "COMERCIAL",
    trackingType: "INCREASE",
    baseline: "0",
    target: "100000",
    ownerAppUserId: OWNER,
  };

  it("payload válido: peso default 1, vírgula decimal aceita", () => {
    const input = parseGoalKeyResultCreateInput({ ...base, target: "100000,50" });
    assert.equal(input.weight, "1");
    assert.equal(input.target, "100000.50");
  });

  it("alvo igual à linha de base é meta sem intervalo — rejeitada", () => {
    assert.throws(
      () => parseGoalKeyResultCreateInput({ ...base, baseline: "100", target: "100" }),
      (e: unknown) => e instanceof GoalContractError && e.field === "target"
    );
  });

  it("peso zero ou negativo é rejeitado", () => {
    assert.throws(() => parseGoalKeyResultCreateInput({ ...base, weight: "0" }));
    assert.throws(() => parseGoalKeyResultCreateInput({ ...base, weight: "-1" }));
  });

  it("domínio e direção só aceitam o vocabulário fechado", () => {
    assert.throws(() => parseGoalKeyResultCreateInput({ ...base, domain: "MARKETING" }));
    assert.throws(() =>
      parseGoalKeyResultCreateInput({ ...base, trackingType: "SIDEWAYS" })
    );
  });

  it("rule ausente vira null (indicador manual); rule presente é repassada", () => {
    assert.equal(parseGoalKeyResultCreateInput(base).rule, null);
    const rule = { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] };
    assert.deepEqual(parseGoalKeyResultCreateInput({ ...base, rule }).rule, rule);
  });
});

describe("parseGoalUpdateInput / parseGoalKeyResultUpdateInput", () => {
  it("update vazio é rejeitado; parcial passa", () => {
    assert.throws(() => parseGoalUpdateInput({}));
    assert.equal(parseGoalUpdateInput({ title: "Novo" }).title, "Novo");
    assert.equal(parseGoalKeyResultUpdateInput({ weight: "2.5" }).weight, "2.5");
  });

  it("baseline==target no mesmo update é rejeitado", () => {
    assert.throws(() =>
      parseGoalKeyResultUpdateInput({ baseline: "10", target: "10" })
    );
  });
});

describe("parseGoalAchievedValueInput", () => {
  it("aceita decimal (incl. negativo p/ métricas de saldo) e rejeita lixo", () => {
    assert.equal(parseGoalAchievedValueInput({ achievedValue: "1234,56" }).achievedValue, "1234.56");
    assert.equal(parseGoalAchievedValueInput({ achievedValue: "-10" }).achievedValue, "-10");
    assert.throws(() => parseGoalAchievedValueInput({ achievedValue: "abc" }));
    assert.throws(() => parseGoalAchievedValueInput({ achievedValue: "" }));
  });
});

describe("período próprio do indicador", () => {
  const base = {
    title: "Faturamento",
    domain: "COMERCIAL",
    trackingType: "INCREASE",
    baseline: "0",
    target: "100000",
    ownerAppUserId: OWNER,
  };

  it("datas ausentes viram null (indicador herda o período do objetivo)", () => {
    const input = parseGoalKeyResultCreateInput(base);
    assert.equal(input.startDate, null);
    assert.equal(input.endDate, null);
  });

  it("datas próprias são aceitas e a ordem é validada", () => {
    const input = parseGoalKeyResultCreateInput({
      ...base,
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });
    assert.equal(input.startDate, "2026-07-01");
    assert.equal(input.endDate, "2026-09-30");
    assert.throws(
      () =>
        parseGoalKeyResultCreateInput({
          ...base,
          startDate: "2026-09-30",
          endDate: "2026-07-01",
        }),
      GoalContractError
    );
    assert.throws(() => parseGoalKeyResultCreateInput({ ...base, startDate: "01/07/2026" }));
  });

  it("update com null limpa o recorte (volta a herdar)", () => {
    const out = parseGoalKeyResultUpdateInput({ startDate: null, endDate: null });
    assert.equal(out.startDate, null);
    assert.equal(out.endDate, null);
  });

  it("janela medida = interseção com o período do objetivo", () => {
    // Sem recorte próprio: a janela é a do objetivo.
    assert.deepEqual(
      resolveGoalMeasurementWindow({
        goalStartDate: "2026-01-01",
        goalEndDate: "2026-12-31",
      }),
      { startCivilDate: "2026-01-01", endCivilDate: "2026-12-31" }
    );
    // Trimestre dentro de um objetivo anual.
    assert.deepEqual(
      resolveGoalMeasurementWindow({
        goalStartDate: "2026-01-01",
        goalEndDate: "2026-12-31",
        keyResultStartDate: "2026-07-01",
        keyResultEndDate: "2026-09-30",
      }),
      { startCivilDate: "2026-07-01", endCivilDate: "2026-09-30" }
    );
    // Recorte que vaza para fora é aparado pelo período do objetivo.
    assert.deepEqual(
      resolveGoalMeasurementWindow({
        goalStartDate: "2026-03-01",
        goalEndDate: "2026-06-30",
        keyResultStartDate: "2025-01-01",
        keyResultEndDate: "2027-12-31",
      }),
      { startCivilDate: "2026-03-01", endCivilDate: "2026-06-30" }
    );
    // Interseção vazia (objetivo encolheu depois): o objetivo manda.
    assert.deepEqual(
      resolveGoalMeasurementWindow({
        goalStartDate: "2026-01-01",
        goalEndDate: "2026-03-31",
        keyResultStartDate: "2026-07-01",
        keyResultEndDate: "2026-09-30",
      }),
      { startCivilDate: "2026-01-01", endCivilDate: "2026-03-31" }
    );
  });
});
