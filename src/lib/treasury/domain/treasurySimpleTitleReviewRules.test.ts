import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryPayableListItemDto } from "../contracts/treasuryPayableContracts.js";
import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import {
  TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS,
  deriveTreasurySimplePayableReviewCategory,
  deriveTreasurySimpleReceivableReviewCategory,
  filterTreasurySimpleReceivableRows,
} from "./treasurySimpleTitleReviewRules.js";

const CIVIL = "2026-07-28";

function baseOfficial(partial: Record<string, unknown> = {}) {
  return {
    id: "t1",
    externalId: 1,
    installmentNumber: 1,
    installmentLabel: "1/1",
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: null,
      role: "CUSTOMER" as const,
    },
    description: "NF",
    documentNumber: "100",
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: null, number: null },
    issuedOn: "2026-07-01",
    dueDate: CIVIL,
    originalAmount: "100.00",
    openBalance: "100.00",
    settlements: {
      settledAmount: null,
      settledAt: null,
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: false,
      sourcePresenceStatus: "PRESENT" as const,
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: true,
      isSettled: false,
      sourcePresenceStatus: "PRESENT" as const,
    },
    lastSyncedAt: "2026-07-28T12:00:00.000+00:00",
    ...partial,
  };
}

function receivable(
  overrides: Partial<TreasuryReceivableListItemDto> & {
    official?: Record<string, unknown>;
  } = {}
): TreasuryReceivableListItemDto {
  const { official, ...rest } = overrides;
  return {
    titleId: "r1",
    externalId: 1,
    official: baseOfficial(official) as TreasuryReceivableListItemDto["official"],
    complement: {
      id: "c1",
      expectedDate: CIVIL,
      confirmedDate: null,
      scheduledDate: null,
      expectedAmount: "100.00",
      confirmedAmount: null,
      scheduledAmount: null,
      status: "ACTIVE",
      priority: "NORMAL",
      plannedAccountId: "acc-1",
      responsibleUserId: null,
      nextAction: null,
      reason: null,
      notes: null,
      version: 1,
      updatedAt: "2026-07-28T12:00:00.000+00:00",
      cancelledAt: null,
    },
    sellerName: null,
    commercialOwnerName: null,
    openAmount: "100.00",
    receivedAmount: null,
    daysOverdue: 0,
    operationalStatus: "OPEN",
    lastAction: null,
    nextAction: null,
    ...rest,
  };
}

function payable(
  overrides: Partial<TreasuryPayableListItemDto> & {
    official?: Record<string, unknown>;
  } = {}
): TreasuryPayableListItemDto {
  const { official, ...rest } = overrides;
  const off = baseOfficial({
    classification: null,
    comments: null,
    nomusScheduleDate: null,
    nomusScheduledAmount: null,
    ...official,
    counterparty: {
      personId: 2,
      name: "Fornecedor",
      taxId: null,
      role: "SUPPLIER" as const,
    },
  });
  return {
    titleId: "p1",
    externalId: 2,
    official: off as TreasuryPayableListItemDto["official"],
    complement: {
      id: "c2",
      expectedDate: null,
      confirmedDate: null,
      scheduledDate: CIVIL,
      expectedAmount: null,
      confirmedAmount: null,
      scheduledAmount: "80.00",
      status: "ACTIVE",
      priority: "NORMAL",
      plannedAccountId: "acc-1",
      responsibleUserId: null,
      nextAction: null,
      reason: null,
      notes: "Obs",
      version: 1,
      updatedAt: "2026-07-28T12:00:00.000+00:00",
      cancelledAt: null,
    },
    classification: null,
    costCenterId: null,
    costCenterLabel: null,
    openAmount: "80.00",
    paidAmount: null,
    scheduledDate: CIVIL,
    scheduledAmount: "80.00",
    plannedAccountId: "acc-1",
    priority: "NORMAL",
    notes: null,
    daysOverdue: 0,
    operationalStatus: "OPEN",
    lastAction: null,
    nextAction: null,
    ...rest,
  };
}

describe("treasurySimpleTitleReviewRules", () => {
  it("classifica baixa total, parcial, pendente e conta não mapeada", () => {
    assert.equal(
      deriveTreasurySimpleReceivableReviewCategory(
        receivable({
          openAmount: "0.00",
          receivedAmount: "100.00",
          official: {
            openBalance: "0.00",
            settlements: {
              settledAmount: "100.00",
              settledAt: CIVIL,
              paidAt: null,
            },
            officialStatus: {
              nomusStatus: true,
              isOpen: false,
              isSettled: true,
              sourcePresenceStatus: "PRESENT",
            },
          },
        }),
        CIVIL
      ),
      "RECEIVED"
    );

    assert.equal(
      deriveTreasurySimpleReceivableReviewCategory(
        receivable({
          openAmount: "40.00",
          receivedAmount: "60.00",
          official: {
            openBalance: "40.00",
            settlements: {
              settledAmount: "60.00",
              settledAt: CIVIL,
              paidAt: null,
            },
          },
        }),
        CIVIL
      ),
      "PARTIALLY_RECEIVED"
    );

    assert.equal(
      deriveTreasurySimpleReceivableReviewCategory(receivable(), CIVIL),
      "PLANNED_TODAY"
    );

    assert.equal(
      deriveTreasurySimpleReceivableReviewCategory(
        receivable({
          complement: {
            ...receivable().complement!,
            plannedAccountId: null,
          },
        }),
        CIVIL
      ),
      "UNLINKED_ACCOUNT"
    );

    assert.equal(
      deriveTreasurySimpleReceivableReviewCategory(
        receivable({
          complement: {
            ...receivable().complement!,
            plannedAccountId: null,
          },
        }),
        CIVIL,
        { linkedAccountId: "acc-1" }
      ),
      "PLANNED_TODAY"
    );

    assert.equal(
      TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS.RECEIVED,
      "Recebido"
    );
  });

  it("classifica pagamentos e filtros de visão", () => {
    assert.equal(
      deriveTreasurySimplePayableReviewCategory(
        payable({
          openAmount: "0.00",
          paidAmount: "80.00",
          official: {
            openBalance: "0.00",
            settlements: {
              settledAmount: "80.00",
              settledAt: CIVIL,
              paidAt: CIVIL,
            },
            officialStatus: {
              nomusStatus: true,
              isOpen: false,
              isSettled: true,
              sourcePresenceStatus: "PRESENT",
            },
          },
        }),
        CIVIL
      ),
      "PAID"
    );

    assert.equal(
      deriveTreasurySimplePayableReviewCategory(
        payable({ daysOverdue: 3, operationalStatus: "OVERDUE" }),
        CIVIL
      ),
      "OVERDUE"
    );

    assert.equal(TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS.PENDING, "Pendente");

    const filtered = filterTreasurySimpleReceivableRows({
      rows: [
        receivable(),
        receivable({
          titleId: "r2",
          complement: {
            ...receivable().complement!,
            plannedAccountId: null,
          },
        }),
      ],
      civilDate: CIVIL,
      category: "ALL",
      bucket: "UNLINKED",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.category, "UNLINKED_ACCOUNT");
  });

  it("labels simples não expõem enums técnicos", () => {
    const corpus = [
      ...Object.values(TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS),
      ...Object.values(TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS),
    ].join(" ");
    assert.doesNotMatch(corpus, /\bSETTLED\b|\bOPEN\b|\bCANCELLED\b/);
    assert.match(corpus, /Recebido/);
    assert.match(corpus, /Pago/);
  });
});
