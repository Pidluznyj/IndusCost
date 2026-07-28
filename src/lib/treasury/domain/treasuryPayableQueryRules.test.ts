import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialPayableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryPayableComplementView } from "../contracts/treasuryPayableContracts.js";
import {
  deriveTreasuryPayableOperationalStatus,
  resolveTreasuryPayableProgramming,
} from "./treasuryPayableQueryRules.js";

function official(
  overrides: Partial<OfficialPayableView> = {}
): OfficialPayableView {
  return {
    id: "ap-1",
    externalId: 20,
    installmentNumber: 1,
    installmentLabel: "1/1",
    counterparty: {
      personId: 2,
      name: "Fornecedor",
      taxId: "00",
      role: "SUPPLIER",
    },
    description: "Compra",
    documentNumber: "DOC-1",
    classification: "OP",
    comments: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: null, number: null },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-01",
    nomusScheduleDate: null,
    nomusScheduledAmount: null,
    originalAmount: "80.00",
    openBalance: "80.00",
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
  overrides: Partial<TreasuryPayableComplementView> = {}
): TreasuryPayableComplementView {
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

describe("treasuryPayableQueryRules — status e programação", () => {
  it("programação local AUTHORIZED supera OVERDUE; Nomus schedule conta como programmed", () => {
    assert.equal(
      deriveTreasuryPayableOperationalStatus({
        official: official(),
        complement: complement({
          scheduledDate: "2026-07-20",
          scheduledAmount: "80.00",
          nextAction: "AUTHORIZED",
        }),
        daysOverdue: 15,
      }),
      "AUTHORIZED"
    );
    assert.equal(
      deriveTreasuryPayableOperationalStatus({
        official: official({
          nomusScheduleDate: "2026-07-18",
          nomusScheduledAmount: "80.00",
        }),
        complement: null,
        daysOverdue: 15,
      }),
      "PROGRAMMED"
    );
    assert.equal(
      deriveTreasuryPayableOperationalStatus({
        official: official(),
        complement: null,
        daysOverdue: 15,
      }),
      "OVERDUE"
    );
  });

  it("resolve programação preferindo complemento sobre agenda Nomus", () => {
    const resolved = resolveTreasuryPayableProgramming({
      official: official({
        nomusScheduleDate: "2026-07-10",
        nomusScheduledAmount: "50.00",
      }),
      complement: complement({
        scheduledDate: "2026-07-22",
        scheduledAmount: "80.00",
      }),
    });
    assert.equal(resolved.scheduledDate, "2026-07-22");
    assert.equal(resolved.scheduledAmount, "80.00");

    const fallback = resolveTreasuryPayableProgramming({
      official: official({
        nomusScheduleDate: "2026-07-10",
        nomusScheduledAmount: "50.00",
      }),
      complement: null,
    });
    assert.equal(fallback.scheduledDate, "2026-07-10");
    assert.equal(fallback.scheduledAmount, "50.00");
  });

  it("ON_HOLD e SETTLED têm prioridade sobre programação", () => {
    assert.equal(
      deriveTreasuryPayableOperationalStatus({
        official: official(),
        complement: complement({
          status: "ON_HOLD",
          scheduledDate: "2026-07-20",
          nextAction: "AUTHORIZED",
        }),
        daysOverdue: 0,
      }),
      "ON_HOLD"
    );
    assert.equal(
      deriveTreasuryPayableOperationalStatus({
        official: official({
          officialStatus: {
            nomusStatus: true,
            isOpen: false,
            isSettled: true,
            sourcePresenceStatus: "PRESENT",
          },
          openBalance: "0.00",
        }),
        complement: complement({ scheduledDate: "2026-07-20" }),
        daysOverdue: 0,
      }),
      "SETTLED"
    );
  });
});
