import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateProposalItemCommissionValue,
  extractProposalItemEstimatedCommission,
  formatProposalEstimatedCommissionLabel,
} from "./proposalItemEstimatedCommission.js";

describe("proposalItemEstimatedCommission", () => {
  it("lê commissionPerc de proposalDefaults do snapshot publicado", () => {
    const result = extractProposalItemEstimatedCommission({
      proposalDefaults: { commissionPerc: 2, commissionValue: 0.64 },
      item: { commissionPerc: 0, salePrice: 32 },
    });
    assert.equal(result.source, "SNAPSHOT");
    assert.equal(result.commissionPerc, 2);
    assert.equal(result.commissionValuePerUnit, 0.64);
  });

  it("faz fallback para formulaSnapshotJson.rates.commissionRate", () => {
    const result = extractProposalItemEstimatedCommission({
      item: {
        commissionPerc: 0,
        salePrice: 100,
        formulaSnapshotJson: { rates: { commissionRate: 0.02 } },
      },
    });
    assert.equal(result.source, "SNAPSHOT");
    assert.equal(result.commissionPerc, 2);
    assert.equal(result.commissionValuePerUnit, 2);
  });

  it("zero explícito no snapshot não é pendente", () => {
    const result = extractProposalItemEstimatedCommission({
      proposalDefaults: { commissionPerc: 0, commissionValue: 0 },
      item: { commissionPerc: 0 },
    });
    assert.equal(result.source, "SNAPSHOT");
    assert.equal(result.commissionPerc, 0);
  });

  it("sem snapshot fica unavailable", () => {
    const result = extractProposalItemEstimatedCommission(null);
    assert.equal(result.source, "UNAVAILABLE");
    assert.match(result.pendingReason ?? "", /não disponível/i);
  });

  it("estima valor da linha por percentual × receita", () => {
    assert.equal(
      estimateProposalItemCommissionValue({
        quantity: 4,
        lineRevenue: 128,
        commissionPerc: 2,
        commissionValuePerUnit: null,
      }),
      2.56
    );
    assert.equal(
      estimateProposalItemCommissionValue({
        quantity: 4,
        lineRevenue: 128,
        commissionPerc: 2,
        commissionValuePerUnit: 0.64,
      }),
      2.56
    );
  });

  it("formata label com percentual e valor", () => {
    assert.match(
      formatProposalEstimatedCommissionLabel({
        commissionPerc: 2,
        commissionValue: 0.64,
        pending: false,
      }),
      /2,00%.*R\$ 0,64/
    );
    assert.match(
      formatProposalEstimatedCommissionLabel({
        commissionPerc: 2,
        commissionValue: null,
        pending: false,
      }),
      /2,00% \/ valor pendente/
    );
    assert.match(
      formatProposalEstimatedCommissionLabel({
        commissionPerc: null,
        commissionValue: null,
        pending: true,
        pendingReason: "regra não resolvida",
      }),
      /Pendente: regra não resolvida/
    );
  });
});
