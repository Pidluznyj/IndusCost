import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryReceivableComplementView } from "../contracts/treasuryReceivableContracts.js";
import {
  computeTreasuryReceivableDaysOverdue,
  deriveTreasuryReceivableLastAction,
  deriveTreasuryReceivableOperationalStatus,
  matchesTaxIdFilter,
} from "./treasuryReceivableQueryRules.js";

function official(
  overrides: Partial<OfficialReceivableView> = {}
): OfficialReceivableView {
  return {
    id: "ar-1",
    externalId: 10,
    installmentNumber: 1,
    installmentLabel: "1/1",
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: "12.345.678/0001-90",
      role: "CUSTOMER",
    },
    description: "NF",
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: 9, number: "100" },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-01",
    originalAmount: "100.00",
    openBalance: "100.00",
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
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function complement(
  overrides: Partial<TreasuryReceivableComplementView> = {}
): TreasuryReceivableComplementView {
  return {
    id: "c1",
    expectedDate: null,
    confirmedDate: null,
    scheduledDate: null,
    expectedAmount: null,
    confirmedAmount: null,
    scheduledAmount: null,
    status: "ACTIVE",
    priority: "NORMAL",
    plannedAccountId: null,
    responsibleUserId: null,
    nextAction: null,
    reason: null,
    notes: null,
    version: 1,
    updatedAt: "2026-07-10T12:00:00.000Z",
    cancelledAt: null,
    ...overrides,
  };
}

describe("treasuryReceivableQueryRules — atraso e status operacional", () => {
  it("daysOverdue = 0 quando sem dueDate ou saldo ≤ 0", () => {
    assert.equal(
      computeTreasuryReceivableDaysOverdue({
        dueDate: null,
        openAmount: "10.00",
        referenceDate: new Date("2026-07-20T12:00:00-03:00"),
      }),
      0
    );
    assert.equal(
      computeTreasuryReceivableDaysOverdue({
        dueDate: "2026-07-01",
        openAmount: "0.00",
        referenceDate: new Date("2026-07-20T12:00:00-03:00"),
      }),
      0
    );
    assert.ok(
      computeTreasuryReceivableDaysOverdue({
        dueDate: "2026-07-01",
        openAmount: "10.00",
        referenceDate: new Date("2026-07-20T12:00:00-03:00"),
      }) > 0
    );
  });

  it("precedência: cancelado origem > local > hold > settled > promised > overdue > expected > open", () => {
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official({
          cancellation: {
            isCancelledOrRemovedFromSource: true,
            sourcePresenceStatus: "MISSING_CONFIRMED",
            sourceRemovedAt: "2026-07-01T00:00:00.000Z",
          },
        }),
        complement: complement({ confirmedDate: "2026-07-05" }),
        daysOverdue: 10,
        hasActivePromise: true,
      }),
      "CANCELLED_SOURCE"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: complement({ status: "CANCELLED", cancelledAt: "2026-07-02T00:00:00.000Z" }),
        daysOverdue: 10,
      }),
      "CANCELLED_LOCAL"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: complement({ status: "ON_HOLD" }),
        daysOverdue: 10,
      }),
      "ON_HOLD"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official({
          officialStatus: {
            nomusStatus: true,
            isOpen: false,
            isSettled: true,
            sourcePresenceStatus: "PRESENT",
          },
          openBalance: "0.00",
        }),
        complement: null,
        daysOverdue: 10,
      }),
      "SETTLED"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: complement({ confirmedAmount: "50.00" }),
        daysOverdue: 10,
      }),
      "PROMISED"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: null,
        daysOverdue: 10,
        hasActivePromise: true,
      }),
      "PROMISED"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: complement({ expectedDate: "2026-07-25" }),
        daysOverdue: 5,
      }),
      "OVERDUE"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: complement({ expectedDate: "2026-07-25" }),
        daysOverdue: 0,
      }),
      "EXPECTED"
    );
    assert.equal(
      deriveTreasuryReceivableOperationalStatus({
        official: official(),
        complement: null,
        daysOverdue: 0,
      }),
      "OPEN"
    );
  });

  it("lastAction usa reason/notes e taxId ignora máscara", () => {
    const action = deriveTreasuryReceivableLastAction(
      complement({ reason: "Cliente pediu prazo" })
    );
    assert.equal(action?.summary, "Cliente pediu prazo");
    assert.equal(
      matchesTaxIdFilter("12.345.678/0001-90", "12345678000190"),
      true
    );
    assert.equal(matchesTaxIdFilter("12.345.678/0001-90", "999"), false);
  });
});
