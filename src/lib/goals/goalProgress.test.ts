import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeGoalKeyResultProgress,
  computeGoalRollup,
  progressRatioToPercent,
} from "./goalProgress.js";

describe("computeGoalKeyResultProgress — INCREASE (maior é melhor)", () => {
  it("meio do caminho: baseline 0, target 100.000, realizado 50.000 ⇒ 50%", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "0",
      target: "100000.00",
      achievedValue: "50000.00",
    });
    assert.equal(p.ratio, 0.5);
    assert.equal(p.invalidTargets, false);
  });

  it("baseline não-zero: 80k → 120k, realizado 100k ⇒ 50%", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "80000",
      target: "120000",
      achievedValue: "100000",
    });
    assert.equal(p.ratio, 0.5);
  });

  it("acima do alvo clampa em 100%; abaixo da baseline clampa em 0%", () => {
    assert.equal(
      computeGoalKeyResultProgress({ baseline: "0", target: "100", achievedValue: "250" }).ratio,
      1
    );
    assert.equal(
      computeGoalKeyResultProgress({ baseline: "50", target: "100", achievedValue: "10" }).ratio,
      0
    );
  });
});

describe("computeGoalKeyResultProgress — DECREASE (menor é melhor)", () => {
  it("reduzir custo de 200k para 150k; realizado 175k ⇒ 50%", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "200000",
      target: "150000",
      achievedValue: "175000",
    });
    assert.equal(p.ratio, 0.5);
  });

  it("custo SUBIU acima da baseline ⇒ 0% (clamp); abaixo do alvo ⇒ 100%", () => {
    assert.equal(
      computeGoalKeyResultProgress({ baseline: "200", target: "150", achievedValue: "220" }).ratio,
      0
    );
    assert.equal(
      computeGoalKeyResultProgress({ baseline: "200", target: "150", achievedValue: "120" }).ratio,
      1
    );
  });

  it("target == baseline é meta inválida: ratio 0 + flag", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "100",
      target: "100",
      achievedValue: "100",
    });
    assert.equal(p.ratio, 0);
    assert.equal(p.invalidTargets, true);
    assert.equal(p.configurationIssue, "NO_INTERVAL");
  });
});

describe("computeGoalKeyResultProgress — coerência direção × base/alvo", () => {
  it("INCREASE com alvo ABAIXO da base é DIRECTION_MISMATCH: ratio 0, nunca finge progresso", () => {
    // Sem a checagem, realizado 50 daria (50−100)/(50−100) = 100% — mentira:
    // o número CAIU numa meta de aumento.
    const p = computeGoalKeyResultProgress({
      baseline: "100",
      target: "50",
      achievedValue: "50",
      trackingType: "INCREASE",
    });
    assert.equal(p.ratio, 0);
    assert.equal(p.invalidTargets, true);
    assert.equal(p.configurationIssue, "DIRECTION_MISMATCH");
  });

  it("DECREASE com alvo ACIMA da base é DIRECTION_MISMATCH: ratio 0", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "100",
      target: "150",
      achievedValue: "150",
      trackingType: "DECREASE",
    });
    assert.equal(p.ratio, 0);
    assert.equal(p.invalidTargets, true);
    assert.equal(p.configurationIssue, "DIRECTION_MISMATCH");
  });

  it("direções coerentes seguem normais (INCREASE alvo>base; DECREASE alvo<base)", () => {
    const up = computeGoalKeyResultProgress({
      baseline: "100",
      target: "150",
      achievedValue: "125",
      trackingType: "INCREASE",
    });
    assert.equal(up.ratio, 0.5);
    assert.equal(up.configurationIssue, null);
    const down = computeGoalKeyResultProgress({
      baseline: "100",
      target: "50",
      achievedValue: "75",
      trackingType: "DECREASE",
    });
    assert.equal(down.ratio, 0.5);
    assert.equal(down.configurationIssue, null);
  });

  it("sem trackingType (chamador legado) o comportamento antigo é preservado", () => {
    const p = computeGoalKeyResultProgress({
      baseline: "100",
      target: "50",
      achievedValue: "50",
    });
    assert.equal(p.ratio, 1);
    assert.equal(p.configurationIssue, null);
  });
});

