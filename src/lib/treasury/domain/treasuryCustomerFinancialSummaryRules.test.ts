import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import { buildTreasuryCustomerFinancialSummary } from "./treasuryCustomerFinancialSummaryRules.js";

function title(
  partial: Partial<OfficialReceivableView> &
    Pick<OfficialReceivableView, "id" | "externalId">
): OfficialReceivableView {
  return {
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 10,
      name: "Cliente X",
      taxId: "123",
      role: "CUSTOMER",
    },
    description: "NF",
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: 1, number: "1" },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-20",
    originalAmount: "1000.00",
    openBalance: "1000.00",
    settlements: {
      settledAmount: "0.00",
      settledAt: null,
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: false,
      sourcePresenceStatus: "PRESENT",
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: true,
      isSettled: false,
      sourcePresenceStatus: "PRESENT",
    },
    lastSyncedAt: "2026-07-20T12:00:00.000+00:00",
    ...partial,
  };
}

const REF = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27

describe("treasuryCustomerFinancialSummaryRules", () => {
  it("agrega aberto/vencido/a vencer e atrasos sem misturar atribuições", () => {
    const summary = buildTreasuryCustomerFinancialSummary({
      titleId: "t1",
      personId: 10,
      personName: "Cliente X",
      personTaxId: "123",
      titles: [
        title({
          id: "t1",
          externalId: 1,
          dueDate: "2026-07-10",
          openBalance: "400.00",
        }),
        title({
          id: "t2",
          externalId: 2,
          dueDate: "2026-08-01",
          openBalance: "200.00",
        }),
        title({
          id: "t3",
          externalId: 3,
          dueDate: "2026-07-01",
          openBalance: "100.00",
        }),
      ],
      promises: [
        {
          status: "ACTIVE",
          promisedAmount: "50.00",
          fulfilledAmount: "0.00",
        },
        {
          status: "EXPIRED",
          promisedAmount: "80.00",
          fulfilledAmount: "0.00",
        },
        {
          status: "FULFILLED",
          promisedAmount: "100.00",
          fulfilledAmount: "100.00",
        },
      ],
      actions: [
        {
          id: "a1",
          officialTitleId: "t1",
          actionType: "PHONE",
          performedAt: "2026-07-26T10:00:00.000+00:00",
          result: "Sem resposta",
          nextAction: "Ligar",
          contactPerson: "Ana",
          cancelledAt: null,
        },
      ],
      sellerName: "Vendedor Pedido",
      commercialOwnerName: "Resp Comercial",
      collectionOwnerUserId: "collector-9",
      referenceDate: REF,
    });

    assert.equal(summary.openAmountTotal, "700.00");
    assert.equal(summary.overdueAmountTotal, "500.00");
    assert.equal(summary.upcomingAmountTotal, "200.00");
    assert.equal(summary.openTitleCount, 3);
    assert.equal(summary.overdueTitleCount, 2);
    assert.equal(summary.upcomingTitleCount, 1);
    assert.equal(summary.maxDaysOverdue, 26); // 2026-07-01 → 07-27
    assert.equal(summary.averageDaysOverdue, 21.5); // (17+26)/2
    assert.equal(summary.activePromiseCount, 1);
    assert.equal(summary.expiredPromiseCount, 1);
    assert.equal(summary.promiseFulfillmentRate, "0.5000"); // 1 kept / (1+1)
    assert.equal(summary.sellerName, "Vendedor Pedido");
    assert.equal(summary.commercialOwnerName, "Resp Comercial");
    assert.equal(summary.collectionOwnerUserId, "collector-9");
    assert.notEqual(summary.sellerName, summary.commercialOwnerName);
    assert.equal(summary.collectionHistory.length, 1);
  });

  it("lista recebimentos recentes e ignora títulos cancelados na origem", () => {
    const summary = buildTreasuryCustomerFinancialSummary({
      titleId: "t1",
      personId: 10,
      personName: "Cliente X",
      personTaxId: null,
      titles: [
        title({
          id: "t1",
          externalId: 1,
          openBalance: "0.00",
          settlements: {
            settledAmount: "300.00",
            settledAt: "2026-07-20",
            paidAt: null,
          },
          officialStatus: {
            nomusStatus: true,
            isOpen: false,
            isSettled: true,
            sourcePresenceStatus: "PRESENT",
          },
        }),
        title({
          id: "gone",
          externalId: 99,
          openBalance: "999.00",
          cancellation: {
            isCancelledOrRemovedFromSource: true,
            sourcePresenceStatus: "MISSING_CONFIRMED",
            sourceRemovedAt: "2026-07-01T00:00:00.000+00:00",
          },
        }),
      ],
      promises: [],
      actions: [],
      sellerName: null,
      commercialOwnerName: null,
      collectionOwnerUserId: null,
      referenceDate: REF,
    });

    assert.equal(summary.openAmountTotal, "0.00");
    assert.equal(summary.recentReceipts.length, 1);
    assert.equal(summary.recentReceipts[0]?.settledAmount, "300.00");
    assert.equal(summary.promiseFulfillmentRate, null);
  });
});
