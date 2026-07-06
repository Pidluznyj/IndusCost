import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildArCommissionReconcile,
  type ArReceivableSnapshot,
} from "./reconcileArVsCommission.js";
import { buildVisualAuditRow } from "./commissionVisualAudit.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const emptyIdentity: CommissionSellerIdentityContext = { persons: [], aliases: [] };

function arRow(
  externalId: number,
  overrides?: Partial<ArReceivableSnapshot>
): ArReceivableSnapshot {
  return {
    externalId,
    personName: "Cliente A",
    personId: 1,
    dueDate: new Date("2026-05-15"),
    settlementDate: new Date("2026-06-10"),
    amountReceivable: 1000,
    amountReceived: 1000,
    balanceReceivable: 0,
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    ...overrides,
  };
}

function period() {
  return {
    year: 2026,
    month: 6,
    periodFrom: new Date("2026-06-01"),
    periodTo: new Date("2026-06-30T23:59:59.999"),
  };
}

function payableInput(overrides?: Partial<Parameters<typeof buildVisualAuditRow>[0]>) {
  return {
    lineId: "r1:s1",
    recordId: "rec-1",
    scheduleId: "s1",
    commissionPersonId: "seller-1",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente A",
    orderCode: "PV-1",
    nfeNumber: "NF-100",
    nomusNfeId: 100,
    confirmedAt: "2026-05-01T00:00:00.000Z",
    documentKey: "seller-1:100",
    documentBaseAmount: 1000,
    documentCommissionTotal: 25,
    itemBaseAmount: 1000,
    itemCommissionAmount: 25,
    itemRatePercent: 2.5,
    productCode: "SKU",
    nomusReceivableId: 5001,
    installmentNumber: 1,
    dueDate: "2026-05-15T00:00:00.000Z",
    settlementDate: "2026-06-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    openBalance: 0,
    allocationPercent: 100,
    commissionExpected: 25,
    commissionReleased: 25,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
    ...overrides,
  };
}

describe("reconcileArVsCommission", () => {
  it("título vencido em maio e recebido em junho entra no payable junho", () => {
    const payableRows = [buildVisualAuditRow(payableInput())];
    const { summary } = buildArCommissionReconcile({
      ...period(),
      arRows: [arRow(5001)],
      payableRows,
      payableCards: {
        receivableAmountTotal: 1000,
        receivedAmountTotal: 1000,
        commissionableBaseTotal: 1000,
        commissionExpectedTotal: 25,
        commissionReleasedTotal: 25,
        commissionPendingTotal: 0,
        averageRatePercent: 2.5,
        receivableCount: 1,
      },
      identityCtx: emptyIdentity,
    });

    assert.equal(summary.arBySettlement.uniqueReceivableCount, 1);
    assert.equal(summary.commissionPayable.uniqueReceivableCount, 1);
    assert.ok(summary.bridge.arSettlementWithCommission > 0);
  });

  it("título vencido em junho e recebido em julho não entra no payable junho", () => {
    const { summary, details } = buildArCommissionReconcile({
      ...period(),
      arRows: [
        arRow(5002, {
          dueDate: new Date("2026-06-20"),
          settlementDate: new Date("2026-07-05"),
        }),
      ],
      payableRows: [],
      payableCards: {
        receivableAmountTotal: 0,
        receivedAmountTotal: 0,
        commissionableBaseTotal: 0,
        commissionExpectedTotal: 0,
        commissionReleasedTotal: 0,
        commissionPendingTotal: 0,
        averageRatePercent: 0,
        receivableCount: 0,
      },
      identityCtx: emptyIdentity,
    });

    assert.equal(summary.arBySettlement.uniqueReceivableCount, 0);
    assert.equal(details.length, 0);
  });

  it("título recebido em junho sem CommissionRecord aparece como sem comissão", () => {
    const { summary, details } = buildArCommissionReconcile({
      ...period(),
      arRows: [arRow(5003)],
      payableRows: [],
      payableCards: {
        receivableAmountTotal: 0,
        receivedAmountTotal: 0,
        commissionableBaseTotal: 0,
        commissionExpectedTotal: 0,
        commissionReleasedTotal: 0,
        commissionPendingTotal: 0,
        averageRatePercent: 0,
        receivableCount: 0,
      },
      identityCtx: emptyIdentity,
    });

    assert.equal(details[0]?.breakdownCategory, "NO_COMMISSION_RECORD");
    assert.ok(summary.bridge.arSettlementWithoutCommission > 0);
  });

  it("cliente excluído aparece com comissão zero e motivo", () => {
    const payableRows = [
      buildVisualAuditRow(
        payableInput({
          nomusReceivableId: 5004,
          customerNoCommission: true,
          isCommissionable: false,
          exclusionReason: "ESMALTEC sem comissão",
          commissionExpected: 0,
          commissionReleased: 0,
        })
      ),
    ];
    const { details } = buildArCommissionReconcile({
      ...period(),
      arRows: [arRow(5004)],
      payableRows,
      payableCards: {
        receivableAmountTotal: 1000,
        receivedAmountTotal: 1000,
        commissionableBaseTotal: 0,
        commissionExpectedTotal: 0,
        commissionReleasedTotal: 0,
        commissionPendingTotal: 0,
        averageRatePercent: 0,
        receivableCount: 1,
      },
      identityCtx: emptyIdentity,
    });

    assert.equal(details[0]?.breakdownCategory, "CUSTOMER_EXCLUDED");
    assert.match(details[0]?.nonCommissionReason ?? "", /ESMALTEC/);
  });

  it("ponte explica diferença entre AR financeiro e comissão", () => {
    const payableRows = [buildVisualAuditRow(payableInput({ receivedAmount: 500, receivableAmount: 500 }))];
    const { summary } = buildArCommissionReconcile({
      ...period(),
      arRows: [
        arRow(5001, { amountReceived: 500, amountReceivable: 500 }),
        arRow(5005, { amountReceived: 800, amountReceivable: 800, sourceInvoiceId: null }),
      ],
      payableRows,
      payableCards: {
        receivableAmountTotal: 500,
        receivedAmountTotal: 500,
        commissionableBaseTotal: 500,
        commissionExpectedTotal: 12.5,
        commissionReleasedTotal: 12.5,
        commissionPendingTotal: 0,
        averageRatePercent: 2.5,
        receivableCount: 1,
      },
      identityCtx: emptyIdentity,
    });

    assert.equal(summary.bridge.arSettlementReceived, 1300);
    assert.equal(summary.bridge.commissionReceivedAmount, 500);
    assert.equal(summary.bridge.arVsCommissionReceivedDiff, 800);
  });
});
