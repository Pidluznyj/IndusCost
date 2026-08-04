import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionTraceNomusAudit,
  buildCommissionTraceReceipt,
  buildEmptyCommissionTraceReport,
  buildCommissionTraceCsv,
  computeCommissionTraceTotals,
} from "./commissionTraceAudit.js";
import type { CommissionReceiptReceivableInput, MaterializedReceivableScheduleInput } from "./commissionReceiptEngine.js";
import { COMMISSION_RECEIPT_NO_SCHEDULE_REASON } from "./commissionReceiptEngine.js";

function receivable(
  partial: Partial<CommissionReceiptReceivableInput> &
    Pick<CommissionReceiptReceivableInput, "nomusReceivableId">
): CommissionReceiptReceivableInput {
  return {
    receivableNumber: null,
    installmentNumber: 1,
    settlementDate: new Date("2026-06-10"),
    dueDate: new Date("2026-07-10"),
    amountReceivable: 10000,
    amountReceived: 10000,
    balanceReceivable: 0,
    nomusNfeId: 100,
    nfeNumber: "123",
    customerExternalId: 1,
    customerId: "cust-1",
    customerName: "Cliente",
    cancelled: false,
    suspended: false,
    ...partial,
  };
}

function schedule(
  partial: Partial<MaterializedReceivableScheduleInput> &
    Pick<MaterializedReceivableScheduleInput, "receivableId" | "scheduledCommissionAmount">
): MaterializedReceivableScheduleInput {
  return {
    id: `sched-${partial.receivableId}`,
    orderSnapshotId: "snap-1",
    receivableCode: "AR-1",
    installmentNumber: 1,
    nfeId: 100,
    salesOrderId: "order-1",
    customerId: "cust-1",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "Vendedor",
    rawSellerId: 1,
    rawSellerName: "Vendedor",
    orderCode: "PED-1",
    receivableNominalAmount: 10000,
    receivableSharePercent: 100,
    scheduleStatus: "ACTIVE",
    // Schedule da versão VIGENTE do pedido — caso normal. Órfão de snapshot
    // substituído se declara explicitamente no teste que o exercita.
    orderSnapshotStatus: "ACTIVE",
    sellerResolutionStatus: "OK_CANONICAL",
    exclusionRuleId: null,
    exclusionReason: null,
    ...partial,
  };
}

describe("commissionTraceAudit", () => {
  it("pedido inexistente retorna FAIL", () => {
    const report = buildEmptyCommissionTraceReport("Pedido não encontrado: XYZ");
    assert.equal(report.status, "FAIL");
  });

  it("título recebido com schedule libera comissão", () => {
    const receipt = buildCommissionTraceReceipt({
      schedule: schedule({ receivableId: 1, scheduledCommissionAmount: 200 }),
      receivable: receivable({ nomusReceivableId: 1, amountReceived: 10000 }),
    });
    assert.equal(receipt.status, "COMMISSIONABLE");
    assert.equal(receipt.releasedCommissionAmount, 200);
    assert.equal(receipt.pendingCommissionAmount, 0);
  });

  it("baixa parcial libera comissão proporcional", () => {
    const receipt = buildCommissionTraceReceipt({
      schedule: schedule({
        receivableId: 2,
        scheduledCommissionAmount: 200,
        receivableNominalAmount: 10000,
      }),
      receivable: receivable({ nomusReceivableId: 2, amountReceived: 2500 }),
    });
    assert.equal(receipt.releasedCommissionAmount, 50);
    assert.equal(receipt.pendingCommissionAmount, 150);
  });

  it("cliente excluído zera final e mantém bruto no schedule", () => {
    const receipt = buildCommissionTraceReceipt({
      schedule: schedule({
        receivableId: 3,
        scheduledCommissionAmount: 0,
        scheduleStatus: "CUSTOMER_EXCLUDED",
        grossScheduledCommissionAmount: 120,
      }),
      receivable: receivable({ nomusReceivableId: 3 }),
    });
    assert.equal(receipt.status, "CUSTOMER_EXCLUDED");
    assert.equal(receipt.releasedCommissionAmount, 0);
    assert.equal(receipt.grossCommissionAmount, 120);
  });

  it("sem schedule retorna NO_SCHEDULE sem quebrar", () => {
    const receipt = buildCommissionTraceReceipt({
      schedule: null,
      receivable: receivable({ nomusReceivableId: 4 }),
    });
    assert.equal(receipt.status, "NO_SCHEDULE");
    assert.equal(receipt.statusReason, COMMISSION_RECEIPT_NO_SCHEDULE_REASON);
  });

  it("filtro por SKU reflete comissão do item nos totais", () => {
    const totals = computeCommissionTraceTotals({
      items: [
        {
          itemSnapshotId: "i1",
          salesOrderItemId: "soi1",
          sku: "618.08AA",
          productName: "Produto A",
          soldAmount: 1000,
          marginPercent: 20,
          ruleId: "r1",
          ruleName: "Regra",
          commissionRatePercent: 2,
          grossCommissionAmount: 20,
          finalCommissionAmount: 20,
          status: "COMMISSIONABLE",
          exclusionReason: null,
        },
      ],
      receipts: [],
    });
    assert.equal(totals.totalGrossCommission, 20);
    assert.equal(totals.totalFinalCommission, 20);
  });

  it("CSV inclui seções item e receipt", () => {
    const report = buildEmptyCommissionTraceReport("erro");
    report.items.push({
      itemSnapshotId: "i1",
      salesOrderItemId: "soi1",
      sku: "SKU",
      productName: "P",
      soldAmount: 10,
      marginPercent: 1,
      ruleId: null,
      ruleName: null,
      commissionRatePercent: 2,
      grossCommissionAmount: 1,
      finalCommissionAmount: 1,
      status: "COMMISSIONABLE",
      exclusionReason: null,
    });
    const csv = buildCommissionTraceCsv(report);
    assert.match(csv, /^section,field,value/m);
    assert.match(csv, /item,SKU/);
  });

  it("auditoria Nomus explica diferença", () => {
    const audit = buildCommissionTraceNomusAudit({
      nomusBase: 1000,
      nomusCommission: 20,
      indusReleasedCommission: 25,
      indusCommissionableBase: 1100,
    });
    assert.ok(audit);
    assert.notEqual(audit?.commissionDifference, 0);
    assert.match(audit?.explanation ?? "", /Comissão liberada IndusCost/);
  });
});
