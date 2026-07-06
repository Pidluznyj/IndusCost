import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCappedCostCenterAllocationAmount } from "./financeCostCenterAllocationMetrics.js";
import {
  buildCostCenterDetailAllocationRow,
  buildCostCenterDetailSummaryFromRows,
  buildCostCenterExpenseDetailSnapshot,
} from "./financeCostCenterDetail.js";
import type { CostCenterExpenseDetailEntry } from "./financeCostCenterExpenseDetailTypes.js";

function ap(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 100,
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: null,
    description: "Título teste",
    comments: null,
    classification: null,
    competenceDate: null,
    dueDate: new Date("2026-06-10"),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 60000,
    amountPaid: 0,
    balancePayable: 60000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    status: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function entry(
  allocationAmount: number | null,
  apRow: ReturnType<typeof ap>,
  percentage = 100
): CostCenterExpenseDetailEntry {
  return {
    allocation: {
      id: `alloc-${apRow.externalId}`,
      accountsPayableId: apRow.externalId,
      supplierId: null,
      costCenterId: "cc-1",
      amount: allocationAmount,
      percentage,
      source: "AUTO_RULE",
      lockedManual: false,
      classificationRuleId: null,
      classificationRuleType: null,
      classificationRuleName: null,
      classificationRuleReason: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ap: apRow as never,
    supplierName: null,
    costCenterCode: "CC_TEST",
    costCenterName: "Teste",
  };
}

describe("financeCostCenterExpenseDetail", () => {
  it("cabeçalho = soma das linhas exibíveis", () => {
    const snapshot = buildCostCenterExpenseDetailSnapshot({
      entries: [
        entry(300, ap({ externalId: 1, balancePayable: 300, amountPayable: 300 })),
        entry(200, ap({ externalId: 2, balancePayable: 200, amountPayable: 200 })),
      ],
      filters: { status: "all" },
    });
    const sum = snapshot.displayRows.reduce((acc, row) => acc + row.allocatedAmount, 0);
    assert.equal(snapshot.totals.allocatedAmount, sum);
    assert.equal(snapshot.audit.difference, 0);
    assert.equal(snapshot.totals.titlesCount, 2);
  });

  it("título antigo substituído não soma snapshot stale com título novo", () => {
    const oldAp = ap({
      externalId: 10,
      balancePayable: 0,
      amountPayable: 0,
      amountPaid: 0,
      paymentDate: new Date("2026-05-01"),
      description: "Substituído no Nomus",
    });
    const newAp1 = ap({ externalId: 11, balancePayable: 60000, amountPayable: 60000 });
    const newAp2 = ap({ externalId: 12, balancePayable: 60000, amountPayable: 60000 });

    const snapshot = buildCostCenterExpenseDetailSnapshot({
      entries: [
        entry(116666.67, oldAp),
        entry(null, newAp1),
        entry(null, newAp2),
      ],
      filters: { status: "all" },
    });

    assert.equal(snapshot.displayRows.length, 2);
    assert.equal(snapshot.totals.allocatedAmount, 120000);
    assert.ok(snapshot.audit.staleAllocationAmountExcluded >= 116666.67);
  });

  it("parcelas quebradas somam apenas valores atuais", () => {
    const snapshot = buildCostCenterExpenseDetailSnapshot({
      entries: [
        entry(null, ap({ externalId: 21, balancePayable: 20000, amountPayable: 20000 }), 100),
        entry(null, ap({ externalId: 22, balancePayable: 20000, amountPayable: 20000 }), 100),
        entry(null, ap({ externalId: 23, balancePayable: 20000, amountPayable: 20000 }), 100),
        entry(null, ap({ externalId: 24, balancePayable: 30000, amountPayable: 30000 }), 100),
      ],
      filters: { status: "all" },
    });
    assert.equal(snapshot.totals.allocatedAmount, 90000);
    assert.equal(snapshot.totals.titlesCount, 4);
  });

  it("alocação explícita maior que título atual é limitada", () => {
    const capped = resolveCappedCostCenterAllocationAmount(
      { amount: 116666.67, percentage: 100 },
      60000
    );
    assert.equal(capped.allocatedAmount, 60000);
    assert.equal(capped.staleExcludedAmount, 56666.67);
  });

  it("título cancelado no Nomus não entra no detalhe", () => {
    const cancelled = ap({
      externalId: 99,
      balancePayable: 50000,
      amountPayable: 50000,
      comments: "TITULO CANCELADO",
    });
    const snapshot = buildCostCenterExpenseDetailSnapshot({
      entries: [entry(50000, cancelled)],
      filters: { status: "all" },
    });
    assert.equal(snapshot.displayRows.length, 0);
    assert.equal(snapshot.excluded[0]?.reason, "AP_CANCELLED");
  });

  it("resumo deriva das mesmas linhas do snapshot", () => {
    const rows = [
      buildCostCenterDetailAllocationRow(
        entry(1000, ap({ externalId: 30 })) as never,
        new Date(),
        "all_in_filter",
        1000
      ),
    ];
    const summary = buildCostCenterDetailSummaryFromRows(
      {
        id: "cc-1",
        code: "CC",
        name: "Centro",
        parentId: null,
        parentCode: null,
        parentName: null,
        status: "ACTIVE",
      },
      rows
    );
    assert.equal(summary.totalAllocatedAmount, 1000);
    assert.equal(summary.titlesCount, 1);
  });
});
