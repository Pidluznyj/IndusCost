import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePortfolioOrderLimitSelection } from "./cashFlowPortfolioLimitMath.js";

describe("teto de pedidos do portfólio — contagem, sem valor financeiro", () => {
  it("abaixo do teto processa todos e não marca limite", () => {
    const summary = summarizePortfolioOrderLimitSelection({
      configuredLimit: 80,
      priorityEligibleIdsInOrder: ["p1", "p2"],
      secondaryEligibleIdsExcludingTakenPriority: ["s1"],
    });
    assert.equal(summary.candidateOrders, 3);
    assert.equal(summary.processedOrders, 3);
    assert.equal(summary.configuredLimit, 80);
    assert.equal(summary.limitReached, false);
    assert.equal(summary.ordersExcludedByLimit, 0);
  });

  it("estouro da prioridade não conta de novo o que a secundária reencontra", () => {
    const priority = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const overflow = priority.slice(80);
    const secondaryOnly = ["s1", "s2"];
    const summary = summarizePortfolioOrderLimitSelection({
      configuredLimit: 80,
      priorityEligibleIdsInOrder: priority,
      secondaryEligibleIdsExcludingTakenPriority: [...overflow, ...secondaryOnly],
    });
    assert.equal(summary.candidateOrders, 102);
    assert.equal(summary.processedOrders, 80);
    assert.equal(summary.limitReached, true);
    assert.equal(summary.ordersExcludedByLimit, 22);
  });

  it("completa o teto com a secundária e corta o restante", () => {
    const priority = Array.from({ length: 70 }, (_, i) => `p${i}`);
    const secondary = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const summary = summarizePortfolioOrderLimitSelection({
      configuredLimit: 80,
      priorityEligibleIdsInOrder: priority,
      secondaryEligibleIdsExcludingTakenPriority: secondary,
    });
    assert.equal(summary.candidateOrders, 100);
    assert.equal(summary.processedOrders, 80);
    assert.equal(summary.ordersExcludedByLimit, 20);
  });
});
