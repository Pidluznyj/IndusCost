import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMonthlyClosingWorkflowMeta,
  hasCriticalDataDivergence,
  resolveMonthlyClosingWorkflowStatus,
  validateClosingApproval,
} from "./commissionMonthlyClosingWorkflow.js";
import type { CommissionMonthlyPayableSellerSummary } from "./commissionMonthlyPayable.js";

function seller(overrides: Partial<CommissionMonthlyPayableSellerSummary> = {}): CommissionMonthlyPayableSellerSummary {
  return {
    sellerId: "p1",
    sellerName: "Vendedor A",
    month: "2026-06",
    receivedTitlesCount: 1,
    uniqueReceivablesCount: 1,
    uniqueOrdersCount: 1,
    uniqueNfeCount: 1,
    uniqueCustomersCount: 1,
    receivedAmount: 500,
    allocatedBaseAmount: 500,
    expectedCommissionAmount: 12.5,
    releasedCommissionAmount: 12.5,
    pendingCommissionAmount: 0,
    averageCommissionRate: 2.5,
    receivedVsBaseDiff: 0,
    warnings: [],
    ...overrides,
  };
}

describe("commissionMonthlyClosingWorkflow", () => {
  it("status calculado quando sem lote e sem divergência", () => {
    const result = resolveMonthlyClosingWorkflowStatus({
      divergenceCount: 0,
      warnings: [],
      nomusReference: null,
      paymentBatch: null,
      sellerHasLineAlerts: false,
    });
    assert.equal(result.status, "CALCULATED");
    assert.equal(result.statusLabel, "Calculado");
  });

  it("status divergente com alertas de linha", () => {
    const result = resolveMonthlyClosingWorkflowStatus({
      divergenceCount: 1,
      warnings: ["alerta"],
      nomusReference: null,
      paymentBatch: null,
      sellerHasLineAlerts: true,
    });
    assert.equal(result.status, "DIVERGENT");
    assert.equal(result.canApprove, false);
    assert.match(result.approvalBlockedReason ?? "", /justificativa/i);
  });

  it("status aprovado quando lote APPROVED", () => {
    const result = resolveMonthlyClosingWorkflowStatus({
      divergenceCount: 0,
      warnings: [],
      nomusReference: null,
      paymentBatch: {
        batchId: "b1",
        status: "APPROVED",
        totalSelected: 100,
        totalPaid: 0,
      },
      sellerHasLineAlerts: false,
    });
    assert.equal(result.status, "APPROVED");
  });

  it("status pago quando lote PAID", () => {
    const result = resolveMonthlyClosingWorkflowStatus({
      divergenceCount: 0,
      warnings: [],
      nomusReference: null,
      paymentBatch: {
        batchId: "b1",
        status: "PAID",
        totalSelected: 100,
        totalPaid: 100,
      },
      sellerHasLineAlerts: false,
    });
    assert.equal(result.status, "PAID");
  });

  it("não permite aprovar com divergência crítica sem justificativa", () => {
    const check = validateClosingApproval({
      status: "DIVERGENT",
      isCriticalDivergence: true,
      justification: "",
    });
    assert.equal(check.ok, false);
    const ok = validateClosingApproval({
      status: "DIVERGENT",
      isCriticalDivergence: true,
      justification: "Aprovado após conferência manual",
    });
    assert.equal(ok.ok, true);
  });

  it("agrupamento por vendedor inclui workflow", () => {
    const meta = buildMonthlyClosingWorkflowMeta({
      sellers: [seller()],
      divergenceCount: 0,
      warnings: [],
      nomusReference: {
        base: null,
        commission: null,
        baseDiff: null,
        commissionDiff: null,
        baseDiffPercent: null,
        commissionDiffPercent: null,
        nomusAverageRatePercent: null,
        indusAverageRatePercent: 2.5,
        comparable: true,
      },
      paymentBatchesBySeller: new Map(),
      sellerLineAlertCounts: new Map(),
    });
    assert.equal(meta.persistApproval, false);
    assert.equal(meta.sellerRows.length, 1);
    assert.equal(meta.sellerRows[0]?.workflow.status, "CALCULATED");
    assert.equal(meta.overallStatus, "CALCULATED");
  });

  it("divergência Nomus crítica", () => {
    assert.equal(
      hasCriticalDataDivergence({
        divergenceCount: 0,
        warnings: [],
        sellerHasLineAlerts: false,
        nomusReference: {
          comparable: true,
          commissionDiff: 100,
          commissionDiffPercent: 5,
        },
      }),
      true
    );
  });
});