describe("computeGoalRollup — média ponderada dos KRs ativos (RN-010)", () => {
  it("dois KRs com pesos diferentes: (1.0×2 + 0.5×1) / 3 = 83%", () => {
    const rollup = computeGoalRollup([
      { status: "ACTIVE", weight: "2", baseline: "0", target: "100", achievedValue: "100" },
      { status: "ACTIVE", weight: "1", baseline: "0", target: "100", achievedValue: "50" },
    ]);
    assert.ok(Math.abs(rollup.ratio - 5 / 6) < 1e-9);
    assert.equal(rollup.activeKeyResults, 2);
    assert.equal(progressRatioToPercent(rollup.ratio), 83);
  });

  it("KR arquivado fica fora do roll-up", () => {
    const rollup = computeGoalRollup([
      { status: "ACTIVE", weight: "1", baseline: "0", target: "100", achievedValue: "100" },
      { status: "ARCHIVED", weight: "9", baseline: "0", target: "100", achievedValue: "0" },
    ]);
    assert.equal(rollup.ratio, 1);
    assert.equal(rollup.activeKeyResults, 1);
  });

  it("KR inválido (target==baseline) não dilui o objetivo, mas é contado", () => {
    const rollup = computeGoalRollup([
      { status: "ACTIVE", weight: "1", baseline: "0", target: "100", achievedValue: "100" },
      { status: "ACTIVE", weight: "1", baseline: "50", target: "50", achievedValue: "50" },
    ]);
    assert.equal(rollup.ratio, 1);
    assert.equal(rollup.invalidKeyResults, 1);
  });

  it("KR legado com direção incompatível NÃO infla o roll-up — sinalizado e fora da conta", () => {
    // O segundo KR "atingiria 100%" pela fórmula crua (INCREASE, base 100 →
    // alvo 50, realizado 50), mas é semanticamente inválido: fica fora do
    // denominador e conta como inválido.
    const rollup = computeGoalRollup([
      {
        status: "ACTIVE",
        weight: "1",
        baseline: "0",
        target: "100",
        achievedValue: "50",
        trackingType: "INCREASE",
      },
      {
        status: "ACTIVE",
        weight: "9",
        baseline: "100",
        target: "50",
        achievedValue: "50",
        trackingType: "INCREASE",
      },
    ]);
    assert.equal(rollup.ratio, 0.5);
    assert.equal(rollup.invalidKeyResults, 1);
    assert.equal(rollup.activeKeyResults, 2);
  });

  it("sem KR ativo ⇒ 0%", () => {
    assert.equal(computeGoalRollup([]).ratio, 0);
    assert.equal(
      computeGoalRollup([
        { status: "ARCHIVED", weight: "1", baseline: "0", target: "1", achievedValue: "1" },
      ]).ratio,
      0
    );
  });

  it("mistura INCREASE + DECREASE no mesmo objetivo", () => {
    // Faturar 100k (feito: 50k ⇒ 50%) + reduzir custo 200→150 (feito: 150 ⇒ 100%).
    const rollup = computeGoalRollup([
      { status: "ACTIVE", weight: "1", baseline: "0", target: "100000", achievedValue: "50000" },
      { status: "ACTIVE", weight: "1", baseline: "200", target: "150", achievedValue: "150" },
    ]);
    assert.equal(rollup.ratio, 0.75);
  });

  it("auditoria: reduzir 100→80 com realizado 90 = 50%; aumentar 100→120 com 110 = 50%", () => {
    assert.equal(
      computeGoalKeyResultProgress({
        baseline: "100",
        target: "80",
        achievedValue: "90",
        trackingType: "DECREASE",
      }).ratio,
      0.5
    );
    assert.equal(
      computeGoalKeyResultProgress({
        baseline: "100",
        target: "120",
        achievedValue: "110",
        trackingType: "INCREASE",
      }).ratio,
      0.5
    );
  });

  it("auditoria: KR A peso 1 a 100% + KR B peso 2 a 50% ⇒ 66,67% (arredondamento oficial = 67%)", () => {
    const rollup = computeGoalRollup([
      { status: "ACTIVE", weight: "1", baseline: "0", target: "100", achievedValue: "100" },
      { status: "ACTIVE", weight: "2", baseline: "0", target: "100", achievedValue: "50" },
    ]);
    assert.ok(Math.abs(rollup.ratio - 2 / 3) < 1e-9);
    assert.equal(progressRatioToPercent(rollup.ratio), 67);
  });

  it("determinístico: mesma entrada ⇒ mesma saída", () => {
    const input = [
      { status: "ACTIVE", weight: "1.5", baseline: "10", target: "90", achievedValue: "35" },
    ];
    assert.deepEqual(computeGoalRollup(input), computeGoalRollup(input));
  });
});
